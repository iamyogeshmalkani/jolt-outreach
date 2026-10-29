// Runs the finder inside your own Chrome: opens a small TikTok window, reads results the way a person would,
// and saves what it finds to the `data` branch of your GitHub repo, where the hosted page picks it up.
import { publish, fetchKnown } from './lib/github.js'
import { clickCard, closeVideo, readCommentsPage, readGuard, readOpenVideo, readSearchCards } from './lib/pages.js'
import { DEFAULTS } from './lib/settings.js'
import { Stop, findPeople } from './lib/tasks.js'
import { improve, pickRelevant } from './lib/llm.js'
import { competitorNames } from './lib/rules.js'

const store = chrome.storage.local
const getSettings = async () => ({ ...DEFAULTS, ...((await store.get('settings')).settings || {}) })
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

async function exec(tabId, func, args = []) {
  const [injected] = await chrome.scripting.executeScript({ target: { tabId }, func, args })
  return injected?.result
}

function makeBrowser(tabId) {
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
    closeVideo: () => exec(tabId, closeVideo),
    comments: () => exec(tabId, readCommentsPage),
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
  if (!s.aiKey.trim()) {
    await patchStatus({ error: 'Add an AI key in Settings first. The AI picks which comments are really about a habit.', running: false })
    return
  }
  busy = true
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20_000) // keeps Chrome from stopping this worker mid-run
  let win
  try {
    if (delayMs) await sleep(delayMs) // random timing, so hourly runs don't land on the exact minute
    await patchStatus({ running: true, error: '', message: '' })
    await log('Started: finding people')
    const cfg = { repo: s.repo.trim(), token: s.token.trim(), ...(s.api ? { api: s.api } : {}) } // `api` is only set by tests
    const known = await fetchKnown(cfg)
    for (const h of s.skip.split(/\s+/).filter(Boolean)) known.handles.add(h.toLowerCase().replace(/^@/, ''))
    const { seen: saved = {} } = await store.get('seen')
    const seen = { handles: new Set(saved.handles || []) }

    win = await chrome.windows.create({ url: 'about:blank', focused: false }) // no fixed size: a size that does not fit the screen is rejected
    const browser = makeBrowser(win.tabs[0].id)
    const ai = { provider: s.aiProvider, key: s.aiKey.trim(), model: s.aiModel, ...(s.aiApi ? { api: s.aiApi } : {}) } // `aiApi` is only set by tests
    const { videos: savedVideos = {} } = await store.get('videos')
    const memory = { ...savedVideos } // videos read before, with their comment counts; changed by the run
    let result
    try {
      result = await findPeople(browser, known, seen, log, (rows) => pickRelevant(ai, rows, { names: competitorNames(s.competitors), log }), {
        competitors: s.competitors,
        keywords: s.keywords,
        videos: Math.min(60, Math.max(1, Math.round(Number(s.videosPerRun)) || DEFAULTS.videosPerRun)),
        memory,
      })
    } finally {
      const newest = Object.entries(memory).sort((a, b) => b[1].at - a[1].at).slice(0, 4000)
      await store.set({ videos: Object.fromEntries(newest) })
    }

    const found = result.people.length
    if (found && s.aiKey && s.useAi) {
      await improve(ai, result, log)
    }
    if (found) await publish(cfg, result)
    await store.set({ seen: { handles: [...seen.handles].slice(-3000) } })

    if (result.stopped) {
      if (!manual) await store.set({ settings: { ...s, paused: true } })
      await patchStatus({ error: result.stopped, message: found ? `Saved ${found} people before stopping.` : '' })
    } else if (result.aiError) {
      await patchStatus({ error: result.aiError, message: found ? `Saved ${found} people before the AI stopped answering.` : '' })
    } else {
      await patchStatus({ message: found ? `Saved ${found} people. The page shows them within about 5 minutes.` : 'Nothing new found this time.' })
    }
    await patchStatus({ lastRun: { at: Date.now(), found } })
    chrome.action.setBadgeBackgroundColor({ color: '#b5fc4f' })
    chrome.action.setBadgeText({ text: found ? String(found) : '' })
    await log(result.stopped ? `Stopped: ${result.stopped}` : result.aiError ? `Stopped: ${result.aiError}` : `Done: ${found} people`)
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
