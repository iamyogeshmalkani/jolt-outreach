import { checkAccess } from './lib/github.js'
import { check } from './lib/llm.js'
import { DEFAULTS, withDefaults } from './lib/settings.js'
import { LIMITS, parseNames } from './lib/rules.js'

const $ = (id) => document.getElementById(id)
const say = (text, bad = false) => {
  $('msg').textContent = text
  $('msg').className = bad ? 'bad' : ''
}

async function load() {
  const { settings = {} } = await chrome.storage.local.get('settings')
  const s = withDefaults(settings)
  for (const k of ['repo', 'token', 'aiKey', 'aiModel', 'commentsPerVideo', 'videosPerRun', 'minComments', 'minViews', 'maxAgeDays', 'startHour', 'endHour']) $(k).value = s[k]
  $('keywords').value = (s.keywords ?? DEFAULTS.keywords).join('\n')
  $('commentTopics').value = (s.commentTopics ?? DEFAULTS.commentTopics).join('\n')
}

$('save').onclick = async () => {
  const { settings = {} } = await chrome.storage.local.get('settings')
  const next = {
    ...withDefaults(settings),
    repo: $('repo').value.trim(),
    token: $('token').value.trim(),
    aiKey: $('aiKey').value.trim(),
    commentsPerVideo: Math.min(LIMITS.maxCommentsRead, Math.max(10, Math.round(Number($('commentsPerVideo').value)) || DEFAULTS.commentsPerVideo)),
    aiModel: $('aiModel').value.trim(),
    minComments: Math.max(0, Math.round(Number($('minComments').value))),
    minViews: Math.max(0, Math.round(Number($('minViews').value))),
    maxAgeDays: Math.min(365, Math.max(1, Math.round(Number($('maxAgeDays').value)) || DEFAULTS.maxAgeDays)),
    videosPerRun: Math.min(LIMITS.maxVideos, Math.max(1, Math.round(Number($('videosPerRun').value)) || DEFAULTS.videosPerRun)),
    startHour: Math.min(23, Math.max(0, Number($('startHour').value) || DEFAULTS.startHour)),
    endHour: Math.min(24, Math.max(1, Number($('endHour').value) || DEFAULTS.endHour)),
    keywords: parseNames($('keywords').value),
    commentTopics: parseNames($('commentTopics').value, 100),
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(next.repo)) return say('The repo should look like owner/name.', true)
  if (!next.token) return say('Paste your GitHub token.', true)
  await chrome.storage.local.set({ settings: next })
  chrome.runtime.sendMessage({ type: 'reschedule' })
  say('Checking with GitHub…')
  try {
    const name = await checkAccess({ repo: next.repo, token: next.token })
    say(`Saved. Connected to ${name}.`)
  } catch (e) {
    say(`Saved, but: ${e.message}`, true)
  }
}

$('testAi').onclick = async () => {
  const key = $('aiKey').value.trim()
  const say2 = (text, bad = false) => { $('aiMsg').textContent = text; $('aiMsg').className = bad ? 'bad' : '' }
  if (!key) return say2('Paste a Claude API key first.', true)
  say2('Asking Claude…')
  try {
    say2(`Works. Using ${await check({ key, model: $('aiModel').value.trim() })}.`)
  } catch (e) {
    say2(e.message, true)
  }
}

load()
