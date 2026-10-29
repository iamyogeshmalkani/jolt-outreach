import { check } from './lib/claude.js'
import { checkAccess } from './lib/github.js'
import { DEFAULTS } from './lib/settings.js'

const $ = (id) => document.getElementById(id)
const say = (text, bad = false) => {
  $('msg').textContent = text
  $('msg').className = bad ? 'bad' : ''
}

async function load() {
  const { settings = {} } = await chrome.storage.local.get('settings')
  const s = { ...DEFAULTS, ...settings }
  for (const k of ['repo', 'token', 'startHour', 'endHour', 'skip', 'anthropicKey', 'claudeModel']) $(k).value = s[k]
  $('useClaude').checked = s.useClaude
}

$('save').onclick = async () => {
  const { settings = {} } = await chrome.storage.local.get('settings')
  const next = {
    ...DEFAULTS, ...settings,
    repo: $('repo').value.trim(),
    token: $('token').value.trim(),
    startHour: Math.min(23, Math.max(0, Number($('startHour').value) || DEFAULTS.startHour)),
    endHour: Math.min(24, Math.max(1, Number($('endHour').value) || DEFAULTS.endHour)),
    skip: $('skip').value,
    anthropicKey: $('anthropicKey').value.trim(),
    claudeModel: $('claudeModel').value.trim() || DEFAULTS.claudeModel,
    useClaude: $('useClaude').checked,
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(next.repo)) return say('The repo should look like owner/name.', true)
  if (!next.token) return say('Paste your GitHub token.', true)
  await chrome.storage.local.set({ settings: next })
  chrome.runtime.sendMessage({ type: 'reschedule' })
  say('Checking with GitHub…')
  try {
    const name = await checkAccess({ repo: next.repo, token: next.token })
    let claude = ''
    if (next.anthropicKey) {
      try {
        claude = ` Claude (${await check({ key: next.anthropicKey, model: next.claudeModel })}) is working.`
      } catch (e) {
        return say(`Saved. Connected to ${name}, but Claude: ${e.message}`, true)
      }
    }
    say(`Saved. Connected to ${name}.${claude}`)
  } catch (e) {
    say(`Saved, but: ${e.message}`, true)
  }
}

load()
