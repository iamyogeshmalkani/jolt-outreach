// What has already been looked at, so a post or a person is never offered twice, across runs and across devices.
// Two things are remembered for good (up to a generous limit): every post that was kept, and every person who was offered.
import { upgradeItem } from './rules.js'

export const MAX_SEEN = 3000

const lower = (x) => String(x).toLowerCase()

// Everything known so far: the saved memory plus whatever is still in the list (so nothing is forgotten if either is missing).
export function buildKnown(items = [], seen = {}) {
  const current = items.map(upgradeItem)
  return {
    posts: new Set([...(seen.posts || []), ...current.map((i) => i.id)]),
    authors: new Set([...(seen.authors || []).map(lower), ...current.flatMap((i) => i.people.map((p) => lower(p.author)))]),
  }
}

// The memory to save after a run: what was known, plus every post kept and every person offered.
export function remember(known, items) {
  const posts = [...known.posts, ...items.map((i) => i.id)]
  const authors = [...known.authors, ...items.flatMap((i) => i.people.map((p) => lower(p.author)))]
  return { posts: [...new Set(posts)].slice(-MAX_SEEN), authors: [...new Set(authors)].slice(-MAX_SEEN) }
}

export const memoryCounts = (items = [], seen = {}) => {
  const known = buildKnown(items, seen)
  return { posts: known.posts.size, people: known.authors.size }
}
