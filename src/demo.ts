import type { Person, Video } from './types'

// Shown only until the Python script has produced real data.
const day = new Date().toISOString().slice(0, 10)

export const DEMO_PEOPLE: Person[] = [
  {
    handle: 'sample.quitter', priority: 'A', added: day, note: '',
    comment: 'Quit again for a couple days but unfortunately came back to it.',
    opener: 'Saw your comment about quitting or cutting back. How\'s that going?',
    source: 'dopamine detox · @sample.creator', url: 'https://www.tiktok.com',
  },
  {
    handle: 'sample.stopped', priority: 'A', added: day, note: '',
    comment: 'I downloaded it and it worked for a day and then stopped',
    opener: 'Saw your comment about trying to fix this and it not sticking.',
    source: 'opal app review · @sample.creator', url: 'https://www.tiktok.com',
  },
  {
    handle: 'sample.thumb', priority: 'B', added: day, note: '',
    comment: 'the other night, I was half-asleep and my thumb started scrolling from muscle memory',
    opener: 'Your comment about scrolling on autopilot really stuck with me.',
    source: 'phone addiction · @sample.creator', url: 'https://www.tiktok.com',
  },
  {
    handle: 'sample.student', priority: 'B', added: day,
    note: 'Mentions studying. Confirm they\'re 18+ before booking.',
    comment: 'I\'m HOOKED to my phone lately and it distracts me so much when I study.',
    opener: 'Saw your comment about phone time getting in the way of focus.',
    source: 'how to stop scrolling · @sample.creator', url: 'https://www.tiktok.com',
  },
]

export const DEMO_VIDEOS: Video[] = [
  {
    creator: 'sample.creator', url: 'https://www.tiktok.com', added: day, likes: '48K', comments: '1,204',
    caption: 'Why I can\'t stop doomscrolling at night #doomscrolling',
    draft: 'What\'s the hardest part for you: starting to scroll, or stopping once you\'ve started?',
    source: 'doomscrolling',
  },
  {
    creator: 'sample.detox', url: 'https://www.tiktok.com/@sample.detox', added: day, likes: '9.1K', comments: '312',
    caption: 'my dopamine detox: day 7',
    draft: 'What did you replace the scrolling with? That seems like the part most people skip.',
    source: 'dopamine detox',
  },
]
