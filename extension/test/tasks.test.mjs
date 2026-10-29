import test from 'node:test'
import assert from 'node:assert/strict'
import { Stop, findPeople } from '../lib/tasks.js'

const empty = () => ({ handles: new Set() })
const seen = () => ({ handles: new Set() })
const url = (n, who = 'maker' + n) => `https://www.tiktok.com/@${who}/video/${n}`
const card = (n, caption = 'my dopamine detox', who) => ({ url: url(n, who), caption, views: '1K', creator: who ?? 'maker' + n })

function fakeBrowser({ cards, videos = {}, comments = {}, stopOnOpen }) {
  const calls = []
  let last = ''
  let opens = 0
  return {
    calls,
    logs: [],
    pause: async () => {},
    search: async (q) => { calls.push(['search', q]); return cards },
    openVideo: async (u) => {
      calls.push(['open', u])
      last = u
      if (++opens === stopOnOpen) throw new Stop('verification')
      return videos[u] ?? { opened: true, caption: 'my dopamine detox', likes: '1K', comments: '40', markers: [] }
    },
    closeVideo: async () => { calls.push(['close']) },
    comments: async () => comments[last] ?? { ok: false, rows: [] },
  }
}
const opened = (b) => b.calls.filter(([k]) => k === 'open').map(([, u]) => u)

test('finds people from comments, skipping known handles and the creator', async () => {
  const cards = [card(1, 'anything', 'creator')]
  const comments = { [cards[0].url]: { ok: true, rows: [
    { handle: 'quitter1', text: 'Quit again for a couple days but unfortunately came back to it.' },
    { handle: 'known1', text: 'I cannot stop scrolling my phone at night, it is so bad' },
    { handle: 'creator', text: 'I cannot stop scrolling my phone at night, it is so bad' },
    { handle: 'nice', text: 'love it, thank you' },
  ] } }
  const known = empty()
  known.handles.add('known1')
  const out = await findPeople(fakeBrowser({ cards, comments }), known, seen())
  assert.deepEqual([...new Set(out.people.map((p) => p.handle))], ['quitter1'])
  assert.equal(out.people[0].priority, 'A')
  assert.match(out.people[0].opener, /quitting/)
})

test('gives up on a run after three videos whose comments will not load', async () => {
  const cards = [card(1), card(2), card(3), card(4), card(5)]
  const b = fakeBrowser({ cards })
  const out = await findPeople(b, empty(), seen())
  assert.equal(out.people.length, 0)
  assert.equal(opened(b).length, 3)
})

test('says what is on the page when a video does not open, then moves on', async () => {
  const cards = [card(1), card(2)]
  const videos = { [cards[0].url]: { opened: false, caption: '', markers: ['something-new', 'browse-music'] } }
  const comments = { [cards[1].url]: { ok: true, rows: [{ handle: 'quitter1', text: 'Quit again for a couple days but unfortunately came back to it.' }] } }
  const lines = []
  const b = fakeBrowser({ cards, videos, comments })
  const out = await findPeople(b, empty(), seen(), async (l) => lines.push(l))
  assert.ok(lines.some((l) => /did not open/.test(l) && /something-new, browse-music/.test(l)), lines.join('\n'))
  assert.equal(b.calls.filter(([k]) => k === 'close').length, opened(b).length, 'every opened video is closed again')
})

test('reads comments from a video that has no caption', async () => {
  const cards = [card(1, '')]
  const videos = { [cards[0].url]: { opened: true, caption: '', likes: '1', comments: '40', markers: [] } }
  const comments = { [cards[0].url]: { ok: true, rows: [{ handle: 'quitter1', text: 'Quit again for a couple days but unfortunately came back to it.' }] } }
  const out = await findPeople(fakeBrowser({ cards, videos, comments }), empty(), seen())
  assert.deepEqual([...new Set(out.people.map((x) => x.handle))], ['quitter1'])
})

test('stops cleanly on a verification check and keeps what it already found', async () => {
  const cards = [card(1), card(2), card(3)]
  const comments = Object.fromEntries(cards.map((c, i) => [c.url, { ok: true, rows: [{ handle: 'person' + i, text: 'Quit again for a couple days but unfortunately came back to it.' }] }]))
  const out = await findPeople(fakeBrowser({ cards, comments, stopOnOpen: 2 }), empty(), seen())
  assert.match(out.stopped, /verification/)
  assert.equal(out.people.length, 1)
})

test('stops after the target number of people', async () => {
  const cards = [card(1), card(2), card(3), card(4)]
  const rows = Array.from({ length: 30 }, (_, i) => ({ handle: 'person' + i, text: 'Quit again for a couple days but unfortunately came back to it.' }))
  const comments = Object.fromEntries(cards.map((c) => [c.url, { ok: true, rows }]))
  const out = await findPeople(fakeBrowser({ cards, comments }), empty(), seen())
  assert.equal(out.people.length, 8)
})
