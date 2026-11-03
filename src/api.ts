import type { Done, Platform, Video } from './types'
import { videoKey } from './helpers'

// The finders save videos to the `data` branch of the GitHub repo. This page reads them from there. Marking a video complete adds it to
// the done file on the same branch (so the finder never lists it again), which needs a GitHub token kept in this browser.
// TikTok and Instagram each have their own pair of files.
const FILES: Record<Platform, { found: string; done: string; local: string }> = {
  tiktok: { found: 'videos_found.json', done: 'videos_done.json', local: 'jolt.done' },
  instagram: { found: 'instagram_found.json', done: 'instagram_done.json', local: 'jolt.done.instagram' },
}

// Set by the deploy workflow to "owner/name"; when you run the page on your own computer it falls back to this repo.
const REPO: string = import.meta.env.VITE_REPO ?? 'iamyogeshmalkani/jolt-outreach'
const TOKEN_KEY = 'jolt.token'
const API = 'https://api.github.com'

export const getToken = () => localStorage.getItem(TOKEN_KEY) ?? ''
export const setToken = (t: string) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY))

const readLocalDone = (platform: Platform): Done[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(FILES[platform].local) ?? '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}
const writeLocalDone = (platform: Platform, items: Done[]) => {
  try {
    localStorage.setItem(FILES[platform].local, JSON.stringify(items))
  } catch {
    /* the browser would not store it; the shared copy still works */
  }
}

const headers = (accept: string): Record<string, string> => ({
  Accept: accept,
  ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
})

// Reads a list through GitHub's API, not the raw file address: the raw address sits behind a cache that can serve an old copy for minutes.
// But GitHub lets an anonymous visitor make only 60 API requests an hour (per network), and reloading the page a few times is enough to
// use them up. Then the same file is read from the raw address instead, which has no such limit, and may be a few minutes old.
async function fetchList<T>(file: string): Promise<T[]> {
  const asList = (items: unknown) => (Array.isArray(items) ? (items as T[]) : [])
  const res = await fetch(`${API}/repos/${REPO}/contents/${file}?ref=data`, { headers: headers('application/vnd.github.raw+json') }).catch(() => null)
  if (res?.ok) return asList(await res.json())
  if (res?.status === 404) return [] // nothing saved yet
  // Rate limited, a bad token, or no answer: try the raw address
  const raw = await fetch(`https://raw.githubusercontent.com/${REPO}/data/${file}?t=${Math.floor(Date.now() / 60_000)}`).catch(() => null)
  if (raw?.ok) return asList(await raw.json().catch(() => []))
  if (raw?.status === 404) return []
  if (res && (res.status === 403 || res.status === 429)) throw new Error('GitHub is limiting how often this page can read data. Try again in a few minutes.')
  throw new Error(`GitHub answered ${res?.status ?? 'nothing'} when loading ${file}.`)
}

export type Loaded = { videos: Video[]; done: Done[] }

export async function load(platform: Platform): Promise<Loaded> {
  const [videos, remote] = await Promise.all([fetchList<Video>(FILES[platform].found), fetchList<Done>(FILES[platform].done)])
  // Videos marked complete in this browser before a token was added still count.
  const known = new Set(remote.map((d) => videoKey(d.url)))
  return { videos, done: [...remote, ...readLocalDone(platform).filter((d) => !known.has(videoKey(d.url)))] }
}

const toB64 = (text: string) => {
  let bin = ''
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b)
  return btoa(bin)
}
const fromB64 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)))

// Changes the done file on GitHub: reads it, applies `change`, saves it, and tries again if someone else saved in between.
async function changeRemote(platform: Platform, change: (items: Done[]) => Done[]): Promise<void> {
  const url = `${API}/repos/${REPO}/contents/${FILES[platform].done}`
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
        message: `Update ${FILES[platform].done.replace('.json', '')} ${new Date().toISOString().slice(0, 16)}Z`,
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
export async function setDone(platform: Platform, url: string, on: boolean): Promise<'shared' | 'local'> {
  const key = videoKey(url)
  const pending = readLocalDone(platform).filter((d) => videoKey(d.url) !== key) // marked here earlier, before there was a token
  const stamp = { url, at: new Date().toISOString() }
  if (!getToken()) {
    writeLocalDone(platform, on ? [...pending, stamp] : pending)
    return 'local'
  }
  await changeRemote(platform, (items) => {
    const all = new Map(items.map((d) => [videoKey(d.url), d]))
    for (const d of pending) all.set(videoKey(d.url), d) // they reach the finder now too
    if (on) all.set(key, stamp)
    else all.delete(key)
    return [...all.values()]
  })
  writeLocalDone(platform, [])
  return 'shared'
}
