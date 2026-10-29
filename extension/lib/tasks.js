// What a run does, written against a small `browser` object so it can be tested without Chrome.
// background.js supplies the real one:
//   search(query) -> [{ url, caption, views, creator }]   the video results on the search page
//   openVideo(url) -> { opened, caption, markers }        opens one result over the search page
//   comments() -> { ok, rows }                            the comments of the opened video
//   closeVideo()                                          back to the results
//   pause(a, b)                                           a short, random wait
import { DEFAULT_COMPETITORS, DEFAULT_KEYWORDS, LIMITS, competitorNames, isCandidate, makePerson, pickRunQueries, shuffled, todayIso } from './rules.js'

export class Stop extends Error {}
class AiError extends Error {}

const creatorOf = (url) => (/\/@([^/]+)\/video/.exec(url) || [])[1] || ''

async function notOpened(browser, creator, info, log) {
  const seen = info?.markers?.length ? ` The page had: ${info.markers.join(', ')}.` : ''
  await log(`@${creator}: the video did not open.${seen}`)
  await browser.closeVideo()
}

// Looks through the comments of a few popular videos and collects people who describe their own struggle.
//   judge(rows) -> rows   the AI's pick of the comments that are really about the writer's own habit; it throws if it can't answer,
//                         which ends the run (out.aiError) rather than saving comments nobody has checked
//   competitors, keywords  what to search for: one competitor search and one keyword search per run (see pickRunQueries)
export async function findPeople(browser, known, seen, log = async () => {}, judge, { competitors = DEFAULT_COMPETITORS, keywords = DEFAULT_KEYWORDS } = {}) {
  const out = { people: [], stopped: '', aiError: '' }
  const today = todayIso()
  const runAt = new Date().toISOString()
  const names = competitorNames(competitors)
  const queries = pickRunQueries(competitors, keywords, LIMITS.peopleQueries)
  const perQuery = Math.ceil(LIMITS.peopleVideos / queries.length)
  let opened = 0
  let fails = 0
  try {
    for (const query of queries) {
      if (opened >= LIMITS.peopleVideos || out.people.length >= LIMITS.targetPeople || fails >= 3) break
      const cards = await browser.search(query)
      await log(`Search "${query}": ${cards.length} results`)
      let here = 0
      for (const card of shuffled(cards)) {
        if (here >= perQuery || opened >= LIMITS.peopleVideos || out.people.length >= LIMITS.targetPeople || fails >= 3) break
        const creator = creatorOf(card.url)
        const info = await browser.openVideo(card.url)
        here++
        if (!info?.opened) {
          fails++
          await notOpened(browser, creator, info, log)
          continue
        }
        const page = await browser.comments()
        if (!page?.ok) {
          fails++
          await log(`@${creator}: comments did not load`)
          await browser.closeVideo()
          continue
        }
        opened++
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
  return out
}
