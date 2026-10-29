// What is worth reaching out about, and who. Everything here is a plain function so it can be tested without Reddit.

export const SENSITIVE =
  /suicid|kill myself|self.?harm|cutting myself|cut myself|cutting my (wrists?|arms?|legs?|thighs?|skin)|anorex|bulimi|eating disorder|overdose|medicat|\bmeds\b|therap|trauma|abus|depress|anxiety|panic|ptsd|bipolar|numb myself|\bcope\b|coping/i
export const MINOR =
  /high ?school|middle ?school|\bgrade \d+|\d+(st|nd|rd|th) grade|freshman|sophomore|my (mom|mum|dad|parents)|i'?m (1[0-7])\b|\b1[0-7] ?(yo|y\/o|years? old)|homework|teacher/i
export const SEXUAL = /\b(sex|nsfw|onlyfans|nude|horny)\b/i
export const LINK = /https?:\/\/|www\./i
// Subreddit rules that suggest asking the moderators first.
export const RULE_WORDS = /promot|advertis|solicit|survey|research|self.?promo|recruit|\bdms?\b|private message|unsolicited/i

export const MAX_BODY = 1000

// "r/nosurf, /r/digitalminimalism https://www.reddit.com/r/phoneaddiction/" -> ['nosurf', 'digitalminimalism', 'phoneaddiction']
export function parseSubs(text) {
  const out = []
  for (const raw of String(text || '').split(/[\s,;]+/)) {
    const name = raw.trim().replace(/^https?:\/\/(www\.|old\.)?reddit\.com/i, '').replace(/^\/?r\//i, '').replace(/\/.*$/, '')
    if (/^[A-Za-z0-9_]{2,21}$/.test(name) && !out.some((x) => x.toLowerCase() === name.toLowerCase())) out.push(name)
  }
  return out
}

export const parseUsers = (text) =>
  new Set(String(text || '').split(/[\s,;]+/).map((u) => u.trim().replace(/^\/?u\//i, '').toLowerCase()).filter(Boolean))

const looksLikeBot = (name) => /bot$/i.test(name) || /^automoderator$/i.test(name)

// Why a post should be skipped, or '' if it is fine.
export function postProblem(p, { minScore = 0, minComments = 0 } = {}) {
  if (p.stickied) return 'pinned'
  if (p.over_18) return 'adult'
  if (p.locked || p.archived) return 'closed to comments'
  if (p.removed_by_category) return 'removed'
  if (!p.author || p.author === '[deleted]') return 'deleted'
  if ((p.score ?? 0) < minScore) return 'few upvotes'
  if ((p.num_comments ?? 0) < minComments) return 'few comments'
  const text = `${p.title || ''} ${p.selftext || ''}`
  if (SENSITIVE.test(text) || SEXUAL.test(text)) return 'sensitive topic'
  return ''
}

// The highest-scoring top-level comment from a real person: not the poster, not a moderator or bot, not someone already contacted.
export function pickTopCommenter(children, { postAuthor = '', skipUsers = new Set() } = {}) {
  for (const child of children || []) {
    if (child?.kind !== 't1') continue
    const c = child.data || {}
    const body = (c.body || '').trim()
    const author = c.author || ''
    if (!author || author === '[deleted]' || looksLikeBot(author)) continue
    if (author.toLowerCase() === postAuthor.toLowerCase() || skipUsers.has(author.toLowerCase())) continue
    if (c.distinguished || c.stickied) continue
    if (!body || body === '[removed]' || body === '[deleted]' || body.length < 20) continue
    if (LINK.test(body) || MINOR.test(body) || SENSITIVE.test(body) || SEXUAL.test(body)) continue
    return {
      author,
      body: body.length > MAX_BODY ? body.slice(0, MAX_BODY).replace(/\s+\S*$/, '') + '…' : body,
      score: c.score ?? 0,
      url: c.permalink ? `https://www.reddit.com${c.permalink}` : '',
    }
  }
  return null
}

// Names of the subreddit's rules that mention promotion, surveys, research or DMs.
export function ruleFlags(rulesJson) {
  return (rulesJson?.rules || [])
    .filter((r) => RULE_WORDS.test(`${r.short_name || ''} ${r.description || ''}`))
    .map((r) => r.short_name)
    .filter(Boolean)
    .slice(0, 3)
}

const snippet = (text, n) => {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t
}

export function makeItem(post, top, flags, today = new Date().toISOString().slice(0, 10)) {
  return {
    id: post.id,
    sub: post.subreddit,
    title: post.title,
    body: snippet(post.selftext || '', 700),
    url: `https://www.reddit.com${post.permalink}`,
    score: post.score ?? 0,
    comments: post.num_comments ?? 0,
    flags,
    top,
    comment: '',
    opener: top ? `Saw your comment on r/${post.subreddit} about “${snippet(top.body, 60)}”.` : '',
    dmStatus: 'To send',
    commentStatus: 'To post',
    dmAt: 0, // when the message part and the reply part were last changed: syncing keeps the newest of each
    commentAt: 0,
    foundAt: Date.now(),
    added: today,
  }
}

export function shuffled(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
