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
function fakeBrowser({ cards, comments = {}, stopOnOpen, noOpen = [], commentRows = { ok: true, rows: [] } }) {
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
    comments: async () => { calls.push(['comments']); return typeof commentRows === 'function' ? commentRows() : commentRows },
    closeVideo: async () => { calls.push(['close']) },
  }
}
const opened = (b) => b.calls.filter(([k]) => k === 'open').map(([, u]) => u)
const opts = { keywords: ['one topic'], checks: 20 }

test('keeps recent, popular videos with enough comments, and records what the page shows', async () => {
  const cards = [card(1), card(2, { views: '1.2M' })]
  const lines = []
  const out = await findVideos(fakeBrowser({ cards, comments: { [cards[1].url]: '1,234' } }), empty(), async (l) => lines.push(l), opts)
  assert.equal(out.videos.length, 2)
  const v = out.videos.find((x) => x.url === cards[1].url)
  assert.deepEqual(Object.keys(v).sort(), ['caption', 'comments', 'creator', 'found', 'matches', 'posted', 'read', 'topic', 'url', 'views'])
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
  const out = await findVideos(b, empty(), undefined, { keywords: ['a', 'b', 'c'], checks: 12 })
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
  const out = await findVideos(fakeBrowser({ cards }), empty(), undefined, { keywords: ['a', 'b', 'c', 'd', 'e', 'f'], checks: 100 })
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

test('saves the comments about the topics with each kept video, and only reads comments of kept videos', async () => {
  const cards = [card(1), card(2), card(3)]
  const rows = [
    { handle: 'ana', text: 'My screen time is 11 hours a day, brainrot for real' },
    { handle: 'ben', text: 'love this song so much, the editing is great' },
    { handle: 'maker1', text: 'the creator replying about screen time on their own video' },
    { handle: 'cy', text: 'trying a digital detox this week, procrastinating less' },
  ]
  const comments = { [cards[2].url]: '3' }
  const lines = []
  const b = fakeBrowser({ cards, comments, commentRows: { ok: true, rows } })
  const out = await findVideos(b, empty(), async (l) => lines.push(l), { ...opts, commentTopics: ['screen time', 'brain rot', 'digital detox', 'procrastinat'] })
  assert.equal(out.videos.length, 2)
  assert.equal(b.calls.filter(([k]) => k === 'comments').length, 2, 'the video with too few comments is not read')
  const v = out.videos.find((x) => x.creator === 'maker1')
  assert.equal(v.read, 4)
  assert.deepEqual(v.matches.map((c) => c.handle), ['ana', 'cy'], 'off-topic and the creator\'s own comments are left out')
  assert.deepEqual(v.matches[0].topics, ['screen time', 'brain rot'])
  assert.match(lines.join('\n'), /2 of 4 comments are about the topics/)
  assert.match(lines.join('\n'), /kept 2 with 5 comments about the topics/)
})

test('a kept video whose comments will not load is still listed, with nothing read', async () => {
  const cards = [card(1)]
  const lines = []
  const out = await findVideos(fakeBrowser({ cards, commentRows: { ok: false, rows: [] } }), empty(), async (l) => lines.push(l), opts)
  assert.equal(out.videos.length, 1)
  assert.equal(out.videos[0].read, 0)
  assert.deepEqual(out.videos[0].matches, [])
  assert.match(lines.join('\n'), /comments did not load/)
})

test('Claude sees every cleaned comment, and its pick replaces the topic check', async () => {
  const cards = [card(1)]
  const rows = [
    { handle: 'ana', text: 'honestly i lose my whole evenings to my phone now' },
    { handle: 'maker1', text: 'the creator replying about screen time on their own video' },
    { handle: 'ben', text: 'screen time for kids at www.example.com is great' },
    { handle: 'cy', text: 'what a lovely song, I really love this video' },
    { handle: 'dee', text: 'my screen time says 9 hours a day, brainrot is real' },
  ]
  const sent = []
  const judge = async (rs) => { sent.push(rs.map((r) => r.handle)); return rs.filter((r) => r.handle === 'ana') }
  const lines = []
  const out = await findVideos(fakeBrowser({ cards, commentRows: { ok: true, rows } }), empty(), async (l) => lines.push(l), { ...opts, judge })
  assert.deepEqual(sent, [['ana', 'cy', 'dee']], 'all of them, but not the creator or the promotion')
  assert.deepEqual(out.videos[0].matches, [{ handle: 'ana', text: rows[0].text, topics: ['digital habits'] }])
  assert.equal(out.aiError, '')
  assert.match(lines.join('\n'), /3 comments sent to Claude/)
})

test('Claude is not asked when there is no comment left to check', async () => {
  let asked = 0
  const rows = [{ handle: 'maker1', text: 'the creator replying on their own video here' }]
  const out = await findVideos(fakeBrowser({ cards: [card(1)], commentRows: { ok: true, rows } }), empty(), undefined, { ...opts, judge: async () => { asked++; return [] } })
  assert.equal(asked, 0)
  assert.deepEqual(out.videos[0].matches, [])
})

test('when Claude cannot be reached, the comment topics are used and Claude is not asked again', async () => {
  const cards = [card(1), card(2)]
  const rows = [{ handle: 'ana', text: 'my screen time is awful and brainrot is real' }, { handle: 'cy', text: 'what a lovely song, I really love this video' }]
  let asked = 0
  const judge = async () => { asked++; throw new Error('The Claude credit balance or spend limit has run out.') }
  const lines = []
  const out = await findVideos(fakeBrowser({ cards, commentRows: { ok: true, rows } }), empty(), async (l) => lines.push(l), { ...opts, judge })
  assert.equal(asked, 1)
  assert.equal(out.aiError, 'The Claude credit balance or spend limit has run out.')
  assert.equal(out.videos.length, 2)
  assert.ok(out.videos.every((v) => v.matches.length === 1 && v.matches[0].handle === 'ana'))
  assert.match(lines.join('\n'), /Claude could not check the comments .* uses the comment topics instead/)
})

test('when no comment matches, the log shows a few that were looked at', async () => {
  const rows = [{ handle: 'ana', text: 'what a lovely song, I really love this one' }, { handle: 'ben', text: 'first, and here early too friends' }]
  const lines = []
  const out = await findVideos(fakeBrowser({ cards: [card(1)], commentRows: { ok: true, rows } }), empty(), async (l) => lines.push(l), opts)
  assert.deepEqual(out.videos[0].matches, [])
  assert.match(lines.join('\n'), /left out: @ana "what a lovely song/)
  assert.match(lines.join('\n'), /left out: @ben "first, and here early/)
})
