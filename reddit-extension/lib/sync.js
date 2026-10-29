// Keeps several devices in step through one JSON file in a PRIVATE GitHub repo. Nothing is ever deleted by a sync: every device
// merges what is on GitHub into what it has, then writes the combined result back, so two devices working at once both keep their changes.
export const SYNC_FILE = 'reddit-state.json'
export const MAX_ITEMS = 250 // keeps the file well under GitHub's 1 MB limit for reading through the API
export const MAX_SEEN = 3000

// What stays on each device and is never written to GitHub: keys, tokens and test overrides.
export const LOCAL_ONLY = ['aiKey', 'xaiKey', 'syncRepo', 'syncToken', 'syncApi', 'redditBase', 'aiApi']
const SYNCED_SETTINGS = ['subs', 'period', 'postsPerSub', 'minComments', 'minScore', 'skip', 'provider', 'model', 'useAi', 'name', 'offer', 'body', 'subject']

// A post has two parts people change on their own: the message to the commenter, and the reply. Each part carries the time it was last changed.
const GROUPS = [
  { keys: ['dmStatus', 'dmEdit'], at: 'dmAt' },
  { keys: ['commentStatus', 'commentEdit'], at: 'commentAt' },
]

const text = (x) => JSON.stringify(x)
// When two versions are equally new, both devices must pick the same one, or they would keep overwriting each other.
const tieBreak = (a, b) => (text(a) <= text(b) ? a : b)

export function mergeItem(a, b) {
  const base = (a.foundAt ?? 0) !== (b.foundAt ?? 0) ? ((a.foundAt ?? 0) < (b.foundAt ?? 0) ? a : b) : tieBreak(a, b)
  const out = { ...base }
  for (const { keys, at } of GROUPS) {
    const x = a[at] ?? 0
    const y = b[at] ?? 0
    const src = x > y ? a : y > x ? b : tieBreak(a, b)
    for (const k of keys) {
      if (src[k] === undefined) delete out[k] // "restore original" is a change too, and travels like any other
      else out[k] = src[k]
    }
    out[at] = Math.max(x, y)
  }
  return out
}

export function mergeItems(a = [], b = []) {
  const byId = new Map()
  for (const item of [...a, ...b]) {
    byId.set(item.id, byId.has(item.id) ? mergeItem(byId.get(item.id), item) : item)
  }
  return [...byId.values()]
    .sort((x, y) => (y.foundAt ?? 0) - (x.foundAt ?? 0) || (x.id < y.id ? -1 : 1))
    .slice(0, MAX_ITEMS)
}

const union = (a = [], b = []) => [...new Set([...a, ...b])].sort().slice(-MAX_SEEN)

export function mergeSeen(a = {}, b = {}) {
  return { posts: union(a.posts, b.posts), authors: union(a.authors, b.authors) }
}

// The newer whole set of settings wins, so one device's change is not mixed with another's.
export function mergeSettings(a = {}, b = {}) {
  const x = a.settingsAt ?? 0
  const y = b.settingsAt ?? 0
  return x > y ? a : y > x ? b : tieBreak(a, b)
}

export function mergeStates(a = {}, b = {}) {
  return {
    items: mergeItems(a.items, b.items),
    seen: mergeSeen(a.seen, b.seen),
    settings: mergeSettings(a.settings, b.settings),
  }
}

export const sameState = (a, b) => text(mergeStates(a, {})) === text(mergeStates(b, {}))

// ---- this device's data, in and out of chrome.storage.local ----
export async function readLocal(store) {
  const r = await store.get(['items', 'seen', 'settings'])
  const settings = { settingsAt: r.settings?.settingsAt ?? 0 }
  for (const k of SYNCED_SETTINGS) if (r.settings && k in r.settings) settings[k] = r.settings[k]
  return { items: r.items || [], seen: r.seen || {}, settings }
}

export async function writeLocal(store, state) {
  const { settings: current = {} } = await store.get('settings')
  const settings = { ...current }
  for (const k of SYNCED_SETTINGS) if (k in state.settings) settings[k] = state.settings[k]
  settings.settingsAt = state.settings.settingsAt ?? 0
  await store.set({ items: state.items, seen: state.seen, settings })
}

