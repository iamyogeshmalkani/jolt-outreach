export const DEFAULTS = {
  subs: '',            // subreddits to look in, e.g. "nosurf, digitalminimalism" (r/ is optional)
  period: 'week',      // top posts of the 'day', 'week' or 'month'
  postsPerSub: 3,      // how many posts to keep from each subreddit
  minComments: 5,      // skip posts with fewer comments than this
  minScore: 5,         // skip posts with fewer upvotes than this
  skip: '',            // Reddit usernames you have already contacted, separated by spaces or new lines
  xaiKey: '',          // optional: lets Grok write the reply and the first line of each message
  model: '',           // empty means the default Grok model
  useAi: true,         // only matters once a key is set
  name: 'Isha',        // the message template, used for the DM
  offer: 'a year of Jolt Premium + a $3 gift card',
  body:
    "I'm {NAME} from Jolt. We help people get control of their screen time, and before we decide " +
    "what to build next, I'm talking to people about their real phone habits. " +
    "Up for a 20-min chat? As a thanks, you'd get {OFFER}.",
  subject: 'Quick question about your comment in r/{SUB}',
}

export const fill = (text, s, extra = {}) =>
  text
    .replaceAll('{NAME}', (s.name || '').trim() || '[name]')
    .replaceAll('{OFFER}', (s.offer || '').trim() || '[offer]')
    .replaceAll('{SUB}', extra.sub || '')
