import test from 'node:test'
import assert from 'node:assert/strict'
import { Stop, findVideos } from '../lib/tasks.js'
import { videoKey } from '../lib/rules.js'
import { codeAt } from './helpers.mjs'

const DAY = 86_400_000
// A search result for a reel posted `age` days ago.
const card = (n, { age = 5 } = {}) => ({ url: `https://www.instagram.com/reel/${codeAt(Date.now() - age * DAY, n)}/`, caption: 'cap ' + n })
const empty = () => ({ keys: new Set() })

// Stands in for Chrome: `likes` maps a reel's url to the likes shown when it is opened.
function fakeBrowser({ cards, likes = {}, stopOnOpen, noOpen = [], notVideo = [], commentRows = { ok: true, rows: [] } }) {
  const calls = []
  return {
    calls,
    pause: async () => {},
    search: async (q) => { calls.push(['search', q]); return typeof cards === 'function' ? cards(q) : cards },
    openVideo: async (u) => {
      calls.push(['open', u])
      if (calls.filter(([k]) => k === 'open').length === stopOnOpen) throw new Stop('logged out')
      if (noOpen.includes(u)) return { opened: false, markers: ['x'] }
      return { opened: true, isVideo: !notVideo.includes(u), caption: 'opened', likes: likes[u] ?? '5,000', comments: '12', creator: 'maker', markers: [] }
    },
    comments: async () => { calls.push(['comments']); return typeof commentRows === 'function' ? commentRows() : commentRows },
  }
}
const opened = (b) => b.calls.filter(([k]) => k === 'open').map(([, u]) => u)
const opts = { keywords: ['one topic'], checks: 20 }

test('keeps recent reels with enough likes, and records what the page shows', async () => {
  const cards = [card(1), card(2)]
  const out = await findVideos(fakeBrowser({ cards, likes: { [cards[1].url]: '1.2M' } }), empty(), undefined, opts)
  assert.equal(out.videos.length, 2)
  const v = out.videos.find((x) => x.url === cards[1].url)
  assert.deepEqual(Object.keys(v).sort(), ['caption', 'comments', 'creator', 'found', 'likes', 'matches', 'posted', 'read', 'topic', 'url'])
  assert.equal(v.likes, 1_200_000)
  assert.equal(v.comments, 12)
  assert.equal(v.creator, 'maker')
  assert.equal(v.topic, 'one topic')
  assert.ok(Math.abs((Date.now() - Date.parse(v.posted)) / DAY - 5) < 0.01)
  assert.equal(new Set(out.videos.map((x) => x.found)).size, 1, 'one run time for the whole run')
})

test('never opens old or already known reels, and says how many it passed over', async () => {
  const cards = [card(1), card(2, { age: 90 }), card(3), card(4)]
  const known = { keys: new Set([videoKey(cards[3].url)]) }
  const b = fakeBrowser({ cards })
  const lines = []
  await findVideos(b, known, async (l) => lines.push(l), opts)
  assert.deepEqual(opened(b), [cards[0].url, cards[2].url])
  assert.match(lines.join('\n'), /1 already listed, 1 too old/)
})

test('a reel with fewer likes than asked is passed over, and not opened again for a while', async () => {
  const cards = [card(1), card(2)]
  const memory = {}
  const likes = { [cards[0].url]: '999', [cards[1].url]: '1,000' }
  const out = await findVideos(fakeBrowser({ cards, likes }), empty(), undefined, { ...opts, memory })
  assert.deepEqual(out.videos.map((v) => v.url), [cards[1].url])
  assert.equal(memory[videoKey(cards[0].url)].n, 999)
  const b = fakeBrowser({ cards, likes })
  await findVideos(b, empty(), undefined, { ...opts, memory })
  assert.deepEqual(opened(b), [cards[1].url], 'the 999-like reel is not opened again')
  memory[videoKey(cards[0].url)].at = Date.now() - 8 * DAY
  const later = fakeBrowser({ cards, likes })
  await findVideos(later, empty(), undefined, { ...opts, memory })
  assert.equal(opened(later).length, 2, 'but after a week it is looked at again')
})

test('a reel whose likes are hidden is kept, and a post that is not a video is not', async () => {
  const cards = [card(1), card(2)]
  const b = fakeBrowser({ cards, likes: { [cards[0].url]: 'Likes' }, notVideo: [cards[1].url] })
  const out = await findVideos(b, empty(), undefined, opts)
  assert.deepEqual(out.videos.map((v) => v.url), [cards[0].url])
  assert.equal(out.videos[0].likes, null)
})

test('the limits come from the settings', async () => {
  const cards = [card(1, { age: 40 }), card(2, { age: 50 })]
  const likes = { [cards[0].url]: '80', [cards[1].url]: '80' }
  const out = await findVideos(fakeBrowser({ cards, likes }), empty(), undefined, { ...opts, minLikes: 50, maxAgeDays: 45 })
  assert.deepEqual(out.videos.map((v) => v.url), [cards[0].url])
})

test('a reel found by one search is not listed again by another', async () => {
  const cards = [card(1)]
  const b = fakeBrowser({ cards })
  const out = await findVideos(b, empty(), undefined, { keywords: ['a', 'b', 'c'], checks: 12 })
  assert.equal(out.videos.length, 1)
  assert.equal(opened(b).length, 1)
})

test('opens no more reels than a run is allowed to check', async () => {
  const cards = Array.from({ length: 12 }, (_, i) => card(i + 1))
  const b = fakeBrowser({ cards })
  const out = await findVideos(b, empty(), undefined, { ...opts, checks: 5 })
  assert.equal(opened(b).length, 5)
  assert.equal(out.videos.length, 5)
})

