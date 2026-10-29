export const DEFAULTS = {
  repo: 'iamyogeshmalkani/jolt-outreach',
  token: '',          // a GitHub token limited to this one repo (Contents: Read and write)
  enabled: true,      // look for people every hour
  paused: false,      // set automatically when TikTok asks for a login or verification
  startHour: 8,
  endHour: 22,
  skip: '',           // handles you have already contacted, separated by spaces or new lines
  aiProvider: 'groq', // optional: 'groq' or 'anthropic' (Claude) writes the opening line of each message
  aiKey: '',          // without a key, the built-in opening lines are used
  aiModel: '',        // empty means the provider's default
  useAi: true,        // only matters once a key is set
}
