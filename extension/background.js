// Runs the finder inside your own Chrome: opens a small TikTok window, reads results the way a person would,
// and saves what it finds to the `data` branch of your GitHub repo, where the hosted page picks it up.
import { publish, fetchKnown } from './lib/github.js'
import { clickCard, closeVideo, readCommentsPage, readGuard, readOpenVideo, readSearchCards } from './lib/pages.js'
import { DEFAULTS } from './lib/settings.js'
import { Stop, findPeople, findVideos } from './lib/tasks.js'

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
  await store.set({ log: lines.slice(-40) })
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

async function run(task, manual, delayMs = 0) {
  if (busy) return
  const s = await getSettings()
  if (!manual && (s.paused || !s.enabled)) return
  if (!s.token) {
    await patchStatus({ error: 'Add your GitHub token in Settings first.', running: false })
    return
  }
  busy = true
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20_000) // keeps Chrome from stopping this worker mid-run
  let win
  try {
    if (delayMs) await sleep(delayMs) // random timing, so hourly runs don't land on the exact minute
    await patchStatus({ running: true, task, error: '', message: '' })
    await log(`Started: ${task === 'people' ? 'finding people' : 'finding videos'}`)
    const cfg = { repo: s.repo.trim(), token: s.token.trim(), ...(s.api ? { api: s.api } : {}) } // `api` is only set by tests
    const known = await fetchKnown(cfg)
    for (const h of s.skip.split(/\s+/).filter(Boolean)) known.handles.add(h.toLowerCase().replace(/^@/, ''))
    const { seen: saved = {} } = await store.get('seen')
    const seen = { urls: new Set(saved.urls || []), handles: new Set(saved.handles || []) }

    win = await chrome.windows.create({ url: 'about:blank', focused: false }) // no fixed size: a size that does not fit the screen is rejected
    const browser = makeBrowser(win.tabs[0].id)
    const result = await (task === 'people' ? findPeople : findVideos)(browser, known, seen, log)

    const found = result.people.length + result.videos.length
    if (found) await publish(cfg, result)
    await store.set({ seen: { urls: [...seen.urls].slice(-3000), handles: [...seen.handles].slice(-3000) } })

    const what = task === 'people' ? `${result.people.length} people` : `${result.videos.length} videos`
    if (result.stopped) {
      if (!manual) await store.set({ settings: { ...s, paused: true } })
      await patchStatus({ error: result.stopped, message: found ? `Saved ${what} before stopping.` : '' })
    } else {
      await patchStatus({ message: found ? `Saved ${what}. The page shows them within about 5 minutes.` : 'Nothing new found this time.' })
    }
    await patchStatus({ lastRun: { at: Date.now(), task, found } })
    chrome.action.setBadgeBackgroundColor({ color: '#b5fc4f' })
    chrome.action.setBadgeText({ text: found ? String(found) : '' })
    await log(result.stopped ? `Stopped: ${result.stopped}` : `Done: ${what}`)
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
async function schedule() {
  const s = await getSettings()
  if (!s.enabled) {
    await chrome.alarms.clearAll()
    return
  }
  if (!(await chrome.alarms.get('videos'))) {
    chrome.alarms.create('videos', { delayInMinutes: 3 + Math.random() * 10, periodInMinutes: 60 })
  }
  if (!(await chrome.alarms.get('people'))) {
    const next = new Date()
    next.setHours(9, 6, 0, 0)
    if (next < new Date()) next.setDate(next.getDate() + 1)
    chrome.alarms.create('people', { when: next.getTime(), periodInMinutes: 1440 })
  }
}

chrome.runtime.onInstalled.addListener(schedule)
chrome.runtime.onStartup.addListener(schedule)

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const s = await getSettings()
  const hour = new Date().getHours()
  if (hour < s.startHour || hour >= s.endHour) return
  run(alarm.name === 'people' ? 'people' : 'videos', false, Math.random() * 150_000)
})

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'run') run(msg.task, true)
  if (msg.type === 'resume') getSettings().then((s) => store.set({ settings: { ...s, paused: false } })).then(() => patchStatus({ error: '' }))
  if (msg.type === 'reschedule') chrome.alarms.clearAll().then(schedule)
})
