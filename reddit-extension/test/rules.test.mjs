import test from 'node:test'
import assert from 'node:assert/strict'
import { makeItem, parseSubs, parseUsers, pending, pickPeople, postProblem, ruleFlags, settle, suggestionStrength, upgradeItem } from '../lib/rules.js'
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
  const { top, suggesters } = pickPeople(children, { postAuthor: 'OP_USER', skipUsers: new Set(['already_contacted']) })
  assert.equal(top.author, 'winner')
  assert.deepEqual(suggesters, [], 'no suggesters unless asked for')
  assert.equal(top.score, 40)
  assert.equal(top.url, 'https://www.reddit.com/r/x/comments/p/t/w/')
  assert.equal(pickPeople([{ kind: 'more', data: {} }], {}).top, null)
  assert.equal(pickPeople([], {}).top, null)
})

test('very long comments are shortened', () => {
  const { top } = pickPeople([comment({ body: 'word '.repeat(600) })], {})
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

test('recognises someone giving a suggestion or review, not a question or a joke', () => {
  const yes = [
    'I recommend Opal, it blocks the apps I choose until I finish my work each day.',
    'What worked for me was switching the phone to grayscale and moving social apps off the home screen.',
    "You should try putting the charger outside the bedroom, that alone changed my evenings a lot.",
    "I switched to a flip phone on weekends and honestly it's a game changer for how I spend my time.",
    'Pro tip: log out of every app each night so opening them takes effort again, it really adds friction.',
  ]
  const no = [
    'Does anyone know how to stop scrolling at night? I really cannot stop and it is getting worse.',
    'lol same, my screen time report this week was a personal attack on me and my choices',
    'Thanks for posting this, it really made my day to read all of these replies here.',
    'short one',
  ]
  for (const t of yes) assert.ok(suggestionStrength(t) > 0, t)
  for (const t of no) assert.equal(suggestionStrength(t), 0, t)
  assert.ok(suggestionStrength('I recommend Opal and grayscale, ' + 'it works for me and has for months. '.repeat(8)) > suggestionStrength('I recommend trying a quieter phone setup overall.'), 'detailed and specific scores higher')
})

test('picks the top commenter and also the strongest suggestion-givers, never the same person twice', () => {
  const children = [
    comment({ author: 'top_voice', body: 'This is exactly how I feel about my phone every single evening lately.', score: 500 }),
    comment({ author: 'asker', body: 'Does anyone know how to stop scrolling at night? I really cannot stop and it is getting worse.', score: 300 }),
    comment({ author: 'mild', body: 'I recommend trying something that adds a little bit of friction to the apps you open most.', score: 90 }),
    comment({ author: 'strong', body: 'I recommend Opal. It blocks the apps I choose until my work is done, and that worked for me for months.', score: 20 }),
    comment({ author: 'joker', body: 'lol my phone is basically glued to my hand at this point, it is very sad honestly', score: 15 }),
    comment({ author: 'also_strong', body: "What worked for me was grayscale plus a one sec style delay on every social app I use, honestly it's a game changer.", score: 10 }),
  ]
  const { top, suggesters } = pickPeople(children, { postAuthor: 'op', wantSuggesters: 2 })
  assert.equal(top.author, 'top_voice')
  const strengths = suggesters.map((c) => c.strength)
  assert.deepEqual(strengths, [...strengths].sort((x, y) => y - x), 'strongest first')
  assert.equal(suggesters.at(-1).author, 'mild', 'the weakest match is last')
  assert.equal(suggesters.length, 3, 'twice the wanted number are offered, to be confirmed or trimmed later')
  assert.ok(!suggesters.some((c) => ['top_voice', 'asker', 'joker'].includes(c.author)))
  assert.ok(suggesters.every((c) => c.strength > 0))
  assert.deepEqual(pickPeople(children, { wantSuggesters: 0 }).suggesters, [])
})

test('a suggestion-giver who is also filtered out for other reasons is not picked', () => {
  const children = [
    comment({ author: 'first', body: 'Grayscale plus a charger outside the bedroom changed my evenings completely.' }),
    comment({ author: 'teen', body: "I'm 15 and I recommend deleting tiktok, it worked for me honestly, my mom helped." }),
    comment({ author: 'linker', body: 'I recommend this app, it worked for me: https://example.com/get-it-now please try.' }),
    comment({ author: 'mod', body: 'I recommend reading the rules again before you post, it will help everyone here.', distinguished: 'moderator' }),
  ]
  assert.deepEqual(pickPeople(children, { wantSuggesters: 2 }).suggesters, [])
})

test('builds an item: the top commenter first, suggestion-givers marked tentative, each with a fallback opening line', () => {
  const top = { author: 'winner', body: 'Grayscale plus a charger outside the bedroom changed my evenings completely.', score: 40, url: 'u' }
  const sug = { author: 'helper', body: 'I recommend Opal, it worked for me for months now and I would not go back.', score: 10, url: 'u2', strength: 3 }
  const item = makeItem(post().data, { top, suggesters: [sug] }, ['No self-promotion'], '2026-10-29')
  assert.equal(item.id, 'p1')
  assert.equal(item.url, 'https://www.reddit.com/r/nosurf/comments/p1/how_i_finally_cut/')
  assert.deepEqual(item.people.map((p) => [p.author, p.why, p.dmStatus, Boolean(p.tentative)]), [['winner', 'top', 'To send', false], ['helper', 'suggestion', 'To send', true]])
  assert.match(item.people[0].opener, /^Saw your comment on r\/nosurf about “Grayscale plus a charger/)
  assert.match(item.people[1].opener, /^Saw your suggestion on r\/nosurf about “I recommend Opal/)
  assert.deepEqual([item.commentStatus, item.comment, item.flags], ['To post', '', ['No self-promotion']])
  assert.deepEqual(makeItem(post().data, {}, []).people, [])
})

test('settle keeps the best few suggestion-givers per post, drops rejected ones, and never offers anyone twice', () => {
  const p = (author, why, extra = {}) => ({ author, why, body: 'x', dmStatus: 'To send', ...extra })
  const items = [
    { people: [p('top1', 'top'), p('s1', 'suggestion', { tentative: true }), p('s2', 'suggestion', { tentative: true, verdict: false }), p('s3', 'suggestion', { tentative: true, verdict: true }), p('s4', 'suggestion', { tentative: true })] },
    { people: [p('top2', 'top'), p('S1', 'suggestion', { tentative: true }), p('s5', 'suggestion', { tentative: true })] },
  ]
  settle(items, 2)
  assert.deepEqual(items[0].people.map((x) => x.author), ['top1', 's1', 's3'], 'two suggesters kept, the rejected one dropped')
  assert.deepEqual(items[1].people.map((x) => x.author), ['top2', 's5'], 's1 was already offered on the first post')
  assert.ok(items.every((i) => i.people.every((x) => !('tentative' in x) && !('verdict' in x))))
  const again = [{ people: [p('known', 'top'), p('fresh', 'suggestion', { tentative: true })] }]
  settle(again, 2, new Set(['known']))
  assert.deepEqual(again[0].people.map((x) => x.author), ['fresh'], 'people from earlier runs are not offered again')
})

test('older single-person items are brought to the new shape without losing anything', () => {
  const old = { id: 'p1', sub: 'x', commentStatus: 'Posted', commentAt: 4, top: { author: 'alice', body: 'b', score: 3, url: 'u' }, opener: 'Hi there', dmStatus: 'Sent', dmEdit: 'my text', dmAt: 7 }
  const up = upgradeItem(old)
  assert.deepEqual(up.people, [{ author: 'alice', body: 'b', score: 3, url: 'u', why: 'top', opener: 'Hi there', dmStatus: 'Sent', dmEdit: 'my text', dmAt: 7 }])
  assert.equal(up.commentStatus, 'Posted')
  assert.ok(!('top' in up) && !('dmStatus' in up) && !('opener' in up))
  assert.deepEqual(upgradeItem({ id: 'p2', commentStatus: 'To post' }).people, [])
  assert.equal(upgradeItem(up), up, 'already current: unchanged')
})

test('a post needs attention until every message and the reply are dealt with', () => {
  const it = (people, commentStatus = 'Posted') => ({ people: people.map((dmStatus) => ({ dmStatus })), commentStatus })
  assert.equal(pending(it(['To send'])), true)
  assert.equal(pending(it(['Sent', 'To send'])), true)
  assert.equal(pending(it(['Sent', 'Skip'])), false)
  assert.equal(pending(it(['Sent'], 'To post')), true)
  assert.equal(pending(it([], 'To post')), true, 'a post with nobody to message only needs the reply')
  assert.equal(pending(it([], 'Skip')), false)
})
