// Finds the top posts in your subreddits and their top commenter, then drafts a message and a reply with an AI model (Groq or Grok).
// It only reads Reddit, in your own Chrome. You send every message and post every reply yourself.
import { find } from './lib/finder.js'
import { draft, judge } from './lib/ai.js'
import { reddit } from './lib/reddit.js'
import { parseSubs, settle, upgradeItem } from './lib/rules.js'
import { buildKnown, remember } from './lib/memory.js'
import { MAX_ITEMS, syncFromSettings } from './lib/sync.js'
import { normalize } from './lib/settings.js'

const store = chrome.storage.local
const getSettings = async () => normalize((await store.get('settings')).settings)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pause = () => sleep(1500 + Math.random() * 1500) // be gentle with Reddit

async function patchStatus(patch) {
  const { status = {} } = await store.get('status')
  await store.set({ status: { ...status, ...patch } })
}
async function log(text) {
  const { log: lines = [] } = await store.get('log')
  lines.push(`${new Date().toLocaleTimeString()}  ${text}`)
  await store.set({ log: lines.slice(-60) })
}

let busy = false

async function run() {
  if (busy) return
  busy = true
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20_000) // keeps Chrome from stopping this worker mid-run
  try {
    const s = await getSettings()
    if (!parseSubs(s.subs).length) {
      await patchStatus({ error: 'Add the subreddits to look in, in Settings.', running: false })
      return
    }
    await patchStatus({ running: true, error: '', message: '' })
    await log(`Started: ${parseSubs(s.subs).map((x) => 'r/' + x).join(', ')}`)
    // Pull first, so posts and people another device already found are not found again.
    if (await syncFromSettings(store, s)) await log('Synced with your other devices.')

    const { items: existing = [], seen = {} } = await store.get(['items', 'seen'])
    const known = buildKnown(existing, seen)
    const { items, stopped, stats } = await find(reddit(s.redditBase), s, known, log, pause) // `redditBase` is only set by tests
    const ai = s.aiKey && s.useAi ? { provider: s.provider, key: s.aiKey.trim(), model: s.model, ...(s.aiApi ? { api: s.aiApi } : {}) } : null // `aiApi` is only set by tests
    if (ai && items.length) await judge(ai, items, log) // keep only the suggesters the AI agrees give a suggestion or review
    settle(items, s.suggesters, known.authors) // best few per post, nobody twice
    if (ai && items.length) await draft(ai, items, log)

    // Merge with what is stored now, because the dashboard may have changed statuses while this ran.
    const { items: current = [] } = await store.get('items')
    const ids = new Set(items.map((i) => i.id))
    await store.set({
      items: [...items, ...current.map(upgradeItem).filter((i) => !ids.has(i.id))].slice(0, MAX_ITEMS),
      seen: remember(known, items),
    })

    if (await syncFromSettings(store, s)) await log('Shared the new posts with your other devices.')
    const syncFailed = (await store.get('syncStatus')).syncStatus?.error
    if (syncFailed) await log(`Sync failed: ${syncFailed}`)

    const found = items.length
    if (stopped) await patchStatus({ error: stopped, message: found ? `Saved ${found} posts before stopping.` : '' })
    else {
      const old = stats.alreadySeen ? ` ${stats.alreadySeen} posts you have already seen were skipped.` : ''
      await patchStatus({
        message: found
          ? `Found ${found} new posts.${old}`
          : stats.alreadySeen
            ? `Nothing new: the top posts there are ones you have already seen (${stats.alreadySeen}). Try a longer period, or more subreddits.`
            : 'Nothing new found this time.',
      })
    }
    await patchStatus({ lastRun: { at: Date.now(), found } })
    chrome.action.setBadgeBackgroundColor({ color: '#b5fc4f' })
    chrome.action.setBadgeText({ text: found ? String(found) : '' })
    await log(stopped ? `Stopped: ${stopped}` : `Done: ${found} posts`)
  } catch (e) {
    await patchStatus({ error: e.message || String(e) })
    await log(`Failed: ${e.message || e}`)
  } finally {
    clearInterval(keepAlive)
    await patchStatus({ running: false })
    busy = false
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'run') run()
})
