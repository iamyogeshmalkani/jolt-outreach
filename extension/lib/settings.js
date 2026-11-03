import { DEFAULT_COMMENT_TOPICS, DEFAULT_KEYWORDS } from './rules.js'

export const DEFAULTS = {
  repo: 'iamyogeshmalkani/jolt-outreach',
  token: '',          // a GitHub token limited to this one repo (Contents: Read and write)
  auto: false,        // also look for videos every hour; off by default, runs are started by hand
  videosPerRun: 100,  // how many videos one run opens to check
  minComments: 20,    // a video needs at least this many comments
  minViews: 10000,    // and at least this many views (the popular ones)
  maxAgeDays: 60,     // and must be posted within this many days
  paused: false,      // set automatically when TikTok asks for a login or verification
  keywords: DEFAULT_KEYWORDS,       // the topics to search for, e.g. "digital detox"; edited in Settings
  topicsVersion: 2,   // when the default topics change, a browser that saved an older list gets the new one once
  commentsPerVideo: 300, // how many of a video's comments are read (all of them if it has fewer); every one is sent to Claude
  aiKey: '',          // a Claude (Anthropic) API key; with it, Claude decides which comments are about the writer's own habits
  aiModel: '',        // empty means the default (see llm.js)
  commentTopics: DEFAULT_COMMENT_TOPICS, // a comment is saved when it is about one of these; edited in Settings
  startHour: 8,
  endHour: 22,
}

// Settings as saved in this Chrome, filled in with the defaults. A Chrome that saved the topic list before the current default topics
// existed gets the new list once (and the old competitor lists are dropped).
export function withDefaults(stored = {}) {
  const s = { ...DEFAULTS, ...stored }
  delete s.competitors
  if (stored.topicsVersion !== DEFAULTS.topicsVersion) {
    s.keywords = DEFAULTS.keywords
    s.topicsVersion = DEFAULTS.topicsVersion
  }
  return s
}
