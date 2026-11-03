import { DEFAULT_COMMENT_TOPICS, DEFAULT_KEYWORDS } from './rules.js'

export const DEFAULTS = {
  repo: 'iamyogeshmalkani/jolt-outreach',
  token: '',          // a GitHub token limited to this one repo (Contents: Read and write)
  auto: false,        // also look for reels every hour; off by default, runs are started by hand
  videosPerRun: 40,   // how many reels one run opens to check (kept low: Instagram is quick to restrict accounts)
  minLikes: 1000,     // a reel needs at least this many likes (when Instagram shows them) to count as popular
  maxAgeDays: 60,     // and must be posted within this many days
  paused: false,      // set automatically when Instagram asks for a login or verification
  keywords: DEFAULT_KEYWORDS, // searches, e.g. "phone addiction"; edited in Settings
  aiKey: '',          // a Claude (Anthropic) API key; with it, Claude decides which comments are about the writer's own habits
  aiModel: '',        // empty means the default (see llm.js)
  commentTopics: DEFAULT_COMMENT_TOPICS, // used when Claude is not; edited in Settings
  startHour: 8,
  endHour: 22,
}
