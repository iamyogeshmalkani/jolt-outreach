import type { Done, Video } from './types'
import { videoKey } from './helpers'

// The finder saves videos to the `data` branch of the GitHub repo. This page reads them from there. Marking a video complete adds it to
// videos_done.json on the same branch (so the finder never lists it again), which needs a GitHub token kept in this browser.

// Set by the deploy workflow to "owner/name"; when you run the page on your own computer it falls back to this repo.
const REPO: string = import.meta.env.VITE_REPO ?? 'iamyogeshmalkani/jolt-outreach'
const TOKEN_KEY = 'jolt.token'
const LOCAL_DONE_KEY = 'jolt.done'
const API = 'https://api.github.com'

export const getToken = () => localStorage.getItem(TOKEN_KEY) ?? ''
export const setToken = (t: string) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY))

const readLocalDone = (): Done[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_DONE_KEY) ?? '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}
const writeLocalDone = (items: Done[]) => {
  try {
    localStorage.setItem(LOCAL_DONE_KEY, JSON.stringify(items))
  } catch {
    /* the browser would not store it; the shared copy still works */
  }
}

const headers = (accept: string): Record<string, string> => ({
  Accept: accept,
  ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
})

// Reads a list through GitHub's API, not the raw file address: the raw address sits behind a cache that can serve an old copy for minutes.
async function fetchList<T>(file: string): Promise<T[]> {
  const res = await fetch(`${API}/repos/${REPO}/contents/${file}?ref=data`, { headers: headers('application/vnd.github.raw+json') })
  if (res.status === 404) return [] // nothing saved yet
  if (res.status === 403 || res.status === 429) throw new Error('GitHub is limiting how often this page can read data. Try again in a few minutes.')
  if (!res.ok) throw new Error(`GitHub answered ${res.status} when loading ${file}.`)
  const items = await res.json()
  return Array.isArray(items) ? (items as T[]) : []
}

export type Loaded = { videos: Video[]; done: Done[] }

export async function load(): Promise<Loaded> {
  const [videos, remote] = await Promise.all([fetchList<Video>('videos_found.json'), fetchList<Done>('videos_done.json')])
  // Videos marked complete in this browser before a token was added still count.
  const known = new Set(remote.map((d) => videoKey(d.url)))
  return { videos, done: [...remote, ...readLocalDone().filter((d) => !known.has(videoKey(d.url)))] }
}

const toB64 = (text: string) => {
  let bin = ''
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b)
  return btoa(bin)
}
const fromB64 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)))

// Changes videos_done.json on GitHub: reads it, applies `change`, saves it, and tries again if someone else saved in between.
async function changeRemote(change: (items: Done[]) => Done[]): Promise<void> {
  const url = `${API}/repos/${REPO}/contents/videos_done.json`
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${url}?ref=data`, { headers: headers('application/vnd.github+json') })
    if (res.status === 401) throw new Error('GitHub did not accept the token. Make a new one in Settings.')
    if (!res.ok && res.status !== 404) throw new Error(`GitHub answered ${res.status} when reading the list.`)
    const file = res.ok ? ((await res.json()) as { sha: string; content: string }) : null
    let items: Done[] = []
    try {
      items = file ? JSON.parse(fromB64(file.content) || '[]') : []
    } catch {
      items = []
    }
    const put = await fetch(url, {
      method: 'PUT',
      headers: { ...headers('application/vnd.github+json'), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Update videos_done ${new Date().toISOString().slice(0, 16)}Z`,
        content: toB64(JSON.stringify(change(Array.isArray(items) ? items : []), null, 1)),
        branch: 'data',
        ...(file ? { sha: file.sha } : {}),
      }),
    })
    if (put.ok) return
    if (put.status === 401) throw new Error('GitHub did not accept the token. Make a new one in Settings.')
    if (put.status === 403 || put.status === 404) throw new Error('The token is not allowed to save here. It needs "Contents: Read and write" on the repo.')
    if (put.status !== 409 && put.status !== 422) throw new Error(`GitHub answered ${put.status} when saving.`)
  }
  throw new Error('Could not save because the list kept changing. Try again.')
}

// Marks a video complete (or brings it back). Returns 'shared' when saved for the finder too, 'local' when only this browser knows.
export async function setDone(url: string, on: boolean): Promise<'shared' | 'local'> {
  const key = videoKey(url)
  const pending = readLocalDone().filter((d) => videoKey(d.url) !== key) // marked here earlier, before there was a token
  const stamp = { url, at: new Date().toISOString() }
  if (!getToken()) {
    writeLocalDone(on ? [...pending, stamp] : pending)
    return 'local'
  }
  await changeRemote((items) => {
    const all = new Map(items.map((d) => [videoKey(d.url), d]))
    for (const d of pending) all.set(videoKey(d.url), d) // they reach the finder now too
    if (on) all.set(key, stamp)
    else all.delete(key)
    return [...all.values()]
  })
  writeLocalDone([])
  return 'shared'
}