test('stops after enough reels are found', async () => {
  let n = 0
  const cards = () => Array.from({ length: 12 }, () => card(++n))
  const out = await findVideos(fakeBrowser({ cards }), empty(), undefined, { keywords: ['a', 'b', 'c', 'd', 'e', 'f'], checks: 100 })
  assert.equal(out.videos.length, 30)
})

test('gives up after reels in a row that will not open, and says what the page had', async () => {
  const cards = Array.from({ length: 8 }, (_, i) => card(i + 1))
  const lines = []
  const b = fakeBrowser({ cards, noOpen: cards.map((c) => c.url) })
  const out = await findVideos(b, empty(), async (l) => lines.push(l), opts)
  assert.equal(opened(b).length, 4)
  assert.equal(out.videos.length, 0)
  assert.match(lines.join('\n'), /did not open\. The page had: x/)
})

test('stops cleanly when Instagram asks for a login, and keeps what it already found', async () => {
  const cards = [card(1), card(2), card(3)]
  const out = await findVideos(fakeBrowser({ cards, stopOnOpen: 3 }), empty(), undefined, opts)
  assert.equal(out.stopped, 'logged out')
  assert.equal(out.videos.length, 2)
})

test('a result with a link Instagram gave in another form is saved in the one standard form', async () => {
  const cards = [{ url: `https://www.instagram.com/p/${codeAt(Date.now() - DAY, 9)}/?img_index=1`, caption: '' }]
  const out = await findVideos(fakeBrowser({ cards }), empty(), undefined, opts)
  assert.match(out.videos[0].url, /^https:\/\/www\.instagram\.com\/reel\/[\w-]{11}\/$/)
})

const rows = [
  { handle: 'ana', text: 'My screen time is 11 hours a day, brainrot for real' },
  { handle: 'ben', text: 'love this song so much, the editing is great' },
  { handle: 'maker', text: 'the creator replying about screen time on their own reel' },
  { handle: 'cy', text: 'trying a digital detox this week, procrastinating less' },
]

test('saves the comments about the topics with each kept reel, and reads comments only of kept reels', async () => {
  const cards = [card(1), card(2)]
  const b = fakeBrowser({ cards, likes: { [cards[1].url]: '10' }, commentRows: { ok: true, rows } })
  const lines = []
  const out = await findVideos(b, empty(), async (l) => lines.push(l), { ...opts, commentTopics: ['screen time', 'brain rot', 'digital detox', 'procrastinat'] })
  assert.equal(out.videos.length, 1)
  assert.equal(b.calls.filter(([k]) => k === 'comments').length, 1, 'the unpopular reel is not read')
  const v = out.videos[0]
  assert.equal(v.read, 4)
  assert.deepEqual(v.matches.map((c) => c.handle), ['ana', 'cy'], 'off-topic and the creator\'s own comments are left out')
  assert.deepEqual(v.matches[0].topics, ['screen time', 'brain rot'])
  assert.match(lines.join('\n'), /2 of the top 4 comments are about their habits/)
  assert.match(lines.join('\n'), /kept 1 with 2 comments about digital habits/)
})

test('Claude only sees comments that look related, its pick replaces the topic check, and if it fails the topics are used', async () => {
  const cards = [card(1), card(2)]
  const sent = []
  const judge = async (rs) => { sent.push(rs.map((r) => r.handle)); return rs.filter((r) => r.handle === 'cy') }
  const out = await findVideos(fakeBrowser({ cards, commentRows: { ok: true, rows } }), empty(), undefined, { ...opts, judge })
  assert.deepEqual(sent[0], ['ana', 'cy'], 'not the creator, and not the comment about the song')
  assert.deepEqual(out.videos[0].matches.map((m) => [m.handle, m.topics]), [['cy', ['digital detox', 'detox', 'procrastinat']]])

  let asked = 0
  const lines = []
  const down = await findVideos(fakeBrowser({ cards, commentRows: { ok: true, rows } }), empty(), async (l) => lines.push(l), {
    ...opts, judge: async () => { asked++; throw new Error('The Claude credit balance or spend limit has run out.') },
  })
  assert.equal(asked, 1)
  assert.match(down.aiError, /credit balance/)
  assert.ok(down.videos.every((v) => v.matches.some((c) => c.handle === 'ana')))
  assert.match(lines.join('\n'), /uses the comment topics instead/)
})

test('a kept reel whose comments will not load is still listed, with nothing read', async () => {
  const lines = []
  const out = await findVideos(fakeBrowser({ cards: [card(1)], commentRows: { ok: false, rows: [] } }), empty(), async (l) => lines.push(l), opts)
  assert.equal(out.videos.length, 1)
  assert.equal(out.videos[0].read, 0)
  assert.deepEqual(out.videos[0].matches, [])
  assert.match(lines.join('\n'), /comments did not load/)
})

test('when no comment matches, the log shows a few that were looked at', async () => {
  const rows = [{ handle: 'ana', text: 'what a lovely song, I really love this one' }, { handle: 'ben', text: 'first, and here early too friends' }]
  const lines = []
  const out = await findVideos(fakeBrowser({ cards: [card(1)], commentRows: { ok: true, rows } }), empty(), async (l) => lines.push(l), opts)
  assert.deepEqual(out.videos[0].matches, [])
  assert.match(lines.join('\n'), /left out: @ana "what a lovely song/)
  assert.match(lines.join('\n'), /left out: @ben "first, and here early/)
})
