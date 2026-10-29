import { PROVIDERS, check, providerOf } from './lib/ai.js'
import { getJson, RedditError } from './lib/reddit.js'
import { parseSubs } from './lib/rules.js'
import { DEFAULTS, normalize } from './lib/settings.js'
import { checkSync, syncFromSettings, syncNow } from './lib/sync.js'

const $ = (id) => document.getElementById(id)
const FIELDS = ['subs', 'period', 'postsPerSub', 'minComments', 'minScore', 'suggesters', 'skip', 'provider', 'aiKey', 'model', 'name', 'offer', 'body', 'subject', 'syncRepo', 'syncToken']
const say = (id, text, bad = false) => {
  $(id).textContent = text
  $(id).className = bad ? 'bad' : ''
}

async function stored() {
  return normalize((await chrome.storage.local.get('settings')).settings)
}

async function load() {
  const s = await stored()
  for (const k of FIELDS) $(k).value = s[k]
  $('useAi').checked = s.useAi
  explainProvider()
}

function read(current) {
  const num = (id, fallback, min, max) => Math.min(max, Math.max(min, Number($(id).value) || fallback))
  return {
    ...current,
    subs: $('subs').value,
    period: $('period').value,
    postsPerSub: num('postsPerSub', DEFAULTS.postsPerSub, 1, 10),
    minComments: num('minComments', DEFAULTS.minComments, 0, 100000),
    minScore: num('minScore', DEFAULTS.minScore, 0, 100000),
    suggesters: Math.min(5, Math.max(0, Number($('suggesters').value) || 0)),
    skip: $('skip').value,
    provider: $('provider').value,
    aiKey: $('aiKey').value.trim(),
    model: $('model').value.trim(),
    useAi: $('useAi').checked,
    name: $('name').value,
    offer: $('offer').value,
    body: $('body').value,
    subject: $('subject').value,
    syncRepo: $('syncRepo').value.trim(),
    syncToken: $('syncToken').value.trim(),
  }
}

$('save').onclick = async () => {
  const next = { ...read(await stored()), settingsAt: Date.now() } // the newest saved settings win on every device
  await chrome.storage.local.set({ settings: next })
  const n = parseSubs(next.subs).length
  if (!n) return say('msg', 'Saved. Add at least one subreddit to start.', true)
  say('msg', `Saved. Looking in ${n} subreddit${n === 1 ? '' : 's'}.`)
  if (next.syncRepo && next.syncToken) {
    await syncFromSettings(chrome.storage.local, next) // share the new settings with the other devices
    const { syncStatus } = await chrome.storage.local.get('syncStatus')
    if (syncStatus?.error) say('msg', `Saved here, but sync failed: ${syncStatus.error}`, true)
  }
}

$('testSync').onclick = async () => {
  const s = read(await stored())
  if (!s.syncToken) return say('syncMsg', 'Paste your sync token first.', true)
  if (!s.syncRepo) return say('syncMsg', 'Fill in the repo.', true)
  if (!/^[\w.-]+\/[\w.-]+$/.test(s.syncRepo)) return say('syncMsg', 'The repo should look like owner/name.', true)
  say('syncMsg', 'Checking…')
  try {
    const cfg = { repo: s.syncRepo, token: s.syncToken, ...(s.syncApi ? { api: s.syncApi } : {}) }
    const name = await checkSync(cfg) // refuses a public repo
    const r = await syncNow(chrome.storage.local, cfg)
    await chrome.storage.local.set({ syncStatus: { at: Date.now(), error: '' } })
    say('syncMsg', `Sync works with ${name} (private). ${r.items} post${r.items === 1 ? '' : 's'} shared.`)
  } catch (e) {
    say('syncMsg', e.message, true)
  }
}

$('testReddit').onclick = async () => {
  const s = read(await stored())
  const sub = parseSubs(s.subs)[0] || 'nosurf'
  say('redditMsg', 'Checking…')
  try {
    const about = await getJson(s.redditBase, `/r/${encodeURIComponent(sub)}/about.json?raw_json=1`)
    const members = about?.data?.subscribers
    say('redditMsg', `Reddit works. r/${sub} has ${members ? members.toLocaleString() : 'some'} members.`)
  } catch (e) {
    say('redditMsg', e instanceof RedditError && e.kind === 'private' ? `r/${sub} is private or restricted.` : e.message, true)
  }
}

function explainProvider() {
  const p = PROVIDERS[$('provider').value] ?? PROVIDERS.groq
  $('model').placeholder = p.model
  $('aiHint').textContent =
    `Get a ${p.label} key at ${p.getKey} (it starts with ${p.keyStart}) and check there what the free quota covers. ` +
    'A key from one provider does not work with the other. Without a key, or if a request fails, you get a plain opening line and no reply draft. ' +
    `The key stays in this Chrome and is only sent to ${p.label}. Only the text of posts and comments is sent.`
}
$('provider').addEventListener('change', explainProvider)

$('testAi').onclick = async () => {
  const s = read(await stored())
  if (!s.aiKey) return say('aiMsg', 'Paste a key first.', true)
  say('aiMsg', 'Checking…')
  try {
    const model = await check({ provider: s.provider, key: s.aiKey, model: s.model, ...(s.aiApi ? { api: s.aiApi } : {}) })
    say('aiMsg', `${providerOf({ provider: s.provider }).label} (${model}) is working.`)
  } catch (e) {
    say('aiMsg', e.message, true)
  }
}

load()
