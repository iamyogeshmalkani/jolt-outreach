import test from 'node:test'
import assert from 'node:assert/strict'
import { Stop, findPeople, findVideos } from '../lib/tasks.js'

const empty = () => ({ handles: new Set(), urls: new Set(), creators: new Set() })
const seen = () => ({ urls: new Set(), handles: new Set() })
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
      return videos[u] ?? { caption: 'my dopamine detox', likes: '1K', comments: '40', markers: [] }
    },
    closeVideo: async () => { calls.push(['close']) },
    comments: async () => comments[last] ?? { ok: false, rows: [] },
  }
}
const opened = (b) => b.calls.filter(([k]) => k === 'open').map(([, u]) => u)

test('queues up to two fitting videos, one per creator, skipping known and off-topic ones', async () => {
  const cards = [card(1), card(2), card(3), card(4, 'cooking pasta tonight'), card(5), card(6)]
  const known = empty()
  known.urls.add(cards[1].url)
  const b = fakeBrowser({ cards })
  const out = await findVideos(b, known, seen())
  assert.equal(out.videos.length, 2)
  assert.ok(out.videos.every((v) => v.draft.length > 10 && v.url !== cards[1].url))
  assert.equal(new Set(out.videos.map((v) => v.creator)).size, 2)
  assert.ok(!opened(b).includes(cards[3].url), 'an off-topic caption is never opened')
  assert.ok(!opened(b).includes(cards[1].url), 'a known video is never opened')
  assert.equal(b.calls.filter(([k]) => k === 'close').length, opened(b).length, 'every opened video is closed again')
})

test('does not keep videos with too few comments', async () => {
  const cards = [card(1), card(2)]
  const videos = Object.fromEntries(cards.map((c) => [c.url, { caption: 'my dopamine detox', comments: '1', likes: '1', markers: [] }]))
  const out = await findVideos(fakeBrowser({ cards, videos }), empty(), seen())
  assert.equal(out.videos.length, 0)
})

test('says what is on the page when a caption cannot be read, then moves on', async () => {
  const cards = [card(1), card(2)]
  const videos = { [cards[0].url]: { caption: '', markers: ['something-new', 'browse-music'] } }
  const lines = []
  const b = fakeBrowser({ cards, videos })
  const out = await findVideos(b, empty(), seen(), async (l) => lines.push(l))
  assert.ok(lines.some((l) => /could not read the caption/.test(l) && /something-new, browse-music/.test(l)), lines.join('\n'))
  assert.ok(out.videos.length <= 2)
  assert.equal(b.calls.filter(([k]) => k === 'close').length, opened(b).length)
})

test('stops cleanly on a verification check and keeps what it already found', async () => {
  const cards = [card(1), card(2), card(3)]
  const out = await findVideos(fakeBrowser({ cards, stopOnOpen: 2 }), empty(), seen())
  assert.match(out.stopped, /verification/)
  assert.equal(out.videos.length, 1)
})

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
