// Finds the top posts in your subreddits and their top commenter, then drafts a message and a reply with an AI model (Groq or Grok).
// It only reads Reddit, in your own Chrome. You send every message and post every reply yourself.
import { find } from './lib/finder.js'
import { draft } from './lib/ai.js'
import { reddit } from './lib/reddit.js'
import { parseSubs } from './lib/rules.js'
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

    const { items: existing = [], seen = {} } = await store.get(['items', 'seen'])
    const known = {
      posts: new Set([...(seen.posts || []), ...existing.map((i) => i.id)]),
      authors: new Set([...(seen.authors || []), ...existing.filter((i) => i.top).map((i) => i.top.author.toLowerCase())]),
    }
    const { items, stopped } = await find(reddit(s.redditBase), s, known, log, pause) // `redditBase` is only set by tests
    if (items.length && s.aiKey && s.useAi) {
      await draft({ provider: s.provider, key: s.aiKey.trim(), model: s.model, ...(s.aiApi ? { api: s.aiApi } : {}) }, items, log) // `aiApi` is only set by tests
    }

    // Merge with what is stored now, because the dashboard may have changed statuses while this ran.
    const { items: current = [] } = await store.get('items')
    const ids = new Set(items.map((i) => i.id))
    await store.set({
      items: [...items, ...current.filter((i) => !ids.has(i.id))].slice(0, 500),
      seen: {
        posts: [...known.posts, ...ids].slice(-3000),
        authors: [...known.authors, ...items.filter((i) => i.top).map((i) => i.top.author.toLowerCase())].slice(-3000),
      },
    })

    const found = items.length
    if (stopped) await patchStatus({ error: stopped, message: found ? `Saved ${found} posts before stopping.` : '' })
    else await patchStatus({ message: found ? `Found ${found} posts.` : 'Nothing new found this time.' })
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
