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

// A comment from a real person we could write to: not the poster, a moderator, a bot or someone already contacted; long enough
// to say something; no links; nothing that suggests a minor or a sensitive topic. Returns the cleaned comment, or null.
export function usableComment(child, { postAuthor = '', skipUsers = new Set() } = {}) {
  if (child?.kind !== 't1') return null
  const c = child.data || {}
  const body = (c.body || '').trim()
  const author = c.author || ''
  if (!author || author === '[deleted]' || looksLikeBot(author)) return null
  if (author.toLowerCase() === postAuthor.toLowerCase() || skipUsers.has(author.toLowerCase())) return null
  if (c.distinguished || c.stickied) return null
  if (!body || body === '[removed]' || body === '[deleted]' || body.length < 20) return null
  if (LINK.test(body) || MINOR.test(body) || SENSITIVE.test(body) || SEXUAL.test(body)) return null
  return {
    author,
    body: body.length > MAX_BODY ? body.slice(0, MAX_BODY).replace(/\s+\S*$/, '') + '…' : body,
    score: c.score ?? 0,
    url: c.permalink ? `https://www.reddit.com${c.permalink}` : '',
  }
}

// Language of someone giving a recommendation, a tip, a review or what worked for them.
const SUGGESTION_PHRASES = [
  /\b(i|we)('d| would| highly| definitely| can| can't)? (strongly )?recommend/i,
  /\b(you should|you could|you might want|you can try|you may want|try (using|out|turning|switching|deleting|setting|the)|consider (using|trying|getting))\b/i,
  /\b(works?|worked|working) (for me|really well|great|wonders)\b/i,
  /\b(helped|helps) (me|a lot|so much)\b/i,
  /\b(what (helped|worked|works|i did)|here'?s what|my (advice|tips?|suggestion|routine|setup)|pro.?tip|tip:|for what it'?s worth)\b/i,
  /\bi (use|used|switched|swapped|installed|downloaded|deleted|uninstalled|set up|turned off|turned on|blocked|replaced|bought)\b/i,
  /\bi('ve| have) (been using|found|tried|started|stopped|switched|deleted|blocked)\b/i,
  /\b(game.?changer|life.?changing|worth (it|trying)|can'?t go back|highly effective)\b/i,
]
// Things people tend to recommend for phone habits. Mentioning one makes a suggestion more likely to be a real one.
const SUGGESTION_TOPICS = /\b(opal|one ?sec|brick|screenzen|forest|freedom|clearspace|jomo|cold turkey|appblock|stayfree|digital wellbeing|screen ?time|focus mode|grayscale|greyscale|dumb ?phone|flip phone|light phone|kindle|app limit|downtime|blocker|launcher)\b/i

// 0 means it does not look like a suggestion or review; higher means more clearly one.
export function suggestionStrength(body) {
  if ((body || '').length < 40) return 0
  const hits = SUGGESTION_PHRASES.filter((rx) => rx.test(body)).length
  if (!hits) return 0
  return hits + (SUGGESTION_TOPICS.test(body) ? 1 : 0) + (body.length > 200 ? 1 : 0)
}

// Language of someone praising, criticising or giving their take on something.
const OPINION_PHRASES = [
  /\bi (really |absolutely |totally |honestly )?(love|like|enjoy|hate|dislike|prefer|adore|appreciate)\b/i,
  /\bi (think|feel|believe|find|reckon|disagree|agree)\b/i,
  /\b(in my (opinion|experience)|imo|imho|honestly|personally|to me)\b/i,
  /\b(it'?s|it is|this is|that'?s|they'?re|these are) (so |really |very |super |pretty |quite |way |just )?(great|good|amazing|awesome|terrible|awful|bad|useless|overrated|underrated|worthless|brilliant|helpful|powerful|impressive|disappointing|nice|fantastic|annoying)\b/i,
  /\b(not worth|worth (it|the|every)|waste of|overhyped|can'?t live without|changed my life|so much (better|calmer|easier|worse))\b/i,
  /\b(pros?|cons?|downside|upside|drawback|benefit|advantage)\b/i,
]

// Words too common to show that a comment is about the same thing as a post.
const COMMON = new Set(('about after again also and any are because been before being but can could did does doing dont down each even every for from get got had has have having here him how into its just like make many more most much not now off one only other our out over really same she should some such than that the their them then there these they this those through too under until very was way were what when where which while who why will with would you your').split(' '))
const wordsOf = (t) => new Set((String(t || '').toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !COMMON.has(w)))
const sharedWords = (a, b) => {
  const wa = wordsOf(a)
  return [...wordsOf(b)].filter((w) => wa.has(w)).length
}

// An opinion only counts if it is about what the post is about, so it must share real words with the post.
export function opinionStrength(body, postText) {
  if ((body || '').length < 60) return 0
  const hits = OPINION_PHRASES.filter((rx) => rx.test(body)).length
  if (!hits) return 0
  const shared = sharedWords(postText, body)
  if (!shared) return 0
  return hits + (shared >= 2 ? 1 : 0) + (body.length > 200 ? 1 : 0)
}

// Does the comment give a suggestion, a review, praise or an opinion about the post's subject? How strongly, and which kind?
export function reaction(body, postText) {
  const suggestion = suggestionStrength(body)
  const opinion = opinionStrength(body, postText)
  if (!suggestion && !opinion) return null
  return { strength: Math.max(suggestion, opinion), why: suggestion >= opinion ? 'suggestion' : 'opinion' }
}

// The top commenter, plus (if `wantSuggesters` is above 0) a few other commenters who look like they are giving a suggestion, a review, praise or an opinion about the post's subject.
// The suggesters are tentative: they can be confirmed by the AI and are trimmed to the wanted number later by settle().
export function pickPeople(children, { postAuthor = '', postText = '', skipUsers = new Set(), wantSuggesters = 0 } = {}) {
  const usable = (children || []).map((c) => usableComment(c, { postAuthor, skipUsers })).filter(Boolean)
  const [top, ...rest] = usable
  const suggesters = wantSuggesters > 0
    ? rest
        .map((c) => ({ ...c, ...reaction(c.body, postText) }))
        .filter((c) => c.strength > 0)
        .sort((x, y) => y.strength - x.strength || y.score - x.score)
        .slice(0, wantSuggesters * 2)
    : []
  return { top: top || null, suggesters }
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

export function makePerson(c, why, sub) {
  return {
    author: c.author,
    body: c.body,
    score: c.score,
    url: c.url,
    why, // 'top' (the highest-scoring comment), 'suggestion' (a recommendation or review) or 'opinion' (praise, criticism or a take on the post's subject)
    ...(c.strength ? { strength: c.strength } : {}),
    opener: `Saw your ${{ suggestion: 'suggestion', opinion: 'thoughts' }[why] ?? 'comment'} on r/${sub} about “${snippet(c.body, 60)}”.`,
    dmStatus: 'To send',
    dmAt: 0, // when this person's message was last changed: syncing keeps the newest
  }
}

export function makeItem(post, { top = null, suggesters = [] } = {}, flags = [], today = new Date().toISOString().slice(0, 10)) {
  return {
    id: post.id,
    sub: post.subreddit,
    title: post.title,
    body: snippet(post.selftext || '', 700),
    url: `https://www.reddit.com${post.permalink}`,
    score: post.score ?? 0,
    comments: post.num_comments ?? 0,
    flags,
    people: [
      ...(top ? [makePerson(top, 'top', post.subreddit)] : []),
      ...suggesters.map((c) => ({ ...makePerson(c, c.why ?? 'suggestion', post.subreddit), tentative: true })),
    ],
    comment: '',
    commentStatus: 'To post',
    commentAt: 0, // when the reply part was last changed
    foundAt: Date.now(),
    added: today,
  }
}

// Old items had one person in `top` with the message status on the item itself. Bring them to the current shape.
export function upgradeItem(it) {
  if (it.people) return it
  const { top, opener, dmStatus, dmEdit, dmAt, ...rest } = it
  return {
    ...rest,
    people: top
      ? [{ ...top, why: 'top', opener: opener || '', dmStatus: dmStatus ?? 'To send', ...(dmEdit !== undefined ? { dmEdit } : {}), dmAt: dmAt ?? 0 }]
      : [],
  }
}

// After the AI has had its say: drop any suggester it rejected (verdict === false), keep the best few per post, and never offer the
// same person twice across posts. Marks everyone as settled.
export function settle(items, perPost, seenAuthors = new Set()) {
  const taken = new Set(seenAuthors)
  for (const item of items) {
    const kept = []
    let suggesters = 0
    for (const p of item.people) {
      const key = p.author.toLowerCase()
      if (taken.has(key) || p.verdict === false) continue
      if (p.tentative) {
        if (suggesters >= perPost) continue
        suggesters++
      }
      taken.add(key)
      const { tentative, verdict, ...clean } = p
      kept.push(clean)
    }
    item.people = kept
  }
  return items
}

// A post still needs attention if a person has not been messaged yet, or the reply has not been posted.
export const pending = (it) => it.people.some((p) => p.dmStatus === 'To send') || it.commentStatus === 'To post'

export function shuffled(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
