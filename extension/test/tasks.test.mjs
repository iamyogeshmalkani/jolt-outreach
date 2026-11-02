import test from 'node:test'
import assert from 'node:assert/strict'
import { Stop, findVideos } from '../lib/tasks.js'
import { videoKey } from '../lib/rules.js'

const DAY = 86_400_000
const idAt = (ms, n) => String((BigInt(Math.floor(ms / 1000)) << 32n) + BigInt(n))
// A search result for a video posted `age` days ago.
const card = (n, { age = 5, views = '50K', who = 'maker' + n } = {}) => ({
  url: `https://www.tiktok.com/@${who}/video/${idAt(Date.now() - age * DAY, n)}`, caption: 'cap ' + n, views, creator: who,
})
const empty = () => ({ keys: new Set() })

// Stands in for Chrome: `comments` maps a video's url to the comment count shown when it is opened.
function fakeBrowser({ cards, comments = {}, stopOnOpen, noOpen = [] }) {
  const calls = []
  return {
    calls,
    pause: async () => {},
    search: async (q) => { calls.push(['search', q]); return typeof cards === 'function' ? cards(q) : cards },
    openVideo: async (u) => {
      calls.push(['open', u])
      if (calls.filter(([k]) => k === 'open').length === stopOnOpen) throw new Stop('verification')
      if (noOpen.includes(u)) return { opened: false, markers: ['x'] }
      return { opened: true, caption: 'opened ' + u.slice(-3), comments: comments[u] ?? '40', markers: [] }
    },
    closeVideo: async () => { calls.push(['close']) },
  }
}
const opened = (b) => b.calls.filter(([k]) => k === 'open').map(([, u]) => u)
const opts = { competitors: {}, keywords: ['one topic'], checks: 20 }

test('keeps recent, popular videos with enough comments, and records what the page shows', async () => {
  const cards = [card(1), card(2, { views: '1.2M' })]
  const lines = []
  const out = await findVideos(fakeBrowser({ cards, comments: { [cards[1].url]: '1,234' } }), empty(), async (l) => lines.push(l), opts)
  assert.equal(out.videos.length, 2)
  const v = out.videos.find((x) => x.url === cards[1].url)
  assert.deepEqual(Object.keys(v).sort(), ['caption', 'comments', 'creator', 'found', 'posted', 'topic', 'url', 'views'])
  assert.equal(v.views, 1_200_000)
  assert.equal(v.comments, 1234)
  assert.equal(v.topic, 'one topic')
  assert.ok(Math.abs((Date.now() - Date.parse(v.posted)) / DAY - 5) < 0.01)
  assert.equal(new Set(out.videos.map((x) => x.found)).size, 1, 'one run time for the whole run')
})

test('opens the most viewed first, and never old, unpopular or already known videos', async () => {
  const cards = [
    card(1, { views: '20K' }), card(2, { views: '900K' }), card(3, { age: 90 }), card(4, { views: '500' }),
    card(5, { views: '300K' }), card(6),
  ]
  const known = { keys: new Set([videoKey(cards[5].url)]) }
  const b = fakeBrowser({ cards })
  const lines = []
  await findVideos(b, known, async (l) => lines.push(l), opts)
  assert.deepEqual(opened(b), [cards[1].url, cards[4].url, cards[0].url])
  assert.match(lines.join('\n'), /1 already listed, 1 too old, 1 with few views/)
})

test('a video with fewer comments than asked is passed over, and not opened again for a while', async () => {
  const cards = [card(1), card(2)]
  const memory = {}
  const comments = { [cards[0].url]: '19', [cards[1].url]: '20' }
  const out = await findVideos(fakeBrowser({ cards, comments }), empty(), undefined, { ...opts, memory })
  assert.deepEqual(out.videos.map((v) => v.url), [cards[1].url])
  assert.equal(memory[videoKey(cards[0].url)].n, 19)
  const b = fakeBrowser({ cards, comments })
  await findVideos(b, empty(), undefined, { ...opts, memory })
  assert.deepEqual(opened(b), [cards[1].url], 'the 19-comment video is not opened again')
  memory[videoKey(cards[0].url)].at = Date.now() - 8 * DAY
  const later = fakeBrowser({ cards, comments })
  await findVideos(later, empty(), undefined, { ...opts, memory })
  assert.equal(opened(later).length, 2, 'but after a week it is looked at again')
})

test('the limits come from the settings', async () => {
  const cards = [card(1, { views: '2K', age: 40 }), card(2, { views: '2K', age: 50 })]
  const comments = { [cards[0].url]: '8', [cards[1].url]: '8' }
  const out = await findVideos(fakeBrowser({ cards, comments }), empty(), undefined, { ...opts, minViews: 1000, minComments: 5, maxAgeDays: 45 })
  assert.deepEqual(out.videos.map((v) => v.url), [cards[0].url])
})

test('a video listed from one search is not listed again by another', async () => {
  const cards = [card(1)]
  const b = fakeBrowser({ cards })
  const out = await findVideos(b, empty(), undefined, { competitors: {}, keywords: ['a', 'b', 'c'], checks: 12 })
  assert.equal(out.videos.length, 1)
  assert.equal(opened(b).length, 1)
})

test('opens no more videos than a run is allowed to check', async () => {
  const cards = Array.from({ length: 12 }, (_, i) => card(i + 1))
  const b = fakeBrowser({ cards })
  const out = await findVideos(b, empty(), undefined, { ...opts, checks: 5 })
  assert.equal(opened(b).length, 5)
  assert.equal(out.videos.length, 5)
})

test('stops after enough videos are found', async () => {
  let n = 0
  const cards = () => Array.from({ length: 12 }, () => card(++n))
  const out = await findVideos(fakeBrowser({ cards }), empty(), undefined, { competitors: {}, keywords: ['a', 'b', 'c', 'd', 'e', 'f'], checks: 100 })
  assert.equal(out.videos.length, 40)
})

test('gives up after videos in a row that will not open, and says what the page had', async () => {
  const cards = Array.from({ length: 8 }, (_, i) => card(i + 1))
  const lines = []
  const b = fakeBrowser({ cards, noOpen: cards.map((c) => c.url) })
  const out = await findVideos(b, empty(), async (l) => lines.push(l), opts)
  assert.equal(opened(b).length, 5)
  assert.equal(out.videos.length, 0)
  assert.match(lines.join('\n'), /did not open\. The page had: x/)
})

test('stops cleanly on a verification check and keeps what it already found', async () => {
  const cards = [card(1), card(2), card(3)]
  const out = await findVideos(fakeBrowser({ cards, stopOnOpen: 3 }), empty(), undefined, opts)
  assert.equal(out.stopped, 'verification')
  assert.equal(out.videos.length, 2)
})

test('search results without a readable video number or view count are still considered', async () => {
  const cards = [{ url: 'https://www.tiktok.com/@a/video/12', caption: '', views: '', creator: 'a' }]
  const out = await findVideos(fakeBrowser({ cards }), empty(), undefined, opts)
  assert.equal(out.videos.length, 1)
  assert.equal(out.videos[0].views, null)
  assert.equal(out.videos[0].posted, null)
})
