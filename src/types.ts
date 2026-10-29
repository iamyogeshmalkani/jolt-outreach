export type Person = {
  handle: string
  comment: string
  priority: 'A' | 'B'
  source: string
  url: string
  note: string
  opener: string
  added: string
}

export type Video = {
  creator: string
  url: string
  caption: string
  likes: string
  comments: string
  source: string
  draft: string
  added: string
}

export type Kind = 'people' | 'videos'

export type Config = { name: string; offer: string; body: string }

export type UiState = {
  statuses: Record<string, string>
  edits: Record<string, string>
  // When an item first moved past its starting status (ISO time). Drives the "today" count.
  doneAt: Record<string, string>
  cfg: Config
}

export const STATUSES: Record<Kind, string[]> = {
  people: ['To send', 'Sent', 'Replied', 'Booked', 'Skip'],
  videos: ['To comment', 'Posted', 'Got replies', 'Moved to DM', 'Skip'],
}

// The four views in the queue. `at` lists which statuses (by position) each view shows.
export const VIEWS: Record<Kind, { label: string; at: number[] }[]> = {
  people: [
    { label: 'To do', at: [0] },
    { label: 'Sent', at: [1] },
    { label: 'Replied', at: [2, 3] },
    { label: 'Skipped', at: [4] },
  ],
  videos: [
    { label: 'To do', at: [0] },
    { label: 'Posted', at: [1] },
    { label: 'Replies', at: [2, 3] },
    { label: 'Skipped', at: [4] },
  ],
}

// Button text for moving an item from status 0, 1 and 2 to the next one.
export const NEXT_STEP: Record<Kind, string[]> = {
  people: ['Mark as sent', 'They replied', 'Interview booked'],
  videos: ['Mark as posted', 'Got replies', 'Moved to a DM'],
}

export const DAILY_LIMIT: Record<Kind, number> = { people: 25, videos: 10 }

export const DEFAULT_CFG: Config = {
  name: 'Isha',
  offer: 'a year of Jolt Premium + a $3 gift card',
  body:
    "I'm {NAME} from Jolt. We help people get control of their screen time, and before we decide " +
    "what to build next, I'm talking to people about their real phone habits. " +
    'Up for a 20-min chat? As a thanks, you\'d get {OFFER}.',
}

export const EMPTY_STATE: UiState = { statuses: {}, edits: {}, doneAt: {}, cfg: DEFAULT_CFG }
