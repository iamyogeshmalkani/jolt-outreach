import { DEFAULT_COMPETITORS, DEFAULT_KEYWORDS } from './rules.js'

export const DEFAULTS = {
  repo: 'iamyogeshmalkani/jolt-outreach',
  token: '',          // a GitHub token limited to this one repo (Contents: Read and write)
  auto: false,        // also look for people every hour; off by default, runs are started by hand
  videosPerRun: 20,   // how many videos one run reads
  paused: false,      // set automatically when TikTok asks for a login or verification
  competitors: DEFAULT_COMPETITORS, // apps to search for and to mark people who mention them; edited in Settings
  keywords: DEFAULT_KEYWORDS,       // topic searches, e.g. "phone addiction"; edited in Settings
  startHour: 8,
  endHour: 22,
  skip: '',           // handles you have already contacted, separated by spaces or new lines
  aiProvider: 'groq', // optional: 'groq' or 'anthropic' (Claude) writes the opening line of each message
  aiKey: '',          // without a key, the built-in opening lines are used
  aiModel: '',        // empty means the provider's default
  useAi: true,        // only matters once a key is set
}
