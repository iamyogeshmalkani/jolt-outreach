// What the Instagram finder searches for, and the limits of a run. The keywords come from Settings.

// "phone addiction\ndigital detox, scrolling" -> ['phone addiction', 'digital detox', 'scrolling']. Used by the Settings page.
export function parseNames(text, max = 40) {
  const out = []
  for (const raw of String(text || '').split(/[\n,;]+/)) {
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, 60)
    if (name && !out.some((x) => x.toLowerCase() === name.toLowerCase()) && out.length < max) out.push(name)
  }
  return out
}

// What people type when the habit is on their mind. The user can change this list in Settings.
export const DEFAULT_KEYWORDS = [
  'i cant stop doomscrolling', 'my screen time is embarrassing', 'phone addiction', 'dopamine detox',
  'brain rot scrolling', 'how to stop scrolling', 'screen time reveal', 'digital detox',
  'social media addiction', 'put my phone down', 'procrastinating on my phone', 'phone ruining my focus',
  'quit social media', 'doomscrolling and anxiety', 'productivity vs scrolling',
]
export const keywordQueries = (keywords = DEFAULT_KEYWORDS) => parseNames((Array.isArray(keywords) ? keywords : []).join('\n'))

// The hashtag a keyword turns into when Instagram's search has nothing: "Phone addiction!" -> "phoneaddiction".
export const hashtagOf = (query) => String(query || '').toLowerCase().replace(/[^\p{L}\p{N}_]/gu, '')

// What a comment must be about to be saved. A comment is kept when it mentions any of these. Each entry is a word or phrase, matched
// ignoring case, spacing and hyphens ("brain rot" also finds "brainrot" and "brain-rot"), and it may be the start of a word
// ("procrastinat" finds procrastinate, procrastinating and procrastination). The user can change this list in Settings.
export const DEFAULT_COMMENT_TOPICS = [
  'screen time', 'screentime', 'screen addiction', 'high screen time', 'phone addict', 'addicted to my phone', 'addicted to scrolling',
  'social media addict', 'brain rot', 'rotting my brain', 'rotted my brain', 'doomscroll', 'doom scroll', 'scrolling', 'digital detox',
  'dopamine', 'detox', 'digital habit', 'phone habit', 'hours on my phone', 'time on my phone', 'put my phone down', 'off my phone',
  'quit social media', 'delete tiktok', 'delete instagram', 'productiv', 'unproductive', 'procrastinat', 'wasting my time',
  'wasting time', 'attention span', 'focus', 'distracted', 'distraction', 'no motivation',
]

// Never saved, whatever the topic: people who look under 18, people writing about self-harm and similar crisis topics, adult content,
// brands and promotions. The comments are for a person to read and possibly answer, so these are left out.
export const MINOR =
  /high ?school|middle ?school|\bgrade \d+|\d+(st|nd|rd|th) grade|freshman|sophomore|my (mom|mum|dad|parents)|i'?m (1[0-7])\b|\b1[0-7] ?(yo|y\/o|years? old)|homework|teacher/i
export const SENSITIVE =
  /suicid|kill myself|self.?harm|cutting myself|cut myself|cutting my (wrists?|arms?|legs?|thighs?|skin)|anorex|bulimi|eating disorder|overdose|abus/i
export const SEXUAL = /\b(sex|nsfw|onlyfans|nude|horny)\b/i
export const BRAND_HANDLE = /(app|official|\.io|promo|deals|steals|coupon|bot|shop|store|ugc|agency)/i
// No "i" flag, on purpose: the code pattern only matches upper-case codes.
export const PROMO = /https?:\/\/|www\.|use my code|referral|promo|(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])\b[A-Z0-9]{6,9}\b/

const escapeRx = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// One regex per topic. Spaces and hyphens inside a topic match any spacing, a topic must start at the start of a word, and its last word
// may continue (so "phone addict" finds "phone addiction").
export function topicMatchers(topics = DEFAULT_COMMENT_TOPICS) {
  return parseNames((Array.isArray(topics) ? topics : []).join('\n'), 100).map((topic) => ({
    topic,
    rx: new RegExp(`(?<![a-z0-9])${topic.toLowerCase().split(/[\s-]+/).filter(Boolean).map(escapeRx).join('[\\s-]*')}[a-z]*`, 'i'),
  }))
}

// Drops comments nobody should be shown: the video's own creator, very short or very long ones, repeats, and anything that fails the
// safety rules above. `rows` are { handle, text }; returns cleaned { handle, text } rows.
export function cleanComments(rows, creator = '') {
  const seen = new Set()
  const out = []
  for (const row of rows || []) {
    const handle = String(row?.handle || '').trim()
    const text = String(row?.text || '').replace(/\s+/g, ' ').trim()
    const key = `${handle.toLowerCase()}\n${text.toLowerCase()}`
    if (!handle || handle.toLowerCase() === String(creator).toLowerCase() || seen.has(key)) continue
    if (text.length < LIMITS.minCommentChars || text.length > LIMITS.maxCommentChars) continue
    if (BRAND_HANDLE.test(handle) || PROMO.test(text) || MINOR.test(text) || SENSITIVE.test(text) || SEXUAL.test(text)) continue
    seen.add(key)
    out.push({ handle, text })
  }
  return out
}

