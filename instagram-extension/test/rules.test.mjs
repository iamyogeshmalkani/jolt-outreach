import test from 'node:test'
import assert from 'node:assert/strict'
import * as r from '../lib/rules.js'
import { codeAt } from './helpers.mjs'

const DAY = 86_400_000

test('keywords are cleaned up, and a keyword can become a hashtag', () => {
  assert.deepEqual(r.keywordQueries([' phone  addiction', 'Phone Addiction', 'digital detox']), ['phone addiction', 'digital detox'])
  assert.deepEqual(r.keywordQueries([]), [])
  assert.deepEqual(r.parseNames('a, b\n\n c ;A'), ['a', 'b', 'c'])
  assert.equal(r.hashtagOf('Phone addiction!'), 'phoneaddiction')
  assert.equal(r.hashtagOf('digital-detox 2026'), 'digitaldetox2026')
})

test('a reel is known by its shortcode, whatever form the link is in', () => {
  for (const url of [
    'https://www.instagram.com/reel/DAbC123xyz_/', 'https://www.instagram.com/p/DAbC123xyz_/?img_index=1',
    'https://www.instagram.com/someone/reel/DAbC123xyz_/', 'https://instagram.com/reels/DAbC123xyz_',
  ]) assert.equal(r.videoKey(url), 'DAbC123xyz_', url)
  assert.equal(r.reelUrl('https://www.instagram.com/p/DAbC123xyz_/?x=1'), 'https://www.instagram.com/reel/DAbC123xyz_/')
  assert.equal(r.videoKey('https://example.com/nothing'), 'https://example.com/nothing')
  assert.equal(r.shortcodeOf(''), '')
})

test('a reel\'s posting time is read from its shortcode', () => {
  const now = Date.UTC(2026, 10, 3)
  for (const days of [1, 10, 59, 61, 400]) {
    const url = `https://www.instagram.com/reel/${codeAt(now - days * DAY + 12345)}/`
    assert.ok(Math.abs(r.videoAgeDays(url, now) - days) < 0.01, `${days} days`)
  }
  assert.equal(r.videoPosted(`https://www.instagram.com/reel/${codeAt(Date.UTC(2026, 9, 1))}/`).slice(0, 10), '2026-10-01')
})

test('a shortcode that does not decode to a believable time gives no age, so the reel is not filtered out', () => {
  assert.equal(r.videoAgeDays('https://www.instagram.com/reel/AAAAAAAAAAA/'), null, 'decodes to 2011-08-24, before Instagram')
  assert.equal(r.videoAgeDays('https://www.instagram.com/reel/short1/'), null)
  assert.equal(r.videoAgeDays('https://www.instagram.com/reel/abc$defghij/'), null)
  assert.equal(r.videoAgeDays('https://www.instagram.com/reel/' + codeAt(Date.now() + 40 * DAY) + '/'), null, 'in the future')
  assert.equal(r.videoPosted(''), null)
})

test('counts: plain numbers, thousands separators and K or M', () => {
  assert.equal(r.parseCount('40'), 40)
  assert.equal(r.parseCount('1,234'), 1234)
  assert.equal(r.parseCount('1.2K'), 1200)
  assert.equal(r.parseCount('3M'), 3_000_000)
  assert.equal(r.parseCount(''), null)
  assert.equal(r.parseCount('Likes'), null)
  assert.equal(r.parseCount(undefined), null)
})

test('picking queries gives the same keywords for the same seed', () => {
  const pool = ['a', 'b', 'c', 'd', 'e']
  assert.deepEqual(r.pickQueries(pool, 3, 7), r.pickQueries(pool, 3, 7))
  assert.equal(r.pickQueries(pool, 3, 7).length, 3)
  assert.equal(r.pickQueries(pool, 9, 7).length, 5)
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
