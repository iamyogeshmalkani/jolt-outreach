// What a run does, written against a small `browser` object so it can be tested without Chrome.
// background.js supplies the real one:
//   search(query) -> [{ url, caption, views, creator }]   the video results on the search page
//   openVideo(url) -> { opened, caption, comments, markers }  opens one result over the search page; `comments` is its comment count
//   comments() -> { ok, rows }                            the comments of the opened video
//   closeVideo()                                          back to the results
//   pause(a, b)                                           a short, random wait
import { DEFAULT_COMPETITORS, DEFAULT_KEYWORDS, LIMITS, competitorNames, isCandidate, makePerson, parseCount, pickRunQueries, shuffled, todayIso } from './rules.js'

export class Stop extends Error {}
class AiError extends Error {}

const creatorOf = (url) => (/\/@([^/]+)\/video/.exec(url) || [])[1] || ''

async function notOpened(browser, creator, info, log) {
  const seen = info?.markers?.length ? ` The page had: ${info.markers.join(', ')}.` : ''
  await log(`@${creator}: the video did not open.${seen}`)
  await browser.closeVideo()
}

// Reads the comments of many videos and collects people who talk about the topic.
//   judge(rows) -> rows   the AI's pick of the comments that are about the topic; it throws if it can't answer,
//                         which ends the run (out.aiError) rather than saving comments nobody has checked
//   competitors, keywords  what to search for: about half competitor searches and half keyword searches (see pickRunQueries)
//   videos                 how many videos to read; up to twice as many are opened to find them
//   memory                 { [videoUrl]: { n: comment count when last read, at } }, changed in place. A video with fewer than
//                          LIMITS.minComments comments is flagged and skipped, and one read before is skipped until it has
//                          LIMITS.regrow more comments, so a run spends its time on videos with something new.
export async function findPeople(browser, known, seen, log = async () => {}, judge, { competitors = DEFAULT_COMPETITORS, keywords = DEFAULT_KEYWORDS, videos = 20, memory = {} } = {}) {
  const out = { people: [], stopped: '', aiError: '' }
  const today = todayIso()
  const runAt = new Date().toISOString()
  const names = competitorNames(competitors)
  const maxOpens = videos * 2
  const queries = pickRunQueries(competitors, keywords, Math.ceil(videos / 3))
  const perQuery = Math.ceil(maxOpens / Math.max(1, queries.length))
  let reads = 0
  let opens = 0
  let fails = 0
  const skipped = { few: 0, same: 0 }
  const tried = new Set() // two searches can return the same video; open it once per run
  const finished = () => reads >= videos || opens >= maxOpens || out.people.length >= LIMITS.targetPeople || fails >= LIMITS.maxFails
  try {
    for (const query of queries) {
      if (finished()) break
      const cards = await browser.search(query)
      await log(`Search "${query}": ${cards.length} results`)
      let here = 0
      for (const card of shuffled(cards)) {
        if (here >= perQuery || finished()) break
        if (tried.has(card.url)) continue
        tried.add(card.url)
        const creator = creatorOf(card.url)
        const info = await browser.openVideo(card.url)
        here++
        opens++
        if (!info?.opened) {
          fails++
          await notOpened(browser, creator, info, log)
          continue
        }
        const count = parseCount(info.comments)
        const before = memory[card.url]
        if (count !== null && count < LIMITS.minComments) {
          skipped.few++
          memory[card.url] = { n: count, at: Date.now() }
          await log(`@${creator}: flagged, only ${count} comments`)
          await browser.closeVideo()
          await browser.pause(1, 3)
          continue
        }
        if (count !== null && before && count < before.n + LIMITS.regrow) {
          skipped.same++
          await log(`@${creator}: nothing new (${count} comments, ${before.n} when last read)`)
          await browser.closeVideo()
          await browser.pause(1, 3)
          continue
        }
        const page = await browser.comments()
        if (!page?.ok) {
          fails++
          await log(`@${creator}: comments did not load`)
          await browser.closeVideo()
          continue
        }
        reads++
        fails = 0
        const fresh = page.rows.filter((row) => {
          const key = row.handle.toLowerCase()
          return !known.handles.has(key) && !seen.handles.has(key) && isCandidate(row.handle, row.text, creator)
        })
        let chosen = []
        if (fresh.length) {
          try {
            chosen = await judge(fresh)
          } catch (e) {
            await browser.closeVideo()
            throw new AiError(e.message)
          }
        }
        if (count !== null) memory[card.url] = { n: count, at: Date.now() } // only now, so a video the AI could not check is read again
        let added = 0
        for (const row of chosen) {
          const key = row.handle.toLowerCase()
          if (seen.handles.has(key)) continue // the same person can have two comments on one video
          seen.handles.add(key)
          out.people.push(makePerson(row, { creator, query, url: card.url, runAt, names }, today))
          added++
        }
        await log(`@${creator}: ${page.rows.length} comments, ${fresh.length} to check, ${added} kept`)
        const dropped = fresh.filter((row) => !chosen.includes(row)).slice(0, 3)
        for (const row of dropped) await log(`  left out: "${row.text.replace(/\s+/g, ' ').slice(0, 80)}"`)
        await browser.closeVideo()
        await browser.pause(2, 5)
      }
      await browser.pause()
    }
  } catch (e) {
    if (e instanceof AiError) out.aiError = e.message
    else if (e instanceof Stop) out.stopped = e.message
    else throw e
  }
  out.people = out.people.slice(0, LIMITS.targetPeople)
  await log(`Read ${reads} videos, opened ${opens}. Skipped ${skipped.few} with too few comments and ${skipped.same} with nothing new.`)
  return out
}
