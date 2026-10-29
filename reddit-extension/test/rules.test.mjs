import test from 'node:test'
import assert from 'node:assert/strict'
import { makeItem, parseSubs, parseUsers, pickTopCommenter, postProblem, ruleFlags } from '../lib/rules.js'
import { comment, post, rules } from './fixtures.mjs'

test('reads subreddit names however they are typed', () => {
  assert.deepEqual(parseSubs('nosurf, r/digitalminimalism /r/PhoneAddiction\nhttps://www.reddit.com/r/nosurf/top/ x'),
    ['nosurf', 'digitalminimalism', 'PhoneAddiction'])
  assert.deepEqual(parseSubs(''), [])
  assert.deepEqual(parseSubs('bad-name!!, x, ok_name'), ['ok_name'])
})

test('reads usernames to skip', () => {
  assert.deepEqual([...parseUsers('u/Alice, /u/bob\ncarol')].sort(), ['alice', 'bob', 'carol'])
})

test('skips posts that are pinned, adult, closed, removed, quiet or sensitive', () => {
  const ok = post().data
  const opts = { minScore: 5, minComments: 5 }
  assert.equal(postProblem(ok, opts), '')
  assert.equal(postProblem({ ...ok, stickied: true }, opts), 'pinned')
  assert.equal(postProblem({ ...ok, over_18: true }, opts), 'adult')
  assert.equal(postProblem({ ...ok, locked: true }, opts), 'closed to comments')
  assert.equal(postProblem({ ...ok, archived: true }, opts), 'closed to comments')
  assert.equal(postProblem({ ...ok, removed_by_category: 'moderator' }, opts), 'removed')
  assert.equal(postProblem({ ...ok, author: '[deleted]' }, opts), 'deleted')
  assert.equal(postProblem({ ...ok, score: 2 }, opts), 'few upvotes')
  assert.equal(postProblem({ ...ok, num_comments: 1 }, opts), 'few comments')
  assert.equal(postProblem({ ...ok, title: 'Scrolling is how I cope with my depression' }, opts), 'sensitive topic')
  assert.equal(postProblem({ ...ok, selftext: 'my therapist says...' }, opts), 'sensitive topic')
})

test('"cutting back" on a phone is fine, self-harm is not', () => {
  const ok = post().data
  for (const title of ['Cutting my phone time in half', 'I keep cutting back and then relapsing', 'Cutting down on scrolling']) {
    assert.equal(postProblem({ ...ok, title }, {}), '', title)
  }
  for (const title of ['I have been cutting myself again', 'thoughts of self-harm and scrolling', 'I cut myself last night']) {
    assert.equal(postProblem({ ...ok, title }, {}), 'sensitive topic', title)
  }
})

test('the top commenter is the highest-scoring comment from a real person', () => {
  const children = [
    comment({ author: 'AutoModerator', body: 'Please read the rules before posting here, thank you very much.' }),
    comment({ author: 'op_user', body: 'Thanks everyone for the kind words and the great advice here.' }),
    comment({ author: 'mod_person', body: 'Reminder from the moderators about the new posting rules today.', distinguished: 'moderator' }),
    comment({ author: 'helper_bot', body: 'I am a bot and this action was performed automatically yes.' }),
    comment({ author: '[deleted]', body: 'This comment was removed by its author some time ago.' }),
    comment({ author: 'short', body: 'nice one' }),
    comment({ author: 'linker', body: 'Check out https://example.com for a great tool for this.' }),
    comment({ author: 'teen', body: "I'm 15 and my mom took my phone away so I get this." }),
    comment({ author: 'hurting', body: 'Honestly I use my phone to cope with my anxiety every night.' }),
    comment({ author: 'already_contacted', body: 'I switched my phone to grayscale and that helped quite a lot.' }),
    comment({ author: 'winner', body: 'Grayscale plus a charger outside the bedroom changed my evenings.', score: 40, permalink: '/r/x/comments/p/t/w/' }),
    comment({ author: 'runner_up', body: 'I log out of everything every night, it adds just enough friction.' }),
  ]
  const top = pickTopCommenter(children, { postAuthor: 'OP_USER', skipUsers: new Set(['already_contacted']) })
  assert.equal(top.author, 'winner')
  assert.equal(top.score, 40)
  assert.equal(top.url, 'https://www.reddit.com/r/x/comments/p/t/w/')
  assert.equal(pickTopCommenter([{ kind: 'more', data: {} }], {}), null)
  assert.equal(pickTopCommenter([], {}), null)
})

test('very long comments are shortened', () => {
  const top = pickTopCommenter([comment({ body: 'word '.repeat(600) })], {})
  assert.ok(top.body.length < 1100 && top.body.endsWith('…'))
})

test('flags subreddit rules about promotion, surveys, research or DMs', () => {
  const flagged = ruleFlags(rules([
    ['Be kind'], ['No self-promotion', 'No ads'], ['No surveys or research requests'], ['No unsolicited DMs'], ['Stay on topic', 'Keep it related'],
  ]))
  assert.deepEqual(flagged, ['No self-promotion', 'No surveys or research requests', 'No unsolicited DMs'])
  assert.deepEqual(ruleFlags(rules([['Be kind']])), [])
  assert.deepEqual(ruleFlags(null), [])
})

test('builds an item with a fallback opening line from the comment', () => {
  const top = { author: 'winner', body: 'Grayscale plus a charger outside the bedroom changed my evenings completely.', score: 40, url: 'u' }
  const item = makeItem(post().data, top, ['No self-promotion'], '2026-10-29')
  assert.equal(item.id, 'p1')
  assert.equal(item.url, 'https://www.reddit.com/r/nosurf/comments/p1/how_i_finally_cut/')
  assert.match(item.opener, /^Saw your comment on r\/nosurf about “Grayscale plus a charger/)
  assert.deepEqual([item.dmStatus, item.commentStatus, item.comment], ['To send', 'To post', ''])
  assert.equal(makeItem(post().data, null, []).opener, '')
})
