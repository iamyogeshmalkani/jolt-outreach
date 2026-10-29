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
  else if (status.running) state = status.task === 'people' ? 'Finding people. A small Chrome window is open, so leave it alone.' : 'Finding videos. A small Chrome window is open, so leave it alone.'
  else if (status.message) state = status.message
  else if (status.lastRun) state = `Last run ${new Date(status.lastRun.at).toLocaleTimeString()}.`
  $('state').textContent = state

  $('error').hidden = !status.error
  $('error').textContent = status.error || ''
  $('resume').hidden = !s.paused
  $('enabled').checked = s.enabled
  $('claude').textContent = s.anthropicKey && s.useClaude ? `Drafts are written by Claude (${s.claudeModel}).` : 'Drafts use the built-in templates.'
  $('hours').textContent = `Runs between ${s.startHour}:00 and ${s.endHour}:00 while Chrome is open.`
  $('videos').disabled = $('people').disabled = Boolean(status.running)
  $('log').textContent = log.join('\n') || 'Nothing yet.'
}

$('videos').onclick = () => send({ type: 'run', task: 'videos' })
$('people').onclick = () => send({ type: 'run', task: 'people' })
$('resume').onclick = () => send({ type: 'resume' })
$('enabled').onchange = async (e) => {
  const { settings = {} } = await chrome.storage.local.get('settings')
  await chrome.storage.local.set({ settings: { ...DEFAULTS, ...settings, enabled: e.target.checked } })
  send({ type: 'reschedule' })
}
$('settings').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage() }

chrome.storage.onChanged.addListener(render)
render()
