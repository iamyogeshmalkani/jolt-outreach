import { PROVIDERS, check } from './lib/llm.js'
import { checkAccess } from './lib/github.js'
import { DEFAULTS } from './lib/settings.js'
import { COMPETITOR_GROUPS, parseNames } from './lib/rules.js'

const $ = (id) => document.getElementById(id)
const say = (text, bad = false) => {
  $('msg').textContent = text
  $('msg').className = bad ? 'bad' : ''
}

async function load() {
  const { settings = {} } = await chrome.storage.local.get('settings')
  const s = { ...DEFAULTS, ...settings }
  for (const k of ['repo', 'token', 'startHour', 'endHour', 'skip', 'aiProvider', 'aiKey', 'aiModel']) $(k).value = s[k]
  if (!PROVIDERS[s.aiProvider]) $('aiProvider').value = DEFAULTS.aiProvider // a provider this version no longer offers
  $('useAi').checked = s.useAi
  $('keywords').value = (s.keywords ?? DEFAULTS.keywords).join('\n')
  for (const g of COMPETITOR_GROUPS) $(`comp-${g.key}`).value = (s.competitors?.[g.key] ?? DEFAULTS.competitors[g.key]).join('\n')
  explainProvider()
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
    aiProvider: $('aiProvider').value,
    aiKey: $('aiKey').value.trim(),
    aiModel: $('aiModel').value.trim(),
    useAi: $('useAi').checked,
    keywords: parseNames($('keywords').value),
    competitors: Object.fromEntries(COMPETITOR_GROUPS.map((g) => [g.key, parseNames($(`comp-${g.key}`).value)])),
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(next.repo)) return say('The repo should look like owner/name.', true)
  if (!next.token) return say('Paste your GitHub token.', true)
  if (!next.aiKey) return say('Paste an AI key. It picks which comments are really about a habit.', true)
  await chrome.storage.local.set({ settings: next })
  chrome.runtime.sendMessage({ type: 'reschedule' })
  say('Checking with GitHub…')
  try {
    const name = await checkAccess({ repo: next.repo, token: next.token })
    let ai = ''
    if (next.aiKey) {
      try {
        const model = await check({ provider: next.aiProvider, key: next.aiKey, model: next.aiModel })
        ai = ` ${PROVIDERS[next.aiProvider].label} (${model}) is working.`
      } catch (e) {
        return say(`Saved. Connected to ${name}, but: ${e.message}`, true)
      }
    }
    say(`Saved. Connected to ${name}.${ai}`)
  } catch (e) {
    say(`Saved, but: ${e.message}`, true)
  }
}

const HINTS = {
  groq: 'Get a key at console.groq.com/keys. Check your account\'s limits page for what the free plan allows. It reads each comment and keeps only people talking about their own habit. When the daily limit runs out or a request fails, the run stops and nothing is saved from the comments it could not check.',
  anthropic: 'Get a key at platform.claude.com, in a workspace with a low monthly spend limit. It is billed to your Anthropic account, separately from any Claude.ai plan.',
}
function explainProvider() {
  const p = $('aiProvider').value
  $('aiModel').placeholder = PROVIDERS[p].model
  $('aiHint').textContent = `${HINTS[p]} The key stays in this Chrome and is only sent to ${PROVIDERS[p].label}'s API. Only the public text of each comment is sent.`
}
$('aiProvider').addEventListener('change', explainProvider)

load()
