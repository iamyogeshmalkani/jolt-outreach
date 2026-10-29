// The rules for who and what is worth reaching out to. A port of the filters in jolt_outreach.py.

export const FIRST_PERSON = /\b(i|i'm|im|i’m|i've|ive|my|me|myself)\b/i
export const SELF_ACTION = /\b(quit|came back|relapsed?|deleted|downloaded|tried)\b/i
export const STRUGGLE =
  /scroll|phone|screen ?time|addict|hooked|doom|hours|hrs|can'?t stop|cant stop|can’t stop|quit|delete|focus|attention|brain|bored|habit|distract|zombie|cooked|tried|worked|limit|ignore|relapse|came back|how (do|can) (i|you)/i
export const MINOR =
  /high ?school|middle ?school|\bgrade \d+|\d+(st|nd|rd|th) grade|freshman|sophomore|my (mom|mum|dad|parents)|i'?m (1[0-7])\b|\b1[0-7] ?(yo|y\/o|years? old)|homework|teacher/i
export const SENSITIVE =
  /suicid|kill myself|self.?harm|cutting|anorex|bulimi|eating disorder|overdose|medicat|\bmeds\b|therap|trauma|abus|depress|anxiety|panic|ptsd|bipolar|numb myself|\bcope\b|coping/i
export const SEXUAL = /\b(sex|nsfw|onlyfans|nude|horny)\b/i
export const BRAND_HANDLE = /(app|official|\.io|promo|deals|steals|coupon|bot|shop|store|ugc|agency)/i
// No "i" flag, on purpose: the code pattern only matches upper-case codes.
export const PROMO = /https?:\/\/|www\.|use my code|referral|promo|(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])\b[A-Z0-9]{6,9}\b/
export const PRIORITY_A =
  /stopped working|didn'?t work|only worked|worked for|came back|relapse|tried|opal|one ?sec|brick|screenzen|freedom|forest|clearspace|jomo|headway|blinkist|ignore|bypass|5 more minutes|can'?t figure|don'?t know how|how (do|can) (i|you)|\d+ ?(hrs|hours)/i
export const STUDY = /\b(study|studying|exam|exams|class|classes|school)\b/i

export const QUERIES = [
  'opal app review', 'one sec app', 'brick phone blocker review', 'screenzen app', 'forest app focus',
  'freedom app blocker', 'clearspace app', 'jomo app', 'headway app review', 'blinkist review',
  'deepstash app', 'imprint app learning', 'brilliant app review', 'i cant stop doomscrolling',
  'my screen time is embarrassing', 'phone addiction', 'dopamine detox', 'brain rot scrolling',
  'how to stop scrolling', 'screen time reveal',
]

// One run is small on purpose: it runs every hour, so the day's total adds up without any single run being long.
export const LIMITS = {
  targetPeople: 8, peopleQueries: 2, peopleVideos: 3,
  maxPeople: 300,
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

export function isCandidate(handle, text, creator) {
  const t = (text || '').trim()
  if (!handle || handle.toLowerCase() === (creator || '').toLowerCase()) return false
  if (t.length < 20 || t.length > 280) return false
  if (BRAND_HANDLE.test(handle) || PROMO.test(t)) return false
  if (MINOR.test(t) || SENSITIVE.test(t) || SEXUAL.test(t)) return false
  return STRUGGLE.test(t) && (FIRST_PERSON.test(t) || SELF_ACTION.test(t) || /how (do|can) (i|you)/i.test(t))
}

export const priority = (text) => (PRIORITY_A.test(text) ? 'A' : 'B')

export function opener(text) {
  for (const [rx, line] of OPENERS) if (rx.test(text)) return line
  let snippet = text.trim().replace(/\n/g, ' ')
  if (snippet.length > 70) snippet = snippet.slice(0, 70).replace(/ [^ ]*$/, '') + '…'
  return `Saw your comment: “${snippet}”`
}

// ---- the shape saved to people.json (what the page reads) ----
export function makePerson(row, { creator, query, url }, today) {
  return {
    handle: row.handle,
    comment: row.text,
    priority: priority(row.text),
    source: `${query} · @${creator}`,
    url,
    note: STUDY.test(row.text) ? "Mentions studying. Confirm they're 18+ before booking." : '',
    opener: opener(row.text),
    added: today,
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

export function todayIso(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