// From cleaned comments, the ones that mention any of the topics, each with the topics it matched (without Claude, this is the check).
export function matchTopics(rows, topics = DEFAULT_COMMENT_TOPICS) {
  const matchers = topicMatchers(topics)
  const out = []
  for (const row of rows) {
    const hit = matchers.filter((m) => m.rx.test(row.text)).map((m) => m.topic)
    if (hit.length) out.push({ ...row, topics: hit.slice(0, 5) })
  }
  return out
}

// Both steps together: the comments read off one video that are about the topics.
export const pickComments = (rows, creator = '', topics = DEFAULT_COMMENT_TOPICS) => matchTopics(cleanComments(rows, creator), topics)

// A cheap, free first look before Claude: only comments that mention the topics or a wider set of phone and screen words are worth
// sending, so most comments (reactions, jokes about the video, chatter) never cost a token.
const HABIT_WORDS = /phone|scroll|screen|tiktok|insta|reels|social media|youtube|app\b|apps\b|online|notification|addict|brain|focus|attention|distract|sleep|procrastinat|productiv|detox|dopamine|hours|unproductive|lazy|motivat|wast|habit|quit|delete|limit|bored|rot\b|rotting|rotted/i
export function likelyAboutHabits(rows, topics = DEFAULT_COMMENT_TOPICS) {
  const matchers = topicMatchers(topics)
  return rows.filter((row) => HABIT_WORDS.test(row.text) || matchers.some((m) => m.rx.test(row.text)))
}

// Labels rows Claude kept with the comment topics they mention, or a plain label when none (Claude's answer carries no label, to save tokens).
export function labelTopics(rows, topics = DEFAULT_COMMENT_TOPICS) {
  const matchers = topicMatchers(topics)
  return rows.map((row) => {
    const hit = matchers.filter((m) => m.rx.test(row.text)).map((m) => m.topic).slice(0, 5)
    return { handle: row.handle, text: row.text, topics: hit.length ? hit : ['digital habits'] }
  })
}

// Technical limits of a run. What counts as a good reel (age, likes) is a setting, see settings.js.
export const LIMITS = {
  maxVideos: 100,    // the most reels one run may open
  targetVideos: 30,  // a run stops once it has found this many
  maxFails: 4,       // reels in a row that fail to open before the run gives up
  rejectDays: 7,     // a reel with too few likes is not opened again for this long
  maxFound: 500,     // the most reels kept in the list
  topComments: 50,   // only the first this-many comments of each reel are read
  minCommentChars: 12, // shorter comments are too short to tell what they are about
  maxCommentChars: 400,
}

// ---- a reel's address ----
// https://www.instagram.com/reel/DAbC123xyz_/  ->  "DAbC123xyz_" (also /p/ and /tv/ addresses, and /username/reel/...)
export const shortcodeOf = (url) => (/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{5,})/.exec(String(url || '')) || [])[1] || ''
// A reel is known by its shortcode, which never changes. Falls back to the address itself.
export const videoKey = (url) => shortcodeOf(url) || String(url || '')
// The one address form that is saved, whatever form the link was found in.
export const reelUrl = (url) => (shortcodeOf(url) ? `https://www.instagram.com/reel/${shortcodeOf(url)}/` : String(url || ''))

// An Instagram post id is a number whose upper bits are the posting time (milliseconds since 2011-08-24, shifted left 23 bits), and
// the shortcode is that number written in a 64-character alphabet. So the posting time is readable without opening the page.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const EPOCH_MS = 1314220021721n
// ISO time the reel was posted, or null when the shortcode does not decode to a believable time.
export function videoPosted(url, now = Date.now()) {
  const code = shortcodeOf(url).slice(0, 11)
  if (code.length < 9) return null
  let id = 0n
  for (const ch of code) {
    const v = ALPHABET.indexOf(ch)
    if (v < 0) return null
    id = id * 64n + BigInt(v)
  }
  const ms = Number((id >> 23n) + EPOCH_MS)
  return ms > Number(EPOCH_MS) + 86_400_000 && ms < now + 86_400_000 ? new Date(ms).toISOString() : null
}
// Days since the reel was posted, or null when unknown (then the reel is not filtered out by age).
export function videoAgeDays(url, now = Date.now()) {
  const at = videoPosted(url, now)
  return at ? (now - Date.parse(at)) / 86_400_000 : null
}

// Instagram shows counts like "40", "1,234", "1.2K" or "3M".
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
