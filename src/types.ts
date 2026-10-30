export type Person = {
  handle: string
  comment: string
  priority: 'A' | 'B'
  source: string
  url: string
  note: string
  opener: string
  added: string
  found?: string // when the run that found them happened; the latest run's people are tagged New
}

export type Config = { name: string; commenterBody: string; creatorBody: string }

export type UiState = {
  statuses: Record<string, string>
  edits: Record<string, string>
  // When an item first moved past its starting status (ISO time). Drives the "today" count.
  doneAt: Record<string, string>
  // Items that get the creator message instead of the commenter one.
  creators: Record<string, boolean>
  // Public replies written by the AI, by item key. A reply edited by hand is kept in `edits` instead.
  replies: Record<string, string>
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
// Button text for moving someone from status 1, 2 and 3 back to the one before it.
export const PREV_STEP = ['Unmark as sent', 'Unmark replied', 'Unmark booked']

export const DAILY_LIMIT = 25

// The public reply under a comment until one is written for it.
export const DEFAULT_REPLY =
  "That's a reality check so many of us can relate to! We're actually exploring ways at Jolt to help people spend less time scrolling and more time doing things they love. Would love to hear your thoughts as we figure out how to make that happen!"

// {NAME} is the person we write to, {ME} is you. Written messages never use em dashes.
export const DEFAULT_CFG: Config = {
  name: 'Meghan',
  commenterBody: [
    "Hey {NAME}, I'm {ME} from Jolt.",
    "We're speaking with people interested in screen-time and focus tools to understand their real experiences with phone habits and what, if anything, they'd like to change.",
    "At Jolt, we've spent the past year helping people regain control over their screen time. We're now exploring whether we could also help people make better use of some of the time they spend scrolling.",
    "It's still early, and we haven't decided what to build. We'd love to hear how people actually experience this problem before choosing a direction.",
    'Would you be open to a 30-minute research chat? As a thank-you, we\'ll give you one year of Jolt Premium (worth $99)',
    'Interested?',
  ].join('\n\n'),
  creatorBody: [
    "Hey {NAME}, I'm {ME} from Jolt. I came across your work on [specific project/topic] and thought your perspective could be useful.",
    "We're researching how people who create and consume digital content think about their attention and the time they spend on their phones.",
    "We've spent the past year helping people regain control over their screen time. Now we're exploring whether there's a useful way to help people make better use of some of that time.",
    "We haven't decided what to build, and we want to understand people's experiences before choosing a direction.",
    "Would you be open to a 20-minute research conversation? This isn't a creator partnership pitch. We're looking for candid perspectives.",
    "As a thank-you, we'll give you one year of Jolt Premium (worth $99)",
  ].join('\n\n'),
}

export const EMPTY_STATE: UiState = { statuses: {}, edits: {}, doneAt: {}, creators: {}, replies: {}, cfg: DEFAULT_CFG }
