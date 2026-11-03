// What a run does, written against a small `browser` object so it can be tested without Chrome.
// background.js supplies the real one:
//   search(query) -> [{ url, caption }]     the reel links found for a keyword (Instagram's search, then the hashtag of the keyword)
//   openVideo(url) -> { opened, isVideo, caption, likes, comments, creator, markers }   opens one reel on its own page
//   comments() -> { ok, rows }              the first comments of the opened reel, as { handle, text }
//   pause(a, b)                             a short, random wait
import { DEFAULT_COMMENT_TOPICS, DEFAULT_KEYWORDS, LIMITS, cleanComments, keywordQueries, labelTopics, likelyAboutHabits, matchTopics, parseCount, pickQueries, reelUrl, videoAgeDays, videoKey, videoPosted } from './rules.js'

export class Stop extends Error {}

// Finds recent, popular reels on the keywords, and the comments on them about the writer's own digital habits (screen time, brain rot,
// doomscrolling, phone addiction...). With `judge` Claude decides which comments those are; without it (or when Claude can't be reached,
// after which the rest of the run goes without it) a comment is kept when it mentions one of the comment topics.
// A reel is kept when it is a video, was posted recently (read from its shortcode, without opening it), and has enough likes.
// Instagram's search does not show likes, so a reel is opened to read them; creators can hide their likes, and a reel whose likes
// are hidden is kept.
//   known     { keys: Set }  reels already in the list or marked complete (by shortcode); never found again
//   memory    { [shortcode]: { n, at } } reels opened and found to have too few likes, changed in place, so they are not opened again soon
//   checks    how many reels one run may open
export async function findVideos(browser, known, log = async () => {}, {
  keywords = DEFAULT_KEYWORDS, checks = 40, minLikes = 1000, maxAgeDays = 60, commentTopics = DEFAULT_COMMENT_TOPICS, memory = {}, judge = null,
} = {}) {
  const out = { videos: [], stopped: '', aiError: '' }
  const runAt = new Date().toISOString()
  const queries = pickQueries(keywordQueries(keywords), Math.ceil(checks / 4))
  const perQuery = Math.ceil(checks / Math.max(1, queries.length))
  let opens = 0
  let fails = 0
  let totalMatches = 0
  let sentToClaude = 0
  const skipped = { known: 0, old: 0, recent: 0, few: 0, notVideo: 0 }
  const tried = new Set() // two searches can return the same reel; open it once per run
  const finished = () => opens >= checks || out.videos.length >= LIMITS.targetVideos || fails >= LIMITS.maxFails
  try {
    for (const query of queries) {
      if (finished()) break
      const cards = await browser.search(query)
      const pool = []
      for (const card of cards) {
        const key = videoKey(card.url)
        const age = videoAgeDays(card.url)
        const before = memory[key]
        if (tried.has(key) || known.keys.has(key)) skipped.known++
        else if (age !== null && age > maxAgeDays) skipped.old++
        else if (before && Date.now() - before.at < LIMITS.rejectDays * 86_400_000) skipped.recent++
        else pool.push({ card, key })
      }
      await log(`Search "${query}": ${cards.length} results, ${pool.length} recent and new`)
      let here = 0
      for (const { card, key } of pool) {
        if (here >= perQuery || finished()) break
        tried.add(key)
        const info = await browser.openVideo(card.url)
        here++
        opens++
        if (!info?.opened) {
          fails++
          const seen = info?.markers?.length ? ` The page had: ${info.markers.join(', ')}.` : ''
          await log(`${key}: the reel did not open.${seen}`)
        } else {
          fails = 0
          const likes = parseCount(info.likes)
          const creator = info.creator || ''
          if (!info.isVideo) {
            skipped.notVideo++
            memory[key] = { n: 0, at: Date.now() }
            await log(`${key}: not a video`)
          } else if (likes !== null && likes < minLikes) {
            skipped.few++
            memory[key] = { n: likes, at: Date.now() }
            await log(`${creator ? '@' + creator : key}: only ${likes} likes`)
          } else {
            const page = await browser.comments()
            const rows = page?.ok ? page.rows : []
            const cleaned = cleanComments(rows, creator)
            let matches = null
            if (judge) {
              const sent = likelyAboutHabits(cleaned, commentTopics) // only these cost anything
              try {
                matches = sent.length ? labelTopics(await judge(sent), commentTopics) : []
                sentToClaude += sent.length
              } catch (e) {
                judge = null // do not try again on every reel
                out.aiError = e.message
                await log(`Claude could not check the comments (${e.message}) The rest of this run uses the comment topics instead.`)
              }
            }
            if (!matches) matches = matchTopics(cleaned, commentTopics)
            out.videos.push({
              url: reelUrl(card.url), creator, caption: (info.caption || card.caption || '').slice(0, 300), likes,
              comments: parseCount(info.comments), topic: query, posted: videoPosted(card.url), found: runAt, read: rows.length, matches,
            })
            known.keys.add(key)
            totalMatches += matches.length
            const who = creator ? '@' + creator : key
            const counts = likes !== null ? `${likes} likes` : 'likes hidden'
            await log(page?.ok
              ? `${who}: kept (${counts}), ${matches.length} of the top ${rows.length} comments are about their habits`
              : `${who}: kept (${counts}), but its comments did not load${page?.diag ? `. The page had: ${page.diag}` : ''}`)
          }
        }
        await browser.pause(3, 7)
      }
      await browser.pause(2, 5)
    }
  } catch (e) {
    if (e instanceof Stop) out.stopped = e.message
    else throw e
  }
  await log(`Opened ${opens} reels, kept ${out.videos.length} with ${totalMatches} comments about digital habits${sentToClaude ? ` (${sentToClaude} comments sent to Claude)` : ''}. Passed over ${skipped.known} already listed, ${skipped.old} too old, ${skipped.recent} checked recently, ${skipped.few} with too few likes, ${skipped.notVideo} that were not videos.`)
  return out
}
