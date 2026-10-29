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

export type Config = { name: string; offer: string; body: string }

export type UiState = {
  statuses: Record<string, string>
  edits: Record<string, string>
  // When an item first moved past its starting status (ISO time). Drives the "today" count.
  doneAt: Record<string, string>
  cfg: Config
}

export const STATUSES = ['To send', 'Sent', 'Replied', 'Booked', 'Skip']

// The four views in the queue. `at` lists which statuses (by position) each view shows.
export const VIEWS: { label: string; at: number[] }[] = [
  { label: 'To do', at: [0] },
  { label: 'Sent', at: [1] },
  { label: 'Replied', at: [2, 3] },
  { label: 'Skipped', at: [4] },
]

// Button text for moving someone from status 0, 1 and 2 to the next one.
export const NEXT_STEP = ['Mark as sent', 'They replied', 'Interview booked']

export const DAILY_LIMIT = 25

export const DEFAULT_CFG: Config = {
  name: 'Isha',
  offer: 'a year of Jolt Premium + a $3 gift card',
  body:
    "I'm {NAME} from Jolt. We help people get control of their screen time, and before we decide " +
    "what to build next, I'm talking to people about their real phone habits. " +
    'Up for a 20-min chat? As a thanks, you\'d get {OFFER}.',
}

export const EMPTY_STATE: UiState = { statuses: {}, edits: {}, doneAt: {}, cfg: DEFAULT_CFG }
