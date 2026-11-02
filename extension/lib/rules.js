// What the finder searches for, and the limits of a run. The searches come from Settings.

// The apps people compare us with, in three groups. The user can change these lists in Settings.
export const COMPETITOR_GROUPS = [
  { key: 'screenTime', label: 'Screen-time apps' },
  { key: 'learn', label: 'Learn apps' },
  { key: 'play', label: 'Play apps' },
]
export const DEFAULT_COMPETITORS = {
  screenTime: ['Opal', 'one sec', 'Brick', 'ScreenZen', 'Apple Screen Time', 'Freedom', 'Forest', 'Clearspace', 'Jomo'],
  learn: ['Empirio', 'Headway', 'Blinkist', 'Deepstash', 'Paladin', 'Imprint'],
  play: ['Matiks', 'Brilliant'],
}

// "Opal\none sec, Brick" -> ['Opal', 'one sec', 'Brick']. Used by the Settings page.
export function parseNames(text, max = 40) {
  const out = []
  for (const raw of String(text || '').split(/[\n,;]+/)) {
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, 60)
    if (name && !out.some((x) => x.toLowerCase() === name.toLowerCase()) && out.length < max) out.push(name)
  }
  return out
}

export function competitorNames(competitors = DEFAULT_COMPETITORS) {
  const all = COMPETITOR_GROUPS.flatMap((g) => (Array.isArray(competitors?.[g.key]) ? competitors[g.key] : []))
  return parseNames(all.join('\n'))
}

// Topic searches: what people type when the habit is on their mind. The user can change this list in Settings.
export const DEFAULT_KEYWORDS = [
  'i cant stop doomscrolling', 'my screen time is embarrassing', 'phone addiction', 'dopamine detox',
  'brain rot scrolling', 'how to stop scrolling', 'screen time reveal', 'digital detox',
  'social media addiction', 'put my phone down', 'procrastinating on my phone', 'phone ruining my focus',
  'quit social media', 'doomscrolling and anxiety', 'productivity vs scrolling',
]
export const competitorQueries = (competitors = DEFAULT_COMPETITORS) => competitorNames(competitors).map((n) => `${n} app review`)
export const keywordQueries = (keywords = DEFAULT_KEYWORDS) => parseNames((Array.isArray(keywords) ? keywords : []).join('\n'))
export const buildQueries = (competitors = DEFAULT_COMPETITORS, keywords = DEFAULT_KEYWORDS) => [
  ...competitorQueries(competitors),
  ...keywordQueries(keywords),
]
export const QUERIES = buildQueries()

// Technical limits of a run. What counts as a good video (age, views, comments) is a setting, see settings.js.
export const LIMITS = {
  maxVideos: 100,    // the most videos one run may open
  targetVideos: 40,  // a run stops once it has found this many
  maxFails: 5,       // videos in a row that fail to open before the run gives up
  rejectDays: 7,     // a video with too few comments is not opened again for this long
  maxFound: 500,     // the most videos kept in the list
}

// A video's number: the part of its address that never changes, even if the creator renames their account.
export const videoKey = (url) => (/\/video\/(\d+)/.exec(String(url || '')) || [])[1] || String(url || '')

// When a TikTok video was posted. Its id starts with the posting time (seconds since 1970, shifted left 32 bits), so no page needs
// opening. Returns null when the address has no readable id.
export function videoPosted(url) {
  const id = (/\/video\/(\d{18,20})/.exec(String(url || '')) || [])[1]
  return id ? new Date(Number(BigInt(id) >> 32n) * 1000).toISOString() : null
}
// Days since the video was posted, or null when unknown (then the video is not filtered out by age).
export function videoAgeDays(url, now = Date.now()) {
  const at = videoPosted(url)
  return at ? (now - Date.parse(at)) / 86_400_000 : null
}

// TikTok shows counts like "40", "1,234", "1.2K" or "3M".
export function parseCount(text) {
  const m = /^\s*([\d.,]+)\s*([KMB])?\s*$/i.exec(String(text || ''))
  if (!m) return null
  const num = parseFloat(m[2] ? m[1].replace(',', '.') : m[1].replace(/,/g, ''))
  if (Number.isNaN(num)) return null
  return Math.round(num * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1))
}

// ---- helpers ----
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export function shuffled(arr, seed = Math.floor(Math.random() * 2 ** 32)) {
  const r = rng(seed)
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
export const hourSeed = () => Math.floor(Date.now() / 3_600_000)
export const pickQueries = (pool, n, seed = hourSeed()) => shuffled(pool, seed).slice(0, n)

// A run searches both kinds: about half competitor searches and half keyword searches, so the many competitors
// don't crowd out the keywords. If one list is empty the run uses the other.
export function pickRunQueries(competitors, keywords, n, seed = hourSeed()) {
  const c = competitorQueries(competitors)
  const k = keywordQueries(keywords)
  if (!c.length || !k.length) return pickQueries([...c, ...k], n, seed)
  const fromC = Math.min(c.length, Math.ceil(n / 2))
  const fromK = Math.min(k.length, n - fromC)
  return [...pickQueries(c, fromC, seed), ...pickQueries(k, fromK, seed + 1)]
}
