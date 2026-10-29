import test from 'node:test'
import assert from 'node:assert/strict'
import { Stop, findPeople } from '../lib/tasks.js'

// Stands in for the AI: keeps the comments whose text contains "came back", as a person describing their own habit would.
const judge = async (rows) => rows.filter((r) => /came back|cannot stop|stop scrolling/.test(r.text))
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
  const out = await findPeople(fakeBrowser({ cards, comments }), known, seen(), undefined, judge)
  assert.deepEqual([...new Set(out.people.map((p) => p.handle))], ['quitter1'])
  assert.equal(out.people[0].priority, 'A')
  assert.match(out.people[0].opener, /quitting/)
})

test('gives up on a run after five videos in a row whose comments will not load', async () => {
  const cards = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => card(n))
  const b = fakeBrowser({ cards })
  const out = await findPeople(b, empty(), seen(), undefined, judge)
  assert.equal(out.people.length, 0)
  assert.equal(opened(b).length, 5)
})

test('says what is on the page when a video does not open, then moves on', async () => {
  const cards = [card(1), card(2)]
  const videos = { [cards[0].url]: { opened: false, caption: '', markers: ['something-new', 'browse-music'] } }
  const comments = { [cards[1].url]: { ok: true, rows: [{ handle: 'quitter1', text: 'Quit again for a couple days but unfortunately came back to it.' }] } }
  const lines = []
  const b = fakeBrowser({ cards, videos, comments })
  const out = await findPeople(b, empty(), seen(), async (l) => lines.push(l), judge)
  assert.ok(lines.some((l) => /did not open/.test(l) && /something-new, browse-music/.test(l)), lines.join('\n'))
  assert.equal(b.calls.filter(([k]) => k === 'close').length, opened(b).length, 'every opened video is closed again')
})

test('reads comments from a video that has no caption', async () => {
  const cards = [card(1, '')]
  const videos = { [cards[0].url]: { opened: true, caption: '', likes: '1', comments: '40', markers: [] } }
  const comments = { [cards[0].url]: { ok: true, rows: [{ handle: 'quitter1', text: 'Quit again for a couple days but unfortunately came back to it.' }] } }
  const out = await findPeople(fakeBrowser({ cards, videos, comments }), empty(), seen(), undefined, judge)
  assert.deepEqual([...new Set(out.people.map((x) => x.handle))], ['quitter1'])
})

test('stops cleanly on a verification check and keeps what it already found', async () => {
  const cards = [card(1), card(2), card(3)]
  const comments = Object.fromEntries(cards.map((c, i) => [c.url, { ok: true, rows: [{ handle: 'person' + i, text: 'Quit again for a couple days but unfortunately came back to it.' }] }]))
  const out = await findPeople(fakeBrowser({ cards, comments, stopOnOpen: 2 }), empty(), seen(), undefined, judge)
  assert.match(out.stopped, /verification/)
  assert.equal(out.people.length, 1)
})

test('stops after the target number of people', async () => {
  const cards = [card(1), card(2), card(3), card(4)]
  const comments = Object.fromEntries(cards.map((c, ci) => [c.url, { ok: true, rows: Array.from({ length: 30 }, (_, i) => ({ handle: `person${ci}_${i}`, text: 'Quit again for a couple days but unfortunately came back to it.' })) }]))
  const out = await findPeople(fakeBrowser({ cards, comments }), empty(), seen(), undefined, judge)
  assert.equal(out.people.length, 40)
})

test('only the comments the AI picks become people, and it sees only comments that passed the cheap checks', async () => {
  const cards = [card(1, 'anything', 'creator')]
  const comments = { [cards[0].url]: { ok: true, rows: [
    { handle: 'quitter1', text: 'Quit again for a couple days but unfortunately came back to it.' },
    { handle: 'joker1', text: 'my phone is my whole personality lol, this video is gold' },
    { handle: 'teen1', text: "I'm 15 and I cannot stop scrolling at night" },
    { handle: 'known1', text: 'I cannot stop scrolling my phone at night, it is so bad' },
  ] } }
  const known = empty()
  known.handles.add('known1')
  const sent = []
  const spy = async (rows) => { sent.push(rows.map((r) => r.handle)); return judge(rows) }
  const s = seen()
  const out = await findPeople(fakeBrowser({ cards, comments }), known, s, undefined, spy)
  assert.deepEqual(sent[0], ['quitter1', 'joker1']) // later calls are the second search returning the same video
  assert.deepEqual(out.people.map((p) => p.handle), ['quitter1'])
  assert.ok(!s.handles.has('joker1'), 'a comment the AI turned down is not remembered as seen')
})

test('one person with two accepted comments on a video is saved once', async () => {
  const cards = [card(1)]
  const comments = { [cards[0].url]: { ok: true, rows: [
    { handle: 'twice', text: 'Quit again for a couple days but unfortunately came back to it.' },
    { handle: 'twice', text: 'I cannot stop scrolling my phone at night, it is so bad' },
  ] } }
  const out = await findPeople(fakeBrowser({ cards, comments }), empty(), seen(), undefined, judge)
  assert.equal(out.people.length, 1)
})

