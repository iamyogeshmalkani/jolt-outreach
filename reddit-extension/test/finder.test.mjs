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
  assert.deepEqual(items.map((i) => [i.id, i.people[0].author]), [['b', 'alice'], ['d', 'bob']])
  assert.ok(!api.calls.some(([k, id]) => k === 'comments' && ['a', 'c', 'e'].includes(id)), 'skipped and surplus posts are never opened')
  assert.ok(logs.some((l) => /r\/nosurf: 2 new posts kept \(skipped 1 pinned, 1 adult\)/.test(l)), logs.join('|'))
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
  assert.deepEqual(items.map((i) => i.people[0].author), ['alice', 'bob', 'dave'])
})

test('skips posts and people from earlier runs', async () => {
  const api = fakeApi({ top: { nosurf: [p('a'), p('b')] }, comments: { a: topComment('alice'), b: topComment('bob') } })
  const k = { posts: new Set(['a']), authors: new Set(['bob']) }
  const { items } = await find(api, settings(), k, async () => {})
  assert.deepEqual(items.map((i) => i.id), ['b'])
  assert.deepEqual(items[0].people, [], 'bob was already contacted and nobody else qualifies, so the post is kept for a reply only')
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

test('also collects people who give suggestions, when asked to', async () => {
  const api = fakeApi({
    top: { nosurf: [p('a')] },
    comments: {
      a: [
        comment({ author: 'top_voice', body: 'This is exactly how I feel about my phone every single evening lately.', score: 500 }),
        comment({ author: 'asker', body: 'Does anyone know how to stop scrolling at night? I really cannot stop and it is getting worse.', score: 300 }),
        comment({ author: 'helper', body: 'I recommend Opal. It blocks the apps I choose until my work is done, and that worked for me for months.', score: 20 }),
      ],
    },
  })
  const on = await find(api, settings({ suggesters: 2 }), known(), async () => {})
  assert.deepEqual(on.items[0].people.map((x) => [x.author, x.why, Boolean(x.tentative)]), [['top_voice', 'top', false], ['helper', 'suggestion', true]])
  const off = await find(api, settings({ suggesters: 0 }), known(), async () => {})
  assert.deepEqual(off.items[0].people.map((x) => x.author), ['top_voice'])
})

test('a suggestion-giver already contacted is not offered again', async () => {
  const api = fakeApi({
    top: { nosurf: [p('a')] },
    comments: { a: [...topComment('first'), comment({ author: 'helper', body: 'I recommend Opal. It blocks the apps I choose until my work is done, and that worked for me.' })] },
  })
  const k = known()
  k.authors.add('helper')
  const { items } = await find(api, settings({ suggesters: 2 }), k, async () => {})
  assert.deepEqual(items[0].people.map((x) => x.author), ['first'])
})

test('looks for opinions about what the post is about, using the post\'s own words', async () => {
  const api = fakeApi({
    top: { nosurf: [p('a', { title: 'Opal app review: does the focus blocker reduce screen time?', selftext: 'I tested it for a month.' })] },
    comments: {
      a: [
        comment({ author: 'top_voice', body: 'This is exactly how I feel about my phone every single evening lately.', score: 500 }),
        comment({ author: 'fan', body: 'Honestly I love how Opal blocks my feed apps, my screen time dropped by half and I feel much calmer.', score: 80 }),
        comment({ author: 'offtopic', body: 'Honestly I love pizza, I think the best toppings are mushrooms and onions and I will never change.', score: 70 }),
      ],
    },
  })
  const { items } = await find(api, settings({ suggesters: 2 }), known(), async () => {})
  assert.deepEqual(items[0].people.map((x) => [x.author, x.why]), [['top_voice', 'top'], ['fan', 'opinion']])
})

test('counts the posts it skipped because they were already seen', async () => {
  const api = fakeApi({ top: { nosurf: [p('a'), p('b'), p('c')] }, comments: { c: topComment('carol') } })
  const k = { posts: new Set(['a', 'b']), authors: new Set() }
  const logs = []
  const { items, stats } = await find(api, settings({ postsPerSub: 5 }), k, async (l) => logs.push(l))
  assert.deepEqual(items.map((i) => i.id), ['c'])
  assert.deepEqual(stats, { kept: 1, alreadySeen: 2 })
  assert.ok(logs.some((l) => /1 new posts kept/.test(l)))
})
