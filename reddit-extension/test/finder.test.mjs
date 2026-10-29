import test from 'node:test'
import assert from 'node:assert/strict'
import { find } from '../lib/finder.js'
import { RedditError } from '../lib/reddit.js'
import { comment, post, rules } from './fixtures.mjs'

const settings = (over = {}) => ({ subs: 'nosurf', period: 'week', postsPerSub: 2, minComments: 5, minScore: 5, skip: '', ...over })
const known = () => ({ posts: new Set(), authors: new Set() })
const p = (id, over = {}) => post({ id, permalink: `/r/nosurf/comments/${id}/t/`, ...over }).data

// A fake Reddit: posts per subreddit, comments per post, rules per subreddit (or an error to throw).
function fakeApi({ top = {}, comments = {}, rulesBy = {} }) {
  const calls = []
  return {
    calls,
    async top(sub) { calls.push(['top', sub]); const r = top[sub]; if (r instanceof Error) throw r; return r ?? [] },
    async comments(id) { calls.push(['comments', id]); return comments[id] ?? [] },
    async rules(sub) { calls.push(['rules', sub]); const r = rulesBy[sub]; if (r instanceof Error) throw r; return r ?? { rules: [] } },
  }
}
const topComment = (author, body = 'Grayscale plus a charger outside the bedroom changed my evenings.') => [comment({ author, body })]

test('keeps the first few good posts of a subreddit and finds each one\'s top commenter', async () => {
  const api = fakeApi({
    top: { nosurf: [p('a', { stickied: true }), p('b'), p('c', { over_18: true }), p('d'), p('e')] },
    comments: { b: topComment('alice'), d: topComment('bob') },
  })
  const logs = []
  const { items, stopped } = await find(api, settings(), known(), async (l) => logs.push(l))
  assert.equal(stopped, '')
  assert.deepEqual(items.map((i) => [i.id, i.top.author]), [['b', 'alice'], ['d', 'bob']])
  assert.ok(!api.calls.some(([k, id]) => k === 'comments' && ['a', 'c', 'e'].includes(id)), 'skipped and surplus posts are never opened')
  assert.ok(logs.some((l) => /r\/nosurf: 2 posts kept \(skipped 1 pinned, 1 adult\)/.test(l)), logs.join('|'))
})

test('never picks the same person twice in a run, or someone already contacted', async () => {
  const api = fakeApi({
    top: { nosurf: [p('a'), p('b'), p('c')] },
    comments: {
      a: [...topComment('alice'), ...topComment('carol')],
      b: [...topComment('alice'), ...topComment('bob')],
      c: [...topComment('already_done'), ...topComment('dave')],
    },
  })
  const { items } = await find(api, settings({ postsPerSub: 3, skip: 'Already_Done' }), known(), async () => {})
  assert.deepEqual(items.map((i) => i.top.author), ['alice', 'bob', 'dave'])
})

test('skips posts and people from earlier runs', async () => {
  const api = fakeApi({ top: { nosurf: [p('a'), p('b')] }, comments: { a: topComment('alice'), b: topComment('bob') } })
  const k = { posts: new Set(['a']), authors: new Set(['bob']) }
  const { items } = await find(api, settings(), k, async () => {})
  assert.deepEqual(items.map((i) => i.id), ['b'])
  assert.equal(items[0].top, null, 'bob was already contacted and nobody else qualifies, so the post is kept for a reply only')
})

test('flags subreddits whose rules mention promotion', async () => {
  const api = fakeApi({
    top: { nosurf: [p('a')] }, comments: { a: topComment('alice') },
    rulesBy: { nosurf: rules([['No self-promotion', 'No ads or surveys']]) },
  })
  const { items } = await find(api, settings(), known(), async () => {})
  assert.deepEqual(items[0].flags, ['No self-promotion'])
})

test('a private or missing subreddit is skipped, and the others still run', async () => {
  const api = fakeApi({
    top: { secret: new RedditError('private', 'private or restricted'), gone: new RedditError('missing', 'not found'), nosurf: [p('a')] },
    comments: { a: topComment('alice') },
  })
  const logs = []
  const { items, stopped } = await find(api, settings({ subs: 'secret, gone, nosurf' }), known(), async (l) => logs.push(l))
  assert.equal(stopped, '')
  assert.deepEqual(items.map((i) => i.id), ['a'])
  assert.ok(logs.some((l) => /r\/secret: private or restricted, skipped/.test(l)) && logs.some((l) => /r\/gone: not found, skipped/.test(l)))
})

test('a block stops the run but keeps what was already found', async () => {
  const blocked = new RedditError('blocked', 'Reddit blocked the request.')
  const api = fakeApi({ top: { nosurf: [p('a')], second: blocked }, comments: { a: topComment('alice') } })
  const { items, stopped } = await find(api, settings({ subs: 'nosurf, second, third' }), known(), async () => {})
  assert.deepEqual(items.map((i) => i.id), ['a'])
  assert.match(stopped, /blocked/)
  assert.ok(!api.calls.some(([k, s]) => k === 'top' && s === 'third'), 'it does not carry on after a block')
})

test('a failing rules lookup does not matter, but a block on it does', async () => {
  const flaky = fakeApi({ top: { nosurf: [p('a')] }, comments: { a: topComment('alice') }, rulesBy: { nosurf: new RedditError('missing', 'x') } })
  assert.equal((await find(flaky, settings(), known(), async () => {})).items.length, 1)
  const blocked = fakeApi({ top: { nosurf: [p('a')] }, rulesBy: { nosurf: new RedditError('blocked', 'Reddit blocked the request.') } })
  const out = await find(blocked, settings(), known(), async () => {})
  assert.equal(out.items.length, 0)
  assert.match(out.stopped, /blocked/)
})

test('other errors are not swallowed', async () => {
  const api = fakeApi({ top: { nosurf: new TypeError('boom') } })
  await assert.rejects(find(api, settings(), known(), async () => {}), /boom/)
})
