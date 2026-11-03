import test from 'node:test'
import assert from 'node:assert/strict'
import * as r from '../lib/rules.js'

test('searches: one per topic; names are cleaned up and repeats dropped', () => {
  const q = r.buildQueries(['digital detox', 'Digital Detox', ' study  tips ', 'nervous system'])
  assert.deepEqual(q, ['digital detox', 'study tips', 'nervous system'])
  assert.deepEqual(r.parseNames('digital detox, study tips\n\n  nervous system ;DIGITAL detox'), ['digital detox', 'study tips', 'nervous system'])
  assert.deepEqual(r.buildQueries([]), [], 'an empty list gives no searches')
})

test('the default topics are the ones asked for, with no competitor apps or games', () => {
  const asked = ['microlearning app', 'learn while scrolling', 'digital wellbeing', 'digital wellness', 'nervous system', 'digital detox', 'studytalk']
  for (const topic of asked) assert.ok(r.QUERIES.includes(topic), topic)
  assert.ok(r.QUERIES.length > asked.length, 'with more of the same kind added')
  assert.ok(!r.QUERIES.some((q) => /doomscroll|app review|matiks|brilliant|opal/i.test(q)))
})

test('every run picks some of the topics, a different handful each hour, and all of them when asked for enough', () => {
  const topics = ['a', 'b', 'c', 'd', 'e', 'f']
  assert.deepEqual(r.pickRunQueries(topics, 3, 5), r.pickRunQueries(topics, 3, 5))
  assert.equal(r.pickRunQueries(topics, 3, 5).length, 3)
  assert.ok(new Set(Array.from({ length: 20 }, (_, i) => r.pickRunQueries(topics, 3, i).join())).size > 3)
  assert.deepEqual([...r.pickRunQueries(topics, 50, 1)].sort(), topics)
  assert.deepEqual(r.pickRunQueries([], 3, 1), [])
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

const idAt = (ms) => String((BigInt(Math.floor(ms / 1000)) << 32n) + 123456n)
const day = 86_400_000

test('a video\'s posting time comes from its id', () => {
  const now = Date.UTC(2026, 10, 2)
  const url = (ms) => `https://www.tiktok.com/@a/video/${idAt(ms)}`
  assert.ok(Math.abs(r.videoAgeDays(url(now - 10 * day), now) - 10) < 0.01)
  assert.ok(r.videoAgeDays(url(now - 90 * day), now) > 60)
  assert.equal(r.videoPosted(url(Date.UTC(2026, 9, 1))).slice(0, 10), '2026-10-01')
  assert.equal(r.videoAgeDays('https://www.tiktok.com/@a/video/12', now), null)
  assert.equal(r.videoPosted(''), null)
})

test('a video is known by its number, whatever the account is called', () => {
  assert.equal(r.videoKey('https://www.tiktok.com/@old/video/7699206417533701397'), '7699206417533701397')
  assert.equal(r.videoKey('https://www.tiktok.com/@new/video/7699206417533701397?x=1'), '7699206417533701397')
})

test('comments about the topics are kept, matched loosely, and the rest are not', () => {
  const row = (text, handle = 'someone') => ({ handle, text })
  const pick = (texts, topics) => r.pickComments(texts.map((t) => (typeof t === 'string' ? row(t) : t)), 'maker', topics).map((c) => c.text)
  const topics = ['screen time', 'brain rot', 'phone addict', 'procrastinat', 'digital detox']
  assert.deepEqual(pick([
    'my screen time is insane lately', 'My ScreenTime says 9 hours', 'this is such brainrot honestly', 'brain-rot content everywhere',
    'i have a real phone addiction', 'procrastinating again instead of working', 'doing a digital detox this month',
    'what a lovely song, I love it', 'unscreen timed', 'cannot believe how good this is',
  ], topics), [
    'my screen time is insane lately', 'My ScreenTime says 9 hours', 'this is such brainrot honestly', 'brain-rot content everywhere',
    'i have a real phone addiction', 'procrastinating again instead of working', 'doing a digital detox this month',
  ])
  assert.deepEqual(r.pickComments([row('screen time is high for me')], 'maker', topics)[0].topics, ['screen time'])
  assert.deepEqual(r.pickComments([row('brain rot and screen time')], 'maker', topics)[0].topics, ['screen time', 'brain rot'])
})

test('comments are not kept when they are the creator, too short or long, repeated, or unsafe', () => {
  const t = ['screen time']
  const keep = (rows) => r.pickComments(rows, 'Maker', t).length
  assert.equal(keep([{ handle: 'maker', text: 'my screen time is high' }]), 0, 'the creator, ignoring case')
  assert.equal(keep([{ handle: 'a', text: 'screen time' }]), 0, 'too short')
  assert.equal(keep([{ handle: 'a', text: 'screen time ' + 'x'.repeat(400) }]), 0, 'too long')
  assert.equal(keep([{ handle: 'a', text: 'my screen time is high' }, { handle: 'a', text: 'My screen time is  high' }]), 1, 'same person, same words')
  assert.equal(keep([{ handle: 'a', text: 'my screen time is high' }, { handle: 'b', text: 'my screen time is high' }]), 2, 'different people')
  assert.equal(keep([{ handle: 'a', text: 'my mom says my screen time is high' }]), 0, 'looks like a minor')
  assert.equal(keep([{ handle: 'a', text: 'my screen time is high and I want to kill myself' }]), 0, 'self-harm')
  assert.equal(keep([{ handle: 'a', text: 'screen time tips at www.example.com' }]), 0, 'a promotion')
  assert.equal(keep([{ handle: 'official_deals', text: 'my screen time is high' }]), 0, 'a brand account')
  assert.equal(keep([{ handle: '', text: 'my screen time is high' }]), 0, 'no writer')
  assert.equal(r.pickComments([{ handle: 'a', text: 'anything goes about my day' }], 'm', []).length, 0, 'no topics keeps nothing')
})

test('the default comment topics cover the subjects asked for', () => {
  const t = r.DEFAULT_COMMENT_TOPICS.join(' ')
  for (const word of ['screen time', 'brain rot', 'productiv', 'digital detox', 'phone addict', 'digital habit', 'focus']) assert.ok(t.includes(word), word)
  const hit = (text) => r.pickComments([{ handle: 'a', text }], 'm').length === 1
  assert.ok(hit('i get so little done, my productivity is gone'))
  assert.ok(hit('high screen time again this week'))
  assert.ok(hit('i need a digital detox'))
  assert.ok(!hit('this recipe looks really tasty, thanks for sharing'))
})

test('handles are treated as brands only when they say so, not when a word is part of a name', () => {
  const keep = (handle) => r.pickComments([{ handle, text: 'my screen time is high' }], 'maker', ['screen time']).length
  for (const ok of ['happy_dev', 'robotics_fan', 'official_lkhamilton', 'shopaholic', 'storeyteller', 'anna.apple']) assert.equal(keep(ok), 1, ok)
  for (const brand of ['official_deals', 'best.shop', 'coupon_king', 'jolt.io', 'ugc_agency', 'the_app', 'mybot']) assert.equal(keep(brand), brand === 'mybot' ? 1 : 0, brand)
})
