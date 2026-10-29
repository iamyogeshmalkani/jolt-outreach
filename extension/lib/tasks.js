// What each kind of run does, written against a small `browser` object (search, open, video, comments, pause)
// so it can be tested without Chrome. background.js supplies the real one.
import {
  LIMITS, QUERIES, VIDEO_QUERIES, isCandidate, isVideoCandidate, makePerson, makeVideo, parseCount,
  pickQueries, shuffled, todayIso,
} from './rules.js'

export class Stop extends Error {}

const creatorOf = (url) => (/\/@([^/]+)\/video/.exec(url) || [])[1] || ''

// ------------------------------------------------------------------- tasks
export async function findVideos(browser, known, seen, log = async () => {}) {
  const out = { videos: [], people: [], stopped: '' }
  const today = todayIso()
  try {
    const cands = []
    for (const q of pickQueries(VIDEO_QUERIES, LIMITS.videoQueries)) {
      cands.push(...(await browser.search(q)).slice(0, 8).map((u) => [q, u]))
      await browser.pause()
    }
    for (const [query, url] of shuffled(cands).slice(0, LIMITS.videoScan)) {
      if (out.videos.length >= LIMITS.videoMax) break
      const creator = creatorOf(url)
      if (seen.urls.has(url) || known.urls.has(url) || known.creators.has(creator.toLowerCase())) continue
      await browser.open(url)
      const info = await browser.video()
      seen.urls.add(url)
      if (!info?.caption) await log(`@${creator}: could not read the caption (TikTok's layout may have changed)`)
      if (!isVideoCandidate(info?.caption, parseCount(info?.comments))) {
        await log(`@${creator}: not a fit (${info?.comments || '0'} comments)`)
        continue
      }
      known.creators.add(creator.toLowerCase())
      out.videos.push(makeVideo(info, { creator, url, query }, today))
      await log(`@${creator}: queued (${info.comments} comments)`)
      await browser.pause(2, 5)
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
  let opened = 0, fails = 0
  try {
    const cands = []
    for (const q of pickQueries(QUERIES, LIMITS.peopleQueries)) {
      cands.push(...(await browser.search(q)).slice(0, 6).map((u) => [q, u]))
      await browser.pause()
    }
    for (const [query, url] of shuffled(cands)) {
      if (opened >= LIMITS.peopleVideos || out.people.length >= LIMITS.targetPeople || fails >= 3) break
      const creator = creatorOf(url)
      await browser.open(url)
      const page = await browser.comments()
      if (!page?.ok) {
        fails++
        await log(`@${creator}: comments did not load`)
        continue
      }
      opened++
      fails = 0
      let added = 0
      for (const row of page.rows) {
        const key = row.handle.toLowerCase()
        if (known.handles.has(key) || seen.handles.has(key) || !isCandidate(row.handle, row.text, creator)) continue
        seen.handles.add(key)
        out.people.push(makePerson(row, { creator, query, url }, today))
        added++
      }
      await log(`@${creator}: ${page.rows.length} comments, ${added} new people`)
      await browser.pause(2, 5)
    }
  } catch (e) {
    if (!(e instanceof Stop)) throw e
    out.stopped = e.message
  }
  out.people = out.people.slice(0, LIMITS.targetPeople)
  return out
}
