import { parseSubs } from './lib/rules.js'
import { normalize } from './lib/settings.js'

const $ = (id) => document.getElementById(id)

async function render() {
  const { settings = {}, status = {}, log = [], items = [] } = await chrome.storage.local.get(['settings', 'status', 'log', 'items'])
  const s = normalize(settings)
  const todo = items.filter((i) => i.dmStatus === 'To send' || i.commentStatus === 'To post').length
  let state = 'Idle.'
  if (!parseSubs(s.subs).length) state = 'Add the subreddits to look in, in Settings.'
  else if (status.running) state = 'Looking through your subreddits. This takes a minute or two.'
  else if (status.message) state = status.message
  else if (items.length) state = `${items.length} posts saved.`
  $('state').textContent = state + (todo && !status.running ? ` ${todo} still to do.` : '')
  $('error').hidden = !status.error
  $('error').textContent = status.error || ''
  $('run').disabled = Boolean(status.running)
  $('log').textContent = log.join('\n') || 'Nothing yet.'
}

$('run').onclick = () => chrome.runtime.sendMessage({ type: 'run' })
$('open').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') })
$('settings').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage() }
chrome.storage.onChanged.addListener(render)
render()
