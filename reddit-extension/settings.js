import { check, DEFAULT_MODEL } from './lib/grok.js'
import { getJson, RedditError } from './lib/reddit.js'
import { parseSubs } from './lib/rules.js'
import { DEFAULTS } from './lib/settings.js'

const $ = (id) => document.getElementById(id)
const FIELDS = ['subs', 'period', 'postsPerSub', 'minComments', 'minScore', 'skip', 'xaiKey', 'model', 'name', 'offer', 'body', 'subject']
const say = (id, text, bad = false) => {
  $(id).textContent = text
  $(id).className = bad ? 'bad' : ''
}

async function stored() {
  return { ...DEFAULTS, ...((await chrome.storage.local.get('settings')).settings || {}) }
}

async function load() {
  const s = await stored()
  for (const k of FIELDS) $(k).value = s[k]
  $('useAi').checked = s.useAi
  $('model').placeholder = DEFAULT_MODEL
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
    skip: $('skip').value,
    xaiKey: $('xaiKey').value.trim(),
    model: $('model').value.trim(),
    useAi: $('useAi').checked,
    name: $('name').value,
    offer: $('offer').value,
    body: $('body').value,
    subject: $('subject').value,
  }
}

$('save').onclick = async () => {
  const next = read(await stored())
  await chrome.storage.local.set({ settings: next })
  const n = parseSubs(next.subs).length
  if (!n) return say('msg', 'Saved. Add at least one subreddit to start.', true)
  say('msg', `Saved. Looking in ${n} subreddit${n === 1 ? '' : 's'}.`)
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

$('testGrok').onclick = async () => {
  const s = read(await stored())
  if (!s.xaiKey) return say('grokMsg', 'Paste a key first.', true)
  say('grokMsg', 'Checking…')
  try {
    say('grokMsg', `Grok (${await check({ key: s.xaiKey, model: s.model, ...(s.aiApi ? { api: s.aiApi } : {}) })}) is working.`)
  } catch (e) {
    say('grokMsg', e.message, true)
  }
}

load()
