export const DEFAULTS = {
  repo: 'iamyogeshmalkani/jolt-outreach',
  token: '',          // a GitHub token limited to this one repo (Contents: Read and write)
  enabled: true,      // look for videos every hour
  paused: false,      // set automatically when TikTok asks for a login or verification
  startHour: 8,
  endHour: 22,
  skip: '',           // handles you have already contacted, separated by spaces or new lines
}
