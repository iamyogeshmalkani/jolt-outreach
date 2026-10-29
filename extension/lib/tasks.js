// What a run does, written against a small `browser` object so it can be tested without Chrome.
// background.js supplies the real one:
//   search(query) -> [{ url, caption, views, creator }]   the video results on the search page
//   openVideo(url) -> { opened, caption, markers }        opens one result over the search page
//   comments() -> { ok, rows }                            the comments of the opened video
//   closeVideo()                                          back to the results
//   pause(a, b)                                           a short, random wait
import { LIMITS, QUERIES, isCandidate, makePerson, pickQueries, shuffled, todayIso } from './rules.js'

export class Stop extends Error {}

const creatorOf = (url) => (/\/@([^/]+)\/video/.exec(url) || [])[1] || ''

async function notOpened(browser, creator, info, log) {
  const seen = info?.markers?.length ? ` The page had: ${info.markers.join(', ')}.` : ''
  await log(`@${creator}: the video did not open.${seen}`)
  await browser.closeVideo()
}

// Looks through the comments of a few popular videos and collects people who describe their own struggle.
export async function findPeople(browser, known, seen, log = async () => {}) {
  const out = { people: [], stopped: '' }
  const today = todayIso()
  const queries = pickQueries(QUERIES, LIMITS.peopleQueries)
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
        let added = 0
        for (const row of page.rows) {
          const key = row.handle.toLowerCase()
          if (known.handles.has(key) || seen.handles.has(key) || !isCandidate(row.handle, row.text, creator)) continue
          seen.handles.add(key)
          out.people.push(makePerson(row, { creator, query, url: card.url }, today))
          added++
        }
        await log(`@${creator}: ${page.rows.length} comments, ${added} new people`)
        await browser.closeVideo()
        await browser.pause(2, 5)
      }
      await browser.pause()
    }
  } catch (e) {
    if (!(e instanceof Stop)) throw e
    out.stopped = e.message
  }
  out.people = out.people.slice(0, LIMITS.targetPeople)
  return out
}
