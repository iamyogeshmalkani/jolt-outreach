import { PROVIDERS, modelOf } from './lib/llm.js'
import { DEFAULTS } from './lib/settings.js'

const $ = (id) => document.getElementById(id)
const send = (msg) => chrome.runtime.sendMessage(msg)

async function render() {
  const { settings = {}, status = {}, log = [] } = await chrome.storage.local.get(['settings', 'status', 'log'])
  const s = { ...DEFAULTS, ...settings }
  const [owner, name] = s.repo.split('/')
  $('page').href = `https://${owner}.github.io/${name}/`

  let state = 'Idle.'
  if (!s.token) state = 'Add your GitHub token in Settings to start.'
  else if (status.running) state = 'Finding people. A small Chrome window is open, so leave it alone.'
  else if (status.message) state = status.message
  else if (status.lastRun) state = `Last run ${new Date(status.lastRun.at).toLocaleTimeString()}.`
  $('state').textContent = state

  $('error').hidden = !status.error
  $('error').textContent = status.error || ''
  $('resume').hidden = !s.paused
  $('auto').checked = s.auto
  const who = `${PROVIDERS[s.aiProvider]?.label ?? 'AI'} (${modelOf({ provider: s.aiProvider, model: s.aiModel })})`
  $('claude').textContent = !s.aiKey
    ? 'Add an AI key in Settings. It picks which comments are really about a habit.'
    : s.useAi
      ? `${who} picks the comments and writes the opening lines.`
      : `${who} picks the comments. Opening lines use the built-in templates.`
  $('hours').textContent = s.auto
    ? `Also runs by itself between ${s.startHour}:00 and ${s.endHour}:00 while Chrome is open.`
    : `Each run reads up to ${s.videosPerRun} videos. Start one by hand 2 or 3 times a day.`
  $('people').disabled = Boolean(status.running)
  $('log').textContent = log.join('\n') || 'Nothing yet.'
}

$('people').onclick = () => send({ type: 'run' })
$('resume').onclick = () => send({ type: 'resume' })
$('auto').onchange = async (e) => {
  const { settings = {} } = await chrome.storage.local.get('settings')
  await chrome.storage.local.set({ settings: { ...DEFAULTS, ...settings, auto: e.target.checked } })
  send({ type: 'reschedule' })
}
$('settings').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage() }

chrome.storage.onChanged.addListener(render)
render()
