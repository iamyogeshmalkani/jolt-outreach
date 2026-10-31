import test from 'node:test'
import assert from 'node:assert/strict'
import * as r from '../lib/rules.js'

test('the cheap checks drop minors, crisis topics (self-harm, suicide, eating disorders, abuse) and promotion; everyday mental-health words go on to the AI, and leave the rest to the AI', () => {
  const samples = [
    ['quitter1', 'Quit again for a couple days but unfortunately came back to it.'],
    ['joker1', 'bro this video is so funny, I cant even'],
    ['young1', "I'm 15 and my mom takes my phone, I can't stop scrolling"],
    ['crisis1', 'I scroll all night and I have thought about suicide'],
    ['eating1', 'my eating disorder and scrolling both get worse at night'],
    ['promo1', 'use my code YYLE5MA for 5k points, I love this phone app'],
    ['someapp', "I can't stop scrolling, try our app"],
    ['linker', 'check out https://example.com for a way to stop scrolling'],
    ['short', 'lol'],
  ]
  const kept = samples.filter(([h, t]) => r.isCandidate(h, t, 'creator')).map(([h]) => h)
  assert.deepEqual(kept, ['quitter1', 'joker1'])
  for (const text of [
    'doomscrolling gives me so much anxiety',
    'Scrolling is how i numb myself to cope with circumstances im stuck in',
    'my therapist says my phone use is making my depression worse',
    'I get panic attacks when my phone is away, and my meds do not help',
  ]) assert.equal(r.isCandidate('someone', text, 'creator'), true, text)
})

test('"cutting back" is a normal thing to say, self-harm is still filtered out', () => {
  assert.equal(r.isCandidate('someone', 'I keep cutting back on my phone but I always end up scrolling again', 'creator'), true)
  assert.equal(r.isCandidate('someone', 'I scroll my phone for hours and I have been cutting myself too', 'creator'), false)
})

test('never picks the video creator, and ignores empty or very long comments', () => {
  assert.equal(r.isCandidate('creator', 'I cannot stop scrolling on my phone at night', 'Creator'), false)
  assert.equal(r.isCandidate('', 'I cannot stop scrolling on my phone at night', 'x'), false)
  assert.equal(r.isCandidate('a', 'I scroll my phone ' + 'x'.repeat(300), 'x'), false)
})

test('priority and opening lines', () => {
  assert.equal(r.priority('it only worked for a day'), 'A')
  assert.equal(r.priority('i scroll too much'), 'B')
  assert.match(r.opener('Quit again but came back'), /quitting or cutting back/)
  const long = 'the other night, I was half-asleep and my thumb started scrolling from muscle memory'
  assert.equal(r.opener(long), 'Saw your comment: “the other night, I was half-asleep and my thumb started scrolling…”')
})

test('query rotation is steady within an hour and different across hours', () => {
  assert.deepEqual(r.pickQueries(r.QUERIES, 2, 100), r.pickQueries(r.QUERIES, 2, 100))
  const hours = new Set(Array.from({ length: 20 }, (_, i) => r.pickQueries(r.QUERIES, 2, i).join('|')))
  assert.ok(hours.size > 5)
  assert.equal(r.pickQueries(r.QUERIES, 2, 7).length, 2)
})

test('comment ids are matched to rows by writer and text, and a row without an id stays without one', () => {
  const rows = [{ handle: 'a', text: 'one' }, { handle: 'b', text: 'two' }, { handle: 'a', text: 'three' }]
  const out = r.attachIds(rows, [{ handle: 'b', text: 'two', id: '7123456789012345678' }, { handle: 'a', text: 'one', id: '' }])
  assert.deepEqual(out.map((x) => x.id), [undefined, '7123456789012345678', undefined])
  assert.deepEqual(r.attachIds(rows, undefined), rows)
  const base = { creator: 'c', query: 'q', url: 'u', runAt: 'now' }
  assert.equal(r.makePerson({ handle: 'a', text: 'x', id: '71234567890123456' }, base, 'd').commentId, '71234567890123456')
  assert.ok(!('commentId' in r.makePerson({ handle: 'a', text: 'x' }, base, 'd')))
})

test('saved shapes match what the page reads', () => {
  const p = r.makePerson({ handle: 'a', text: 'I study and scroll my phone for hours' }, { creator: 'c', query: 'q', url: 'u', runAt: '2026-10-29T10:00:00.000Z' }, '2026-10-29')
  assert.deepEqual(Object.keys(p).sort(), ['added', 'comment', 'found', 'handle', 'note', 'opener', 'priority', 'source', 'url'])
  assert.equal(p.found, '2026-10-29T10:00:00.000Z')
  assert.match(p.note, /18\+/)
})

test('searches: one per competitor and one per keyword; names are cleaned up', () => {
  const q = r.buildQueries({ screenTime: ['Opal', 'opal', ' one  sec '], learn: ['Headway'], play: [] }, ['phone addiction', 'Phone Addiction', ' digital detox '])
  assert.deepEqual(q, ['Opal app review', 'one sec app review', 'Headway app review', 'phone addiction', 'digital detox'])
  assert.deepEqual(r.parseNames('Opal, one sec\n\n  Brick ;opal'), ['Opal', 'one sec', 'Brick'])
  assert.ok(r.QUERIES.includes('Matiks app review') && r.QUERIES.includes('Apple Screen Time app review') && r.QUERIES.includes('phone addiction'))
  assert.deepEqual(r.buildQueries({}, []), [], 'empty lists give no searches')
})

test('every run searches both a competitor and a keyword, and falls back to whichever list is left', () => {
  const comp = { screenTime: ['Opal', 'Brick', 'Forest'], learn: [], play: [] }
  for (let seed = 0; seed < 30; seed++) {
    const [a, b] = r.pickRunQueries(comp, ['phone addiction', 'digital detox'], 2, seed)
    assert.match(a, / app review$/)
    assert.ok(['phone addiction', 'digital detox'].includes(b))
  }
  assert.equal(r.pickRunQueries(comp, [], 2, 1).length, 2)
  assert.ok(r.pickRunQueries(comp, [], 2, 1).every((x) => / app review$/.test(x)))
  assert.deepEqual(r.pickRunQueries({}, ['only one'], 2, 1), ['only one'])
  assert.deepEqual(r.pickRunQueries({}, [], 2, 1), [])
})

test('a comment that names a competitor is tagged specific, with the user\'s own list', () => {
  assert.equal(r.priority('I tried Opal and still scroll'), 'A')
  assert.equal(r.priority('headway is not helping me focus'), 'A')
  assert.equal(r.priority('i use onesec but whatever', ['one sec']), 'A')
  assert.equal(r.priority('i use Matiks every night'), 'A')
  assert.equal(r.priority('i scroll all night', ['Zenly']), 'B')
  assert.equal(r.priority('my zenly streak is crazy', ['Zenly']), 'A')
  assert.equal(r.priority('opalescent sky vibes', ['Opal']), 'B', 'whole words only')
  assert.equal(r.priority('c++ is fun and so is Opal (beta)', ['C++', 'Opal (beta)']), 'A', 'names with symbols are matched literally')
})

test('comment counts: plain numbers, thousands separators and K or M', () => {
  assert.equal(r.parseCount('40'), 40)
  assert.equal(r.parseCount('1,234'), 1234)
  assert.equal(r.parseCount('1.2K'), 1200)
  assert.equal(r.parseCount('3M'), 3_000_000)
  assert.equal(r.parseCount('1,2K'), 1200)
  assert.equal(r.parseCount(''), null)
  assert.equal(r.parseCount('Comments'), null)
  assert.equal(r.parseCount(undefined), null)
})
