// What each kind of run does, written against a small `browser` object so it can be tested without Chrome.
// background.js supplies the real one:
//   search(query) -> [{ url, caption, views, creator }]   the video results on the search page
//   openVideo(url) -> { opened, caption, likes, comments, markers }  opens one result over the search page
//   comments() -> { ok, rows }                              the comments of the opened video
//   closeVideo()                                            back to the results
//   pause(a, b)                                             a short, random wait
import {
  LIMITS, QUERIES, TOPIC, VIDEO_QUERIES, isCandidate, isVideoCandidate, makePerson, makeVideo, parseCount,
  pickQueries, shuffled, todayIso,
} from './rules.js'

export class Stop extends Error {}

const creatorOf = (url) => (/\/@([^/]+)\/video/.exec(url) || [])[1] || ''

async function notOpened(browser, creator, info, log) {
  const seen = info?.markers?.length ? ` The page had: ${info.markers.join(', ')}.` : ''
  await log(`@${creator}: the video did not open.${seen}`)
  await browser.closeVideo()
}

export async function findVideos(browser, known, seen, log = async () => {}) {
  const out = { videos: [], people: [], stopped: '' }
  const today = todayIso()
  const queries = pickQueries(VIDEO_QUERIES, LIMITS.videoQueries)
  const perQuery = Math.ceil(LIMITS.videoScan / queries.length)
  try {
    for (const query of queries) {
      if (out.videos.length >= LIMITS.videoMax) break
      const cards = await browser.search(query)
      await log(`Search "${query}": ${cards.length} results`)
      let opened = 0
      for (const card of shuffled(cards)) {
        if (opened >= perQuery || out.videos.length >= LIMITS.videoMax) break
        const creator = creatorOf(card.url)
        if (seen.urls.has(card.url) || known.urls.has(card.url) || known.creators.has(creator.toLowerCase())) continue
        if (card.caption && !TOPIC.test(card.caption)) continue // quick check on the caption shown in the results
        const info = await browser.openVideo(card.url)
        opened++
        seen.urls.add(card.url)
        if (!info?.opened) {
          await notOpened(browser, creator, info, log)
          continue
        }
        if (!info.caption) {
          await log(`@${creator}: no caption, skipped`)
          await browser.closeVideo()
          continue
        }
        if (isVideoCandidate(info.caption, parseCount(info.comments))) {
          known.creators.add(creator.toLowerCase())
          out.videos.push(makeVideo(info, { creator, url: card.url, query }, today))
          await log(`@${creator}: queued (${info.comments} comments)`)
        } else {
          await log(`@${creator}: not a fit (${info.comments || '0'} comments)`)
        }
        await browser.closeVideo()
        await browser.pause(2, 5)
      }
      await browser.pause()
    }
  } catch (e) {
    if (!(e instanceof Stop)) throw e
    out.stopped = e.message
  }
  return out
}

export async function findPeople(browser, known, seen, log = async () => {}) {
  const out = { videos: [], people: [], stopped: '' }
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
