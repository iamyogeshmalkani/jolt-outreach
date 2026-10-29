import type { Person, UiState, Video } from './types'
import { EMPTY_STATE } from './types'
import { DEMO_PEOPLE, DEMO_VIDEOS } from './demo'

// Two ways to run:
//  local   `npm run dev` on your computer. Files in the jolt_outreach folder are read and saved by a small local service.
//  online  the hosted page. People and videos are read from the data branch on GitHub, which the hourly job updates.
//          Your statuses are saved in this browser only.
export type Mode = 'local' | 'online'

export type Loaded = {
  mode: Mode
  dir: string
  people: Person[]
  videos: Video[]
  state: UiState
  demo: boolean
}

const STATE_KEY = 'jolt.state'
let mode: Mode = 'local'

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

async function fetchLocal<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}api/${path}`)
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

// Set by the deploy workflow, for example https://raw.githubusercontent.com/owner/repo/data/
const DATA_BASE: string | undefined = import.meta.env.VITE_DATA_BASE

async function fetchRemote<T>(file: string): Promise<T | null> {
  if (!DATA_BASE) return null
  try {
    const res = await fetch(`${DATA_BASE}${file}?t=${Math.floor(Date.now() / 60_000)}`)
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}

export async function load(): Promise<Loaded> {
  const data = await fetchLocal<{ dir: string; people: Person[]; videos: Video[] }>('data')
  let people: Person[], videos: Video[], dir = ''
  let saved: Partial<UiState> | null
  if (data) {
    mode = 'local'
    ;({ people, videos, dir } = data)
    saved = await fetchLocal<Partial<UiState> | null>('state')
  } else {
    mode = 'online'
    people = (await fetchRemote<Person[]>('people.json')) ?? []
    videos = (await fetchRemote<Video[]>('videos.json')) ?? []
    saved = read<Partial<UiState> | null>(STATE_KEY, null)
  }
  const demo = people.length === 0 && videos.length === 0
  return {
    mode,
    dir,
    people: demo ? DEMO_PEOPLE : people,
    videos: demo ? DEMO_VIDEOS : videos,
    state: { ...EMPTY_STATE, ...saved, cfg: { ...EMPTY_STATE.cfg, ...saved?.cfg } },
    demo,
  }
}

export async function saveState(state: UiState): Promise<void> {
  if (mode === 'online') {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state))
    } catch {
      throw new Error('This browser would not store your changes.')
    }
    return
  }
  const res = await fetch(`${import.meta.env.BASE_URL}api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  })
  if (!res.ok) throw new Error('Could not save your changes to disk.')
}
