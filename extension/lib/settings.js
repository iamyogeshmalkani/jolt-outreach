import { DEFAULT_COMPETITORS, DEFAULT_KEYWORDS } from './rules.js'

export const DEFAULTS = {
  repo: 'iamyogeshmalkani/jolt-outreach',
  token: '',          // a GitHub token limited to this one repo (Contents: Read and write)
  auto: false,        // also look for videos every hour; off by default, runs are started by hand
  videosPerRun: 100,  // how many videos one run opens to check
  minComments: 20,    // a video needs at least this many comments
  minViews: 10000,    // and at least this many views (the popular ones)
  maxAgeDays: 60,     // and must be posted within this many days
  paused: false,      // set automatically when TikTok asks for a login or verification
  competitors: DEFAULT_COMPETITORS, // apps to search for; edited in Settings
  keywords: DEFAULT_KEYWORDS,       // topic searches, e.g. "phone addiction"; edited in Settings
  startHour: 8,
  endHour: 22,
}
