export const DEFAULTS = {
  subs: '',            // subreddits to look in, e.g. "nosurf, digitalminimalism" (r/ is optional)
  period: 'week',      // top posts of the 'day', 'week' or 'month'
  postsPerSub: 3,      // how many posts to keep from each subreddit
  minComments: 5,      // skip posts with fewer comments than this
  minScore: 5,         // skip posts with fewer upvotes than this
  suggesters: 2,       // besides the top commenter, message up to this many people per post who give a suggestion or review (0 turns it off)
  skip: '',            // Reddit usernames you have already contacted, separated by spaces or new lines
  provider: 'groq',    // optional AI: 'groq' or 'xai' (Grok) writes the reply and the first line of each message
  aiKey: '',           // without a key you get a plain opening line and no reply draft
  model: '',           // empty means the provider's default model
  useAi: true,         // only matters once a key is set
  name: 'Isha',        // the message template, used for the DM
  offer: 'a year of Jolt Premium + a $3 gift card',
  body:
    "I'm {NAME} from Jolt. We help people get control of their screen time, and before we decide " +
    "what to build next, I'm talking to people about their real phone habits. " +
    "Up for a 20-min chat? As a thanks, you'd get {OFFER}.",
  subject: 'Quick question about your comment in r/{SUB}',
  syncRepo: 'iamyogeshmalkani/jolt-reddit-data', // the PRIVATE GitHub repo ("owner/name") that keeps your devices in step. A token cannot say which repo it is for, so this is filled in; only change it to use another repo
  syncToken: '',       // a GitHub token with Contents: Read and write on that repo (this device only)
  settingsAt: 0,       // when the synced settings were last changed, so the newest copy wins
}

export const fill = (text, s, extra = {}) =>
  text
    .replaceAll('{NAME}', (s.name || '').trim() || '[name]')
    .replaceAll('{OFFER}', (s.offer || '').trim() || '[offer]')
    .replaceAll('{SUB}', extra.sub || '')

// Saved settings with the defaults filled in. An older version saved the key as `xaiKey` (and only knew xAI), so keep that working.
export function normalize(saved = {}) {
  const s = { ...DEFAULTS, ...saved }
  if (!s.aiKey && s.xaiKey) {
    s.aiKey = s.xaiKey
    if (!saved.provider) s.provider = s.aiKey.startsWith('gsk_') ? 'groq' : 'xai' // a key from Groq belongs to Groq, whichever box it was typed in
  }
  delete s.xaiKey
  if (!(s.syncRepo || '').trim()) s.syncRepo = DEFAULTS.syncRepo // an empty box means "the usual one"
  return s
}