// ---- GitHub ----
const enc = new TextEncoder()
const dec = new TextDecoder()
const toB64 = (t) => {
  let bin = ''
  for (const b of enc.encode(t)) bin += String.fromCharCode(b)
  return btoa(bin)
}
const fromB64 = (b64) => dec.decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)))

function explain(status, what) {
  if (status === 401) return 'GitHub did not accept the sync token. Make a new one in Settings.'
  if (status === 403) return `The sync token is not allowed to ${what}. It needs "Contents: Read and write" on the sync repo.`
  if (status === 404) return 'GitHub could not find the sync repo, or the token cannot see it. Check the repo name and the token\'s repo access.'
  return `GitHub answered ${status} when trying to ${what}.`
}

const gh = (cfg, path, init = {}) =>
  fetch(`${cfg.api ?? 'https://api.github.com'}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...init.headers,
    },
  })

export async function readRemote(cfg) {
  let res
  try {
    res = await gh(cfg, `/repos/${cfg.repo}/contents/${SYNC_FILE}`)
  } catch {
    throw new Error('Could not reach GitHub. Check your internet connection.')
  }
  if (res.status === 404) {
    // Either the file does not exist yet, or the repo is not reachable. Telling them apart matters.
    const repo = await gh(cfg, `/repos/${cfg.repo}`)
    if (!repo.ok) throw new Error(explain(repo.status, 'open the sync repo'))
    return { data: null, sha: null }
  }
  if (!res.ok) throw new Error(explain(res.status, 'read the synced data'))
  const json = await res.json()
  if (!json.content) throw new Error('The synced file has grown too large to read. Remove some old posts.')
  try {
    return { data: JSON.parse(fromB64(json.content)), sha: json.sha }
  } catch {
    throw new Error('The synced file on GitHub could not be read. It may have been edited by hand.')
  }
}

async function writeRemote(cfg, state, sha) {
  return gh(cfg, `/repos/${cfg.repo}/contents/${SYNC_FILE}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Sync ${new Date().toISOString().slice(0, 16)}Z`,
      content: toB64(JSON.stringify({ version: 1, ...state }, null, 1)),
      ...(sha ? { sha } : {}),
    }),
  })
}

// Used by the settings page. The repo must be private, because it holds other people's usernames and what they wrote.
export async function checkSync(cfg) {
  let res
  try {
    res = await gh(cfg, `/repos/${cfg.repo}`)
  } catch {
    throw new Error('Could not reach GitHub. Check your internet connection.')
  }
  if (!res.ok) throw new Error(explain(res.status, 'open the sync repo'))
  const repo = await res.json()
  if (repo.private === false) throw new Error(`${repo.full_name} is a public repo, so anyone could read your posts and usernames. Use a private repo.`)
  if (repo.permissions && repo.permissions.push === false) throw new Error('The sync token can read the repo but not write to it. It needs "Contents: Read and write".')
  return repo.full_name
}

// One sync: merge GitHub's copy into this device's, write the combined result to both. Safe to run any time, from several places at once.
export async function syncNow(store, cfg) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await readRemote(cfg)
    const merged = mergeStates(await readLocal(store), remote.data || {})
    let pushed = false
    if (!remote.data || !sameState(merged, remote.data)) {
      const res = await writeRemote(cfg, merged, remote.sha)
      if (res.status === 409 || res.status === 422) continue // another device saved first: read again and merge again
      if (!res.ok) throw new Error(explain(res.status, 'save the synced data'))
      pushed = true
    }
    // Merge once more, in case something changed on this device while talking to GitHub.
    const latest = await readLocal(store)
    const final = mergeStates(latest, merged)
    const pulled = !sameState(final, latest)
    if (pulled) await writeLocal(store, final)
    return { pushed, pulled, items: final.items.length }
  }
  throw new Error('GitHub kept changing while syncing. Try again in a moment.')
}

// Syncs with the sync settings, remembering how it went. Never throws: a sync problem must not break anything else.
export async function syncFromSettings(store, s) {
  if (!s.syncRepo || !s.syncToken) return null
  try {
    const result = await syncNow(store, { repo: s.syncRepo.trim(), token: s.syncToken.trim(), ...(s.syncApi ? { api: s.syncApi } : {}) })
    await store.set({ syncStatus: { at: Date.now(), error: '' } })
    return result
  } catch (e) {
    await store.set({ syncStatus: { at: Date.now(), error: e.message || String(e) } })
    return null
  }
}
