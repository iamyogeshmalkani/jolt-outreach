// The rules for who and what is worth reaching out to. A port of the filters in jolt_outreach.py.

export const MINOR =
  /high ?school|middle ?school|\bgrade \d+|\d+(st|nd|rd|th) grade|freshman|sophomore|my (mom|mum|dad|parents)|i'?m (1[0-7])\b|\b1[0-7] ?(yo|y\/o|years? old)|homework|teacher/i
// Crisis topics only. Everyday mental-health words (anxiety, depression, therapy, trauma, panic, medication, coping) are allowed through
// to the AI, because people often describe their phone habit that way. Messaging someone who is writing about self-harm, suicide, an
// eating disorder or abuse is never appropriate, so those stay blocked here and the AI is told to reject them too.
export const SENSITIVE =
  /suicid|kill myself|self.?harm|cutting myself|cut myself|cutting my (wrists?|arms?|legs?|thighs?|skin)|anorex|bulimi|eating disorder|overdose|abus/i
export const SEXUAL = /\b(sex|nsfw|onlyfans|nude|horny)\b/i
export const BRAND_HANDLE = /(app|official|\.io|promo|deals|steals|coupon|bot|shop|store|ugc|agency)/i
// No "i" flag, on purpose: the code pattern only matches upper-case codes.
export const PROMO = /https?:\/\/|www\.|use my code|referral|promo|(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])\b[A-Z0-9]{6,9}\b/
// Phrases that show someone has already tried to fix this. Mentioning a competitor (see mentionsCompetitor) counts too.
export const PRIORITY_A =
  /stopped working|didn'?t work|only worked|worked for|came back|relapse|tried|ignore|bypass|5 more minutes|can'?t figure|don'?t know how|how (do|can) (i|you)|\d+ ?(hrs|hours)/i
export const STUDY = /\b(study|studying|exam|exams|class|classes|school)\b/i

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

const escapeRx = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// True when the text names one of the competitors as a whole word, ignoring case and spacing ("one sec", "onesec").
export function mentionsCompetitor(text, names) {
  if (!names.length) return false
  const body = names.map((n) => n.trim().split(/\s+/).map(escapeRx).join('\\s*')).join('|')
  return new RegExp(`(?<![a-z0-9])(?:${body})(?![a-z0-9])`, 'i').test(text || '')
}

// A run is started by hand, a few times a day, so it can be long. How many videos it reads is a setting (videosPerRun).
export const LIMITS = {
  targetPeople: 40,  // a run stops once it has this many people
  minComments: 2,    // a video with fewer comments than this is flagged and skipped
  regrow: 5,         // a video read before is read again only once it has this many more comments
  maxFails: 5,       // videos in a row that fail to open or load before the run gives up
  maxPeople: 300,
}

// TikTok shows counts like "40", "1,234", "1.2K" or "3M".
export function parseCount(text) {
  const m = /^\s*([\d.,]+)\s*([KMB])?\s*$/i.exec(String(text || ''))
  if (!m) return null
  const num = parseFloat(m[2] ? m[1].replace(',', '.') : m[1].replace(/,/g, ''))
  if (Number.isNaN(num)) return null
  return Math.round(num * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1))
}

const OPENERS = [
  [/can'?t stop|cant stop|can’t stop|cannot stop/i, 'Saw your comment about not being able to stop scrolling.'],
  [/how (do|can) (i|you)/i, 'Saw you asking how to actually break the scrolling habit.'],
  [/stopped working|didn'?t work|only worked|worked for|tried/i, 'Saw your comment about trying to fix this and it not sticking.'],
  [/quit|delet/i, "Saw your comment about quitting or cutting back. How's that going?"],
  [/bored/i, 'Your comment about boredom and scrolling really stuck with me.'],
  [/focus|distract|study/i, 'Saw your comment about phone time getting in the way of focus.'],
  [/\d+ ?(hrs|hours)|hours/i, 'Saw your comment about how many hours you spend on your phone.'],
]

// The cheap checks that run before any AI sees a comment: who wrote it, how long it is, and what must never be contacted.
// Whether the comment is really about the person's own habit is decided by the AI (llm.js, pickRelevant).
export function isCandidate(handle, text, creator) {
  const t = (text || '').trim()
  if (!handle || handle.toLowerCase() === (creator || '').toLowerCase()) return false
  if (t.length < 20 || t.length > 280) return false
  if (BRAND_HANDLE.test(handle) || PROMO.test(t)) return false
  if (MINOR.test(t) || SENSITIVE.test(t) || SEXUAL.test(t)) return false
  return true
}

export const priority = (text, names = competitorNames()) => (PRIORITY_A.test(text) || mentionsCompetitor(text, names) ? 'A' : 'B')

export function opener(text) {
  for (const [rx, line] of OPENERS) if (rx.test(text)) return line
  let snippet = text.trim().replace(/\n/g, ' ')
  if (snippet.length > 70) snippet = snippet.slice(0, 70).replace(/ [^ ]*$/, '') + '…'
  return `Saw your comment: “${snippet}”`
}

// ---- the shape saved to people.json (what the page reads) ----
// `runAt` is the same for everyone a run finds; the page tags the people from the latest run as New.
export function makePerson(row, { creator, query, url, runAt, names }, today) {
  return {
    handle: row.handle,
    comment: row.text,
    priority: priority(row.text, names),
    source: `${query} · @${creator}`,
    url,
    note: STUDY.test(row.text) ? "Mentions studying. Confirm they're 18+ before booking." : '',
    opener: opener(row.text),
    added: today,
    found: runAt,
  }
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

export function todayIso(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
