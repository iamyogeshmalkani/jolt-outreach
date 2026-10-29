export const DEFAULTS = {
  subs: '',            // subreddits to look in, e.g. "nosurf, digitalminimalism" (r/ is optional)
  period: 'week',      // top posts of the 'day', 'week' or 'month'
  postsPerSub: 3,      // how many posts to keep from each subreddit
  minComments: 5,      // skip posts with fewer comments than this
  minScore: 5,         // skip posts with fewer upvotes than this
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
  syncRepo: '',        // a PRIVATE GitHub repo, "owner/name", used to keep your devices in step (this device only)
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
  return s
}
