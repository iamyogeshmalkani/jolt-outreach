import test from 'node:test'
import assert from 'node:assert/strict'
import { Stop, findPeople, findVideos } from '../lib/tasks.js'

const empty = () => ({ handles: new Set(), urls: new Set(), creators: new Set() })
const seen = () => ({ urls: new Set(), handles: new Set() })

function fakeBrowser({ links, videos = {}, comments = {}, stopOnOpen }) {
  const calls = []
  return {
    calls,
    pause: async () => {},
    search: async (q) => { calls.push(['search', q]); return links },
    open: async (u) => {
      calls.push(['open', u])
      if (calls.filter(([k]) => k === 'open').length === stopOnOpen) throw new Stop('verification')
    },
    video: async () => videos[calls.at(-1)[1]],
    comments: async () => comments[calls.at(-1)[1]] ?? { ok: false, rows: [] },
  }
}
const url = (n, who = 'maker' + n) => `https://www.tiktok.com/@${who}/video/${n}`

test('queues up to two fitting videos, one per creator, skipping known ones', async () => {
  const links = [url(1), url(2), url(3), url(4), url(5), url(6)]
  const videos = Object.fromEntries(links.map((u) => [u, { caption: 'my dopamine detox', likes: '1K', comments: '40' }]))
  videos[links[0]] = { caption: 'cooking pasta', likes: '1K', comments: '900' }
  const known = empty()
  known.urls.add(links[1])
  const out = await findVideos(fakeBrowser({ links, videos }), known, seen())
  assert.equal(out.videos.length, 2)
  assert.ok(out.videos.every((v) => v.draft.length > 10 && v.url !== links[0] && v.url !== links[1]))
  assert.equal(new Set(out.videos.map((v) => v.creator)).size, 2)
})

test('stops cleanly on a verification check and keeps what it already found', async () => {
  const links = [url(1), url(2), url(3)]
  const videos = Object.fromEntries(links.map((u) => [u, { caption: 'doomscrolling', likes: '1', comments: '50' }]))
  const out = await findVideos(fakeBrowser({ links, videos, stopOnOpen: 2 }), empty(), seen())
  assert.match(out.stopped, /verification/)
  assert.equal(out.videos.length, 1) // the first video was kept before the check appeared
})

test('finds people from comments, skipping known handles and the creator', async () => {
  const links = [url(1, 'creator')]
  const comments = { [links[0]]: { ok: true, rows: [
    { handle: 'quitter1', text: 'Quit again for a couple days but unfortunately came back to it.' },
    { handle: 'known1', text: 'I cannot stop scrolling my phone at night, it is so bad' },
    { handle: 'creator', text: 'I cannot stop scrolling my phone at night, it is so bad' },
    { handle: 'nice', text: 'love it, thank you' },
  ] } }
  const known = empty()
  known.handles.add('known1')
  const out = await findPeople(fakeBrowser({ links, comments }), known, seen())
  assert.deepEqual(out.people.map((p) => p.handle), ['quitter1'])
  assert.equal(out.people[0].priority, 'A')
  assert.match(out.people[0].opener, /quitting/)
})

test('gives up on a run after three videos whose comments will not load', async () => {
  const links = [url(1), url(2), url(3), url(4), url(5)]
  const b = fakeBrowser({ links })
  const out = await findPeople(b, empty(), seen())
  assert.equal(out.people.length, 0)
  assert.equal(b.calls.filter(([k]) => k === 'open').length, 3)
})
