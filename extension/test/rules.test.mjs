import test from 'node:test'
import assert from 'node:assert/strict'
import * as r from '../lib/rules.js'

test('the cheap checks drop minors, sensitive topics and promotion, and leave the rest to the AI', () => {
  const samples = [
    ['quitter1', 'Quit again for a couple days but unfortunately came back to it.'],
    ['joker1', 'bro this video is so funny, I cant even'],
    ['young1', "I'm 15 and my mom takes my phone, I can't stop scrolling"],
    ['sad1', 'Scrolling is how i numb myself to cope with circumstances im stuck in'],
    ['promo1', 'use my code YYLE5MA for 5k points, I love this phone app'],
    ['someapp', "I can't stop scrolling, try our app"],
    ['linker', 'check out https://example.com for a way to stop scrolling'],
    ['short', 'lol'],
  ]
  const kept = samples.filter(([h, t]) => r.isCandidate(h, t, 'creator')).map(([h]) => h)
  assert.deepEqual(kept, ['quitter1', 'joker1'])
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

test('saved shapes match what the page reads', () => {
  const p = r.makePerson({ handle: 'a', text: 'I study and scroll my phone for hours' }, { creator: 'c', query: 'q', url: 'u' }, '2026-10-29')
  assert.deepEqual(Object.keys(p).sort(), ['added', 'comment', 'handle', 'note', 'opener', 'priority', 'source', 'url'])
  assert.match(p.note, /18\+/)
})