test('when the AI cannot answer, the run ends with its reason and saves nothing from that video', async () => {
  const cards = [card(1), card(2)]
  const comments = Object.fromEntries(cards.map((c) => [c.url, { ok: true, rows: [{ handle: 'p' + c.url.length, text: 'Quit again for a couple days but unfortunately came back to it.' }] }]))
  const b = fakeBrowser({ cards, comments })
  const out = await findPeople(b, empty(), seen(), undefined, async () => { throw new Error('Groq did not accept the API key.') })
  assert.equal(out.aiError, 'Groq did not accept the API key.')
  assert.equal(out.stopped, '')
  assert.equal(out.people.length, 0)
  assert.equal(opened(b).length, 1, 'stops at the first failure')
  assert.equal(b.calls.filter(([k]) => k === 'close').length, 1, 'the video is closed again')
})

test('searches use the competitors and keywords from settings, one of each per run, and one run time for everyone', async () => {
  const cards = [card(1), card(2)]
  const rows = [{ handle: 'p1', text: 'Quit again for a couple days but unfortunately came back to it.' }, { handle: 'p2', text: 'I cannot stop scrolling and Zenly did not help' }]
  const comments = Object.fromEntries(cards.map((c) => [c.url, { ok: true, rows }]))
  const b = fakeBrowser({ cards, comments })
  const out = await findPeople(b, empty(), seen(), undefined, judge, { competitors: { screenTime: ['Zenly'], learn: [], play: [] }, keywords: ['phone addiction'] })
  assert.deepEqual(b.calls.filter(([k]) => k === 'search').map(([, q]) => q), ['Zenly app review', 'phone addiction'])
  assert.equal(out.people.length, 2)
  assert.equal(new Set(out.people.map((p) => p.found)).size, 1)
  assert.ok(out.people[0].found)
  assert.deepEqual(out.people.map((p) => p.priority), ['A', 'A'])
})

const rowsFor = (c, who = 'p') => ({ [c.url]: { ok: true, rows: [{ handle: who + c.url.length + c.url.slice(-1), text: 'Quit again for a couple days but unfortunately came back to it.' }] } })
const withCount = (comments) => ({ opened: true, caption: 'x', likes: '1K', comments, markers: [] })

test('a video with fewer than 2 comments is flagged and skipped, and remembered', async () => {
  const cards = [card(1), card(2)]
  const videos = { [cards[0].url]: withCount('1'), [cards[1].url]: withCount('1.2K') }
  const comments = { ...rowsFor(cards[0]), ...rowsFor(cards[1]) }
  const lines = []
  const memory = {}
  const b = fakeBrowser({ cards, videos, comments })
  const out = await findPeople(b, empty(), seen(), async (l) => lines.push(l), judge, { memory })
  assert.equal(out.people.length, 1, 'only the video with real comments was read')
  assert.ok(lines.some((l) => /flagged, only 1 comments/.test(l)), lines.join('|'))
  assert.equal(memory[cards[0].url].n, 1)
  assert.equal(memory[cards[1].url].n, 1200)
  assert.ok(lines.some((l) => /Skipped 1 with too few comments/.test(l)), lines.join('|'))
})

test('a video read before is skipped until it has 5 more comments', async () => {
  const cards = [card(1), card(2), card(3)]
  const videos = { [cards[0].url]: withCount('40'), [cards[1].url]: withCount('43'), [cards[2].url]: withCount('45') }
  const comments = { ...rowsFor(cards[0], 'a'), ...rowsFor(cards[1], 'b'), ...rowsFor(cards[2], 'c') }
  const memory = Object.fromEntries(cards.map((c) => [c.url, { n: 40, at: 1 }]))
  const lines = []
  const out = await findPeople(fakeBrowser({ cards, videos, comments }), empty(), seen(), async (l) => lines.push(l), judge, { memory })
  assert.equal(out.people.length, 1, 'only the video that grew by 5 was read again')
  assert.equal(memory[cards[2].url].n, 45)
  assert.equal(memory[cards[0].url].n, 40)
  assert.equal(lines.filter((l) => /: nothing new \(/.test(l)).length, 2, lines.join('|'))
})

test('a video the AI could not check is not remembered, so the next run reads it again', async () => {
  const cards = [card(1)]
  const memory = {}
  const out = await findPeople(fakeBrowser({ cards, comments: rowsFor(cards[0]) }), empty(), seen(), undefined, async () => { throw new Error('quota') }, { memory })
  assert.equal(out.aiError, 'quota')
  assert.deepEqual(memory, {})
})

test('a run reads only as many videos as asked, and opens at most twice as many looking for them', async () => {
  const cards = Array.from({ length: 12 }, (_, i) => card(i + 1))
  const comments = Object.fromEntries(cards.map((c, i) => rowsFor(c, 'q' + i)).flatMap((o) => Object.entries(o)))
  const b = fakeBrowser({ cards, comments })
  const out = await findPeople(b, empty(), seen(), undefined, judge, { videos: 3 })
  assert.equal(out.people.length, 3)
  assert.equal(opened(b).length, 3)
  const none = fakeBrowser({ cards, videos: Object.fromEntries(cards.map((c) => [c.url, withCount('0')])) })
  await findPeople(none, empty(), seen(), undefined, judge, { videos: 3 })
  assert.equal(opened(none).length, 6, 'gives up looking after six videos with too few comments')
})

test('a video with exactly 2 comments is read', async () => {
  const cards = [card(1)]
  const out = await findPeople(fakeBrowser({ cards, videos: { [cards[0].url]: withCount('2') }, comments: rowsFor(cards[0]) }), empty(), seen(), undefined, judge)
  assert.equal(out.people.length, 1)
})
