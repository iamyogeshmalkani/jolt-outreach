import { checkAccess } from './lib/github.js'
import { DEFAULTS } from './lib/settings.js'
import { COMPETITOR_GROUPS, LIMITS, parseNames } from './lib/rules.js'

const $ = (id) => document.getElementById(id)
const say = (text, bad = false) => {
  $('msg').textContent = text
  $('msg').className = bad ? 'bad' : ''
}

async function load() {
  const { settings = {} } = await chrome.storage.local.get('settings')
  const s = { ...DEFAULTS, ...settings }
  for (const k of ['repo', 'token', 'videosPerRun', 'minComments', 'minViews', 'maxAgeDays', 'startHour', 'endHour']) $(k).value = s[k]
  $('keywords').value = (s.keywords ?? DEFAULTS.keywords).join('\n')
  for (const g of COMPETITOR_GROUPS) $(`comp-${g.key}`).value = (s.competitors?.[g.key] ?? DEFAULTS.competitors[g.key]).join('\n')
}

$('save').onclick = async () => {
  const { settings = {} } = await chrome.storage.local.get('settings')
  const next = {
    ...DEFAULTS, ...settings,
    repo: $('repo').value.trim(),
    token: $('token').value.trim(),
    minComments: Math.max(0, Math.round(Number($('minComments').value))),
    minViews: Math.max(0, Math.round(Number($('minViews').value))),
    maxAgeDays: Math.min(365, Math.max(1, Math.round(Number($('maxAgeDays').value)) || DEFAULTS.maxAgeDays)),
    videosPerRun: Math.min(LIMITS.maxVideos, Math.max(1, Math.round(Number($('videosPerRun').value)) || DEFAULTS.videosPerRun)),
    startHour: Math.min(23, Math.max(0, Number($('startHour').value) || DEFAULTS.startHour)),
    endHour: Math.min(24, Math.max(1, Number($('endHour').value) || DEFAULTS.endHour)),
    keywords: parseNames($('keywords').value),
    competitors: Object.fromEntries(COMPETITOR_GROUPS.map((g) => [g.key, parseNames($(`comp-${g.key}`).value)])),
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

load()
