// What a run does, written against a small `browser` object so it can be tested without Chrome.
// background.js supplies the real one:
//   search(query) -> [{ url, caption, views, creator }]   the video results on the search page
//   openVideo(url) -> { opened, caption, comments, markers }  opens one result over the search page; `comments` is its comment count
//   closeVideo()                                          back to the results
//   pause(a, b)                                           a short, random wait
import { DEFAULT_COMPETITORS, DEFAULT_KEYWORDS, LIMITS, parseCount, pickRunQueries, videoAgeDays, videoKey, videoPosted } from './rules.js'

export class Stop extends Error {}

const creatorOf = (url) => (/\/@([^/]+)\/video/.exec(url) || [])[1] || ''

async function notOpened(browser, creator, info, log) {
  const seen = info?.markers?.length ? ` The page had: ${info.markers.join(', ')}.` : ''
  await log(`@${creator}: the video did not open.${seen}`)
  await browser.closeVideo()
}

// Finds recent, popular videos on the topics. Nothing is read from the comments: a person looks through those by hand.
// A video is kept when it was posted recently, has plenty of views, and has enough comments. Its comment count is only
// known once it is opened, so the most-viewed results of each search are opened first.
//   known     { keys: Set }  videos already in the list or marked complete (by video number); never found again
//   memory    { [videoKey]: { n, at } } videos opened and found to have too few comments, changed in place, so they are not opened again soon
//   checks    how many videos one run may open
export async function findVideos(browser, known, log = async () => {}, {
  competitors = DEFAULT_COMPETITORS, keywords = DEFAULT_KEYWORDS, checks = 100, minComments = 20, minViews = 10000, maxAgeDays = 60, memory = {},
} = {}) {
  const out = { videos: [], stopped: '' }
  const runAt = new Date().toISOString()
  const queries = pickRunQueries(competitors, keywords, Math.ceil(checks / 4))
  const perQuery = Math.ceil(checks / Math.max(1, queries.length))
  let opens = 0
  let fails = 0
  const skipped = { known: 0, old: 0, unpopular: 0, recent: 0, few: 0 }
  const tried = new Set() // two searches can return the same video; open it once per run
  const finished = () => opens >= checks || out.videos.length >= LIMITS.targetVideos || fails >= LIMITS.maxFails
  try {
    for (const query of queries) {
      if (finished()) break
      const cards = await browser.search(query)
      // Recent, popular and new to us; the most viewed first.
      const pool = []
      for (const card of cards) {
        const key = videoKey(card.url)
        const age = videoAgeDays(card.url)
        const views = parseCount(card.views)
        const before = memory[key]
        if (tried.has(key) || known.keys.has(key)) skipped.known++
        else if (age !== null && age > maxAgeDays) skipped.old++
        else if (views !== null && views < minViews) skipped.unpopular++
        else if (before && Date.now() - before.at < LIMITS.rejectDays * 86_400_000) skipped.recent++
        else pool.push({ card, key, views })
      }
      pool.sort((a, b) => (b.views ?? -1) - (a.views ?? -1))
      await log(`Search "${query}": ${cards.length} results, ${pool.length} recent and popular`)
      let here = 0
      for (const { card, key, views } of pool) {
        if (here >= perQuery || finished()) break
        tried.add(key)
        const creator = creatorOf(card.url)
        const info = await browser.openVideo(card.url)
        here++
        opens++
        if (!info?.opened) {
          fails++
          await notOpened(browser, creator, info, log)
          continue
        }
        fails = 0
        const comments = parseCount(info.comments)
        if (comments === null) {
          await log(`@${creator}: could not read the comment count`)
        } else if (comments < minComments) {
          skipped.few++
          memory[key] = { n: comments, at: Date.now() }
          await log(`@${creator}: only ${comments} comments`)
        } else {
          out.videos.push({
            url: card.url, creator, caption: (info.caption || card.caption || '').slice(0, 300), views, comments,
            topic: query, posted: videoPosted(card.url), found: runAt,
          })
          known.keys.add(key)
          await log(`@${creator}: kept (${comments} comments${views !== null ? `, ${card.views} views` : ''})`)
        }
        await browser.closeVideo()
        await browser.pause(1.5, 4)
      }
      await browser.pause()
    }
  } catch (e) {
    if (e instanceof Stop) out.stopped = e.message
    else throw e
  }
  await log(`Opened ${opens} videos, kept ${out.videos.length}. Passed over ${skipped.known} already listed, ${skipped.old} too old, ${skipped.unpopular} with few views, ${skipped.recent} checked recently, ${skipped.few} with too few comments.`)
  return out
}
