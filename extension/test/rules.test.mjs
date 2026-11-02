import test from 'node:test'
import assert from 'node:assert/strict'
import * as r from '../lib/rules.js'

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
