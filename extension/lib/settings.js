export const DEFAULTS = {
  repo: 'iamyogeshmalkani/jolt-outreach',
  token: '',          // a GitHub token limited to this one repo (Contents: Read and write)
  enabled: true,      // look for videos every hour
  paused: false,      // set automatically when TikTok asks for a login or verification
  startHour: 8,
  endHour: 22,
  skip: '',           // handles you have already contacted, separated by spaces or new lines
  aiProvider: 'xai',  // optional: 'xai' (Grok) or 'anthropic' (Claude) writes the draft comments and opening lines
  aiKey: '',          // without a key, the built-in drafts are used
  aiModel: '',        // empty means the provider's default
  useAi: true,        // only matters once a key is set
}
