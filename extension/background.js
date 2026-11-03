// Runs the finder inside your own Chrome: opens a small TikTok window, looks for recent popular videos on your topics the way a
// person would, reads the top comments of each one, and saves the links and the comments about your topics to the `data` branch of your GitHub repo, where the hosted page picks them up.
import { publishVideos, fetchKnown } from './lib/github.js'
import { clickCard, closeVideo, readCommentsPage, readGuard, readOpenVideo, readSearchCards } from './lib/pages.js'
import { DEFAULTS, withDefaults } from './lib/settings.js'
import { Stop, findVideos } from './lib/tasks.js'
import { LIMITS } from './lib/rules.js'
import { pickRelevant } from './lib/llm.js'

const store = chrome.storage.local
const getSettings = async () => withDefaults((await store.get('settings')).settings || {})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pause = (a = 1.5, b = 4) => sleep((a + Math.random() * (b - a)) * 1000)

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

function makeBrowser(tabId, commentsToRead) {
  const guard = async (hasResults = true) => {
    const g = await exec(tabId, readGuard)
    if (g?.verify) throw new Stop('TikTok is showing a verification check. Solve it in Chrome, then run again.')
    if (!hasResults && g?.loggedOutHint) throw new Stop('You are logged out of TikTok in this Chrome. Log in, then run again.')
  }
  return {
    pause,
    async search(query) {
      await navigate(tabId, 'https://www.tiktok.com/search/video?q=' + encodeURIComponent(query))
      await sleep(2500)
      const cards = (await exec(tabId, readSearchCards)) || []
      await guard(cards.length > 0)
      return cards
    },
    // Click the result like a person would. If it is not on this page, open the video's own page instead.
    async openVideo(url) {
      const clicked = await exec(tabId, clickCard, [new URL(url).pathname])
      if (!clicked) {
        await navigate(tabId, url)
        await sleep(3500)
      }
      await guard()
      return exec(tabId, readOpenVideo)
    },
    comments: () => exec(tabId, readCommentsPage, [commentsToRead]),
    closeVideo: () => exec(tabId, closeVideo),
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
    await log('Started: finding videos')
    const cfg = { repo: s.repo.trim(), token: s.token.trim(), ...(s.api ? { api: s.api } : {}) } // `api` is only set by tests
    const known = await fetchKnown(cfg)
    const { rejected: saved = {} } = await store.get('rejected')
    const memory = { ...saved } // videos opened before and found to have too few comments; changed by the run
    await store.remove(['seen', 'videos']) // left by older versions

    win = await chrome.windows.create({ url: 'about:blank', focused: false }) // no fixed size: a size that does not fit the screen is rejected
    const browser = makeBrowser(win.tabs[0].id, Math.min(LIMITS.maxCommentsRead, Math.max(10, Math.round(Number(s.commentsPerVideo)) || DEFAULTS.commentsPerVideo)))
    let result
    try {
      result = await findVideos(browser, known, log, {
        keywords: s.keywords,
        checks: Math.min(LIMITS.maxVideos, Math.max(1, Math.round(Number(s.videosPerRun)) || DEFAULTS.videosPerRun)),
        minComments: Number(s.minComments) || DEFAULTS.minComments,
        minViews: Number.isFinite(Number(s.minViews)) ? Number(s.minViews) : DEFAULTS.minViews,
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
      await patchStatus({ error: result.stopped, message: found ? `Saved ${found} videos and ${comments} comments before stopping.` : '' })
    } else {
      const note = result.aiError ? ` Claude was not used for part of this run: ${result.aiError}` : ''
      await patchStatus({ message: (found ? `Saved ${found} videos and ${comments} comments. The page shows them within about 5 minutes.` : 'No new videos this time.') + note })
    }
    await patchStatus({ lastRun: { at: Date.now(), found } })
    chrome.action.setBadgeBackgroundColor({ color: '#b5fc4f' })
    chrome.action.setBadgeText({ text: found ? String(found) : '' })
    await log(result.stopped ? `Stopped: ${result.stopped}` : `Done: ${found} videos, ${comments} comments`)
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
// Runs are started by hand. Only when "run every hour" is switched on is there an alarm. Older versions also set a video alarm, so an update clears all alarms first.
async function schedule() {
  const s = await getSettings()
  if (!s.auto) {
    await chrome.alarms.clearAll()
    return
  }
  if (!(await chrome.alarms.get('people'))) {
    chrome.alarms.create('people', { delayInMinutes: 3 + Math.random() * 10, periodInMinutes: 60 })
  }
}

chrome.runtime.onInstalled.addListener(() => chrome.alarms.clearAll().then(schedule))
chrome.runtime.onStartup.addListener(schedule)

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'people') return
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
