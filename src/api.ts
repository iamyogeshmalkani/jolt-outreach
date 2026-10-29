import type { Person, UiState, Video } from './types'
import { EMPTY_STATE } from './types'
import { DEMO_PEOPLE, DEMO_VIDEOS } from './demo'

export type Loaded = {
  dir: string
  people: Person[]
  videos: Video[]
  state: UiState
  demo: boolean
}

export async function load(): Promise<Loaded> {
  const [dataRes, stateRes] = await Promise.all([fetch('/api/data'), fetch('/api/state')])
  if (!dataRes.ok) throw new Error('The local data service did not respond. Start the app with npm run dev.')
  const data = (await dataRes.json()) as { dir: string; people: Person[]; videos: Video[] }
  const saved = (await stateRes.json()) as Partial<UiState> | null
  const demo = data.people.length === 0 && data.videos.length === 0
  return {
    dir: data.dir,
    people: demo ? DEMO_PEOPLE : data.people,
    videos: demo ? DEMO_VIDEOS : data.videos,
    state: { ...EMPTY_STATE, ...saved, cfg: { ...EMPTY_STATE.cfg, ...saved?.cfg } },
    demo,
  }
}

export async function saveState(state: UiState): Promise<void> {
  const res = await fetch('/api/state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  })
  if (!res.ok) throw new Error('Could not save your changes to disk.')
}
