import test from 'node:test'
import assert from 'node:assert/strict'
import { find } from '../lib/finder.js'
import { buildKnown, memoryCounts, remember, MAX_SEEN } from '../lib/memory.js'
import { settle } from '../lib/rules.js'
import { comment, post } from './fixtures.mjs'

const p = (id, over = {}) => post({ id, permalink: `/r/nosurf/comments/${id}/t/`, ...over }).data
const settings = (over = {}) => ({ subs: 'nosurf', period: 'week', postsPerSub: 3, minComments: 1, minScore: 1, skip: '', suggesters: 2, ...over })
const nice = (author) => comment({ author, body: `This is what ${author} thinks about cutting back on the phone, honestly it matters a lot.` })

// A Reddit whose top list never changes, with people who show up on several posts (as busy commenters do).
function steadyReddit(postCount = 12) {
  const ids = Array.from({ length: postCount }, (_, i) => `p${i}`)
  return {
    async top() { return ids.map((id) => p(id)) },
    async comments(id) { const n = Number(id.slice(1)); return [nice('busy_bee'), nice(`top${n}`), nice(`second${n}`), nice('busy_bee_two'), nice('regular')] },
    async rules() { return { rules: [] } },
  }
}

// One run, the way the extension does it: find, settle, then remember. Returns the new items and the saved state.
async function run(api, state, over = {}) {
  const known = buildKnown(state.items, state.seen)
  const { items } = await find(api, settings(over), known, async () => {})
  settle(items, 2, known.authors)
  return { items, state: { items: [...items, ...state.items], seen: remember(known, items) } }
}

test('across many runs, no post and no person is ever offered twice', async () => {
  const api = steadyReddit(12)
  let state = { items: [], seen: {} }
  const offeredPosts = []
  const offeredPeople = []
  for (let n = 0; n < 6; n++) {
    const out = await run(api, state)
    offeredPosts.push(...out.items.map((i) => i.id))
    offeredPeople.push(...out.items.flatMap((i) => i.people.map((x) => x.author.toLowerCase())))
    state = out.state
  }
  assert.equal(new Set(offeredPosts).size, offeredPosts.length, `a post came back: ${offeredPosts}`)
  assert.equal(new Set(offeredPeople).size, offeredPeople.length, `a person came back: ${offeredPeople}`)
  assert.equal(offeredPosts.length, 12, 'every post was offered exactly once, in the end')
  assert.ok(offeredPeople.includes('busy_bee') && offeredPeople.filter((x) => x === 'busy_bee').length === 1, 'someone who comments everywhere is offered once')
})

test('once everything has been seen, a run finds nothing new and says how much it skipped', async () => {
  const api = steadyReddit(5)
  let state = { items: [], seen: {} }
  for (let n = 0; n < 3; n++) state = (await run(api, state)).state
  const known = buildKnown(state.items, state.seen)
  const out = await find(api, settings(), known, async () => {})
  assert.deepEqual(out.items, [])
  assert.deepEqual(out.stats, { kept: 0, alreadySeen: 5 })
})

test('memory outlasts the list: posts and people stay remembered after old items are trimmed away', async () => {
  const api = steadyReddit(6)
  let state = { items: [], seen: {} }
  state = (await run(api, state)).state
  const trimmed = { items: [], seen: state.seen } // the list was cut down to nothing, the memory was not
  const out = await run(api, trimmed)
  assert.ok(out.items.every((i) => !state.items.some((old) => old.id === i.id)), 'no post repeated')
  const before = new Set(state.items.flatMap((i) => i.people.map((x) => x.author.toLowerCase())))
  assert.ok(out.items.flatMap((i) => i.people).every((x) => !before.has(x.author.toLowerCase())), 'no person repeated')
})

test('the list alone is enough to remember, if the saved memory is missing', async () => {
  const api = steadyReddit(6)
  const first = (await run(api, { items: [], seen: {} })).state
  const out = await run(api, { items: first.items, seen: {} })
  assert.ok(out.items.every((i) => !first.items.some((old) => old.id === i.id)))
})

test('a person you skipped, and one you have already contacted by hand, are never offered', async () => {
  const api = steadyReddit(3)
  const first = (await run(api, { items: [], seen: {} }, { postsPerSub: 1 })).state
  first.items[0].people[0].dmStatus = 'Skip'
  const skipped = first.items[0].people[0].author
  const out = await run(api, first, { skip: 'u/regular second1' })
  const offered = out.items.flatMap((i) => i.people.map((x) => x.author.toLowerCase()))
  assert.ok(!offered.includes(skipped.toLowerCase()), 'skipped person')
  assert.ok(!offered.includes('regular') && !offered.includes('second1'), 'people on the manual skip list')
})

test('names are remembered without regard to capitals', () => {
  const known = buildKnown([], { authors: ['Alice'] })
  assert.ok(known.authors.has('alice'))
  const saved = remember(known, [{ id: 'x', people: [{ author: 'BOB' }] }])
  assert.deepEqual(saved.authors.sort(), ['alice', 'bob'])
})

test('the memory is bounded, keeping the most recent', () => {
  const posts = Array.from({ length: MAX_SEEN + 50 }, (_, i) => `p${i}`)
  const saved = remember({ posts: new Set(posts), authors: new Set() }, [])
  assert.equal(saved.posts.length, MAX_SEEN)
  assert.equal(saved.posts.at(-1), `p${MAX_SEEN + 49}`)
  assert.ok(!saved.posts.includes('p0'))
})

test('counts for the settings page', () => {
  const items = [{ id: 'a', people: [{ author: 'Al' }, { author: 'bo' }] }, { id: 'b', people: [{ author: 'al' }] }]
  assert.deepEqual(memoryCounts(items, { posts: ['c'], authors: ['cy'] }), { posts: 3, people: 3 })
  assert.deepEqual(memoryCounts(), { posts: 0, people: 0 })
})
