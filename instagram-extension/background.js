// Runs the Instagram finder inside your own Chrome: opens a small Instagram window (you are already logged in there), looks for recent
// popular reels on your keywords the way a person would, reads their top comments, and saves the links and the comments about your habits to the `data` branch of your GitHub repo, where the
// hosted page picks them up.
import { publishVideos, fetchKnown } from './lib/github.js'
import { readCommentsPage, readGuard, readOpenVideo, readSearchCards } from './lib/pages.js'
import { pickRelevant } from './lib/llm.js'
import { DEFAULTS } from './lib/settings.js'
import { Stop, findVideos } from './lib/tasks.js'
import { LIMITS, hashtagOf } from './lib/rules.js'

const store = chrome.storage.local
const getSettings = async () => ({ ...DEFAULTS, ...((await store.get('settings')).settings || {}) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pause = (a = 2, b = 5) => sleep((a + Math.random() * (b - a)) * 1000)

async function patchStatus(patch) {
  const { status = {} } = await store.get('status')
  await store.set({ status: { ...status, ...patch } })
}
async function log(text) {
  const { log: lines = [] } = await store.get('log')
  lines.push(`${new Date().toLocaleTimeString()}  ${text}`)
  await store.set({ log: lines.slice(-250) })
}

// ---------------------------------------------------------------- browsing
function navigate(tabId, url, timeout = 30_000) {
  return new Promise((resolve) => {
    const finish = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated)
      clearTimeout(timer)
      resolve()
    }
    const onUpdated = (id, info) => id === tabId && info.status === 'complete' && finish()
    const timer = setTimeout(finish, timeout)
    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.tabs.update(tabId, { url })
  })
}

async function exec(tabId, func, args = [], world = 'ISOLATED') {
  const [injected] = await chrome.scripting.executeScript({ target: { tabId }, func, args, world })
  return injected?.result
}

function makeBrowser(tabId) {
  const guard = async () => {
    const g = await exec(tabId, readGuard)
    if (g?.verify) throw new Stop('Instagram is asking for a check or has limited this account. Open Instagram in Chrome and sort it out, then run again.')
    if (g?.loggedOut) throw new Stop('You are logged out of Instagram in this Chrome. Log in, then run again.')
  }
  return {
    pause,
    // Instagram's own search first; when it shows nothing, the hashtag of the keyword.
    async search(query) {
      await navigate(tabId, 'https://www.instagram.com/explore/search/keyword/?q=' + encodeURIComponent(query))
      await sleep(2500)
      await guard()
      let cards = (await exec(tabId, readSearchCards)) || []
      const tag = hashtagOf(query)
      if (!cards.length && tag) {
        await pause(2, 4)
        await navigate(tabId, `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`)
        await sleep(2500)
        await guard()
        cards = (await exec(tabId, readSearchCards)) || []
      }
      return cards
    },
    comments: () => exec(tabId, readCommentsPage, [LIMITS.topComments]),
    async openVideo(url) {
      await navigate(tabId, url)
      await guard()
      return exec(tabId, readOpenVideo)
    },
  }
}

// --------------------------------------------------------------- one run
let busy = false

async function run(manual, delayMs = 0) {
  if (busy) return
  const s = await getSettings()
  if (!manual && (s.paused || !s.auto)) return
  if (!s.token) {
    await patchStatus({ error: 'Add your GitHub token in Settings first.', running: false })
    return
  }
  busy = true
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20_000) // keeps Chrome from stopping this worker mid-run
  let win
  try {
    if (delayMs) await sleep(delayMs) // random timing, so hourly runs don't land on the exact minute
    await patchStatus({ running: true, error: '', message: '' })
    await log('Started: finding reels')
    const cfg = { repo: s.repo.trim(), token: s.token.trim(), ...(s.api ? { api: s.api } : {}) } // `api` is only set by tests
    const known = await fetchKnown(cfg)
    const { rejected: saved = {} } = await store.get('rejected')
    const memory = { ...saved } // reels opened before and found to have too few likes; changed by the run

    win = await chrome.windows.create({ url: 'about:blank', focused: false }) // no fixed size: a size that does not fit the screen is rejected
    const browser = makeBrowser(win.tabs[0].id)
    let result
    try {
      result = await findVideos(browser, known, log, {
        keywords: s.keywords,
        checks: Math.min(LIMITS.maxVideos, Math.max(1, Math.round(Number(s.videosPerRun)) || DEFAULTS.videosPerRun)),
        minLikes: Number.isFinite(Number(s.minLikes)) ? Number(s.minLikes) : DEFAULTS.minLikes,
        maxAgeDays: Number(s.maxAgeDays) || DEFAULTS.maxAgeDays,
        commentTopics: s.commentTopics,
        judge: s.aiKey?.trim() ? (rows) => pickRelevant({ key: s.aiKey, model: s.aiModel, ...(s.aiApi ? { api: s.aiApi } : {}) }, rows, { log }) : null, // `aiApi` is only set by tests
        memory,
      })
    } finally {
      const cutoff = Date.now() - LIMITS.rejectDays * 86_400_000
      await store.set({ rejected: Object.fromEntries(Object.entries(memory).filter(([, v]) => v.at > cutoff).slice(-4000)) })
    }

    const found = result.videos.length
    const comments = result.videos.reduce((n, v) => n + v.matches.length, 0)
    if (found) await publishVideos(cfg, result.videos)

    if (result.stopped) {
      if (!manual) await store.set({ settings: { ...s, paused: true } })
      await patchStatus({ error: result.stopped, message: found ? `Saved ${found} reels and ${comments} comments before stopping.` : '' })
    } else {
      const note = result.aiError ? ` Claude was not used for part of this run: ${result.aiError}` : ''
      await patchStatus({ message: (found ? `Saved ${found} reels and ${comments} comments. The page shows them within about 5 minutes.` : 'No new reels this time.') + note })
    }
    await patchStatus({ lastRun: { at: Date.now(), found } })
    chrome.action.setBadgeBackgroundColor({ color: '#b5fc4f' })
    chrome.action.setBadgeText({ text: found ? String(found) : '' })
    await log(result.stopped ? `Stopped: ${result.stopped}` : `Done: ${found} reels, ${comments} comments`)
  } catch (e) {
    await patchStatus({ error: e.message || String(e) })
    await log(`Failed: ${e.message || e}`)
  } finally {
    clearInterval(keepAlive)
    if (win?.id !== undefined) chrome.windows.remove(win.id).catch(() => {})
    await patchStatus({ running: false })
    busy = false
  }
}

// -------------------------------------------------------------- schedule
// Runs are started by hand. Only when "run every hour" is switched on is there an alarm.
async function schedule() {
  const s = await getSettings()
  if (!s.auto) {
    await chrome.alarms.clearAll()
    return
  }
  if (!(await chrome.alarms.get('reels'))) {
    chrome.alarms.create('reels', { delayInMinutes: 3 + Math.random() * 10, periodInMinutes: 60 })
  }
}

chrome.runtime.onInstalled.addListener(() => chrome.alarms.clearAll().then(schedule))
chrome.runtime.onStartup.addListener(schedule)

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'reels') return
  const s = await getSettings()
  const hour = new Date().getHours()
  if (hour < s.startHour || hour >= s.endHour) return
  run(false, Math.random() * 150_000)
})

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'run') run(true)
  if (msg.type === 'resume') getSettings().then((s) => store.set({ settings: { ...s, paused: false } })).then(() => patchStatus({ error: '' }))
  if (msg.type === 'reschedule') chrome.alarms.clearAll().then(schedule)
})
