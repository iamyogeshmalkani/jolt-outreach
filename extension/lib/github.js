// Saves results to the `data` branch of the GitHub repo using the Contents API. The hosted page reads them from there.
import { LIMITS } from './rules.js'

const enc = new TextEncoder()
const dec = new TextDecoder()
const toB64 = (text) => {
  let bin = ''
  for (const b of enc.encode(text)) bin += String.fromCharCode(b)
  return btoa(bin)
}
const fromB64 = (b64) => dec.decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)))

function explain(status, what) {
  if (status === 401) return 'GitHub did not accept the token. Make a new one in Settings.'
  if (status === 403) return `The token is not allowed to ${what}. It needs "Contents: Read and write" on the repo.`
  if (status === 404) return 'GitHub could not find the repo or its data branch. Check the repo name and the token\'s repo access.'
  return `GitHub answered ${status} when trying to ${what}.`
}

async function gh(cfg, path, init = {}) {
  return fetch(`${cfg.api ?? 'https://api.github.com'}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...init.headers,
    },
  })
}

const branch = (cfg) => cfg.branch ?? 'data'

export async function readFile(cfg, name) {
  const res = await gh(cfg, `/repos/${cfg.repo}/contents/${name}?ref=${branch(cfg)}`)
  if (res.status === 404) return { items: [], sha: null, missing: true }
  if (!res.ok) throw new Error(explain(res.status, `read ${name}`))
  const json = await res.json()
  const text = json.content ? fromB64(json.content) : await (await fetch(json.download_url)).text()
  let items = []
  try {
    items = JSON.parse(text || '[]')
  } catch {
    items = []
  }
  return { items: Array.isArray(items) ? items : [], sha: json.sha }
}

// Fresh items first, then older ones that are not already in the list.
export function mergeLists(fresh, remote, keyOf, cap) {
  const seen = new Set()
  const out = []
  for (const item of [...fresh, ...remote]) {
    const k = keyOf(item)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out.slice(0, cap)
}

async function writeMerged(cfg, name, fresh, keyOf, cap) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await readFile(cfg, name)
    if (remote.missing && attempt === 0 && !(await gh(cfg, `/repos/${cfg.repo}/branches/${branch(cfg)}`)).ok) {
      throw new Error(explain(404, name))
    }
    const merged = mergeLists(fresh, remote.items, keyOf, cap)
    const res = await gh(cfg, `/repos/${cfg.repo}/contents/${name}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Update ${name.replace('.json', '')} ${new Date().toISOString().slice(0, 16)}Z`,
        content: toB64(JSON.stringify(merged, null, 1)),
        branch: branch(cfg),
        ...(remote.sha ? { sha: remote.sha } : {}),
      }),
    })
    if (res.ok) return merged.length
    if (res.status !== 409 && res.status !== 422) throw new Error(explain(res.status, `save ${name}`))
    // Someone else saved in between: read again and merge again.
  }
  throw new Error(`Could not save ${name} after several tries because it kept changing. Try again.`)
}

export async function publish(cfg, { people = [], videos = [] }) {
  const saved = {}
  if (people.length) saved.people = await writeMerged(cfg, 'people.json', people, (p) => p.handle?.toLowerCase(), LIMITS.maxPeople)
  if (videos.length) saved.videos = await writeMerged(cfg, 'videos.json', videos, (v) => v.url, LIMITS.maxVideos)
  return saved
}

// What is already published, so the same person or video is never queued twice.
export async function fetchKnown(cfg) {
  const [people, videos] = await Promise.all([readFile(cfg, 'people.json'), readFile(cfg, 'videos.json')])
  return {
    handles: new Set(people.items.map((p) => String(p.handle).toLowerCase())),
    urls: new Set(videos.items.map((v) => v.url)),
    creators: new Set(videos.items.map((v) => String(v.creator).toLowerCase())),
  }
}

export async function checkAccess(cfg) {
  const res = await gh(cfg, `/repos/${cfg.repo}`)
  if (!res.ok) throw new Error(explain(res.status, 'open the repo'))
  const repo = await res.json()
  if (repo.permissions && repo.permissions.push === false) {
    throw new Error('The token can read the repo but not write to it. It needs "Contents: Read and write".')
  }
  await readFile(cfg, 'people.json')
  const b = await gh(cfg, `/repos/${cfg.repo}/branches/${branch(cfg)}`)
  if (!b.ok) throw new Error(`The repo has no "${branch(cfg)}" branch yet.`)
  return repo.full_name
}
