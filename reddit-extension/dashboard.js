import { DEFAULTS, fill, normalize } from './lib/settings.js'

const STATUSES = ['To send', 'Sent', 'Replied', 'Booked', 'Skip']
// A post stays in "To do" until both the message and the reply have been dealt with. A post with no suitable commenter only needs the reply.
const pending = (it) => (it.top && it.dmStatus === 'To send') || it.commentStatus === 'To post'
const VIEWS = [
  { label: 'To do', has: pending },
  { label: 'Sent', has: (it) => !pending(it) && it.dmStatus === 'Sent' },
  { label: 'Replied', has: (it) => !pending(it) && (it.dmStatus === 'Replied' || it.dmStatus === 'Booked') },
  { label: 'Done', has: (it) => !pending(it) && !['Sent', 'Replied', 'Booked'].includes(it.dmStatus) },
]
const NEXT = ['Mark as sent', 'They replied', 'Interview booked']
const PREV = ['Unmark as sent', 'Unmark replied', 'Unmark booked']

const state = { items: [], settings: { ...DEFAULTS }, status: {}, view: 0, sub: '', selected: null }
let mute = 0 // ignore the storage change caused by our own save, so typing is not interrupted

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

const dmText = (it) => it.dmEdit ?? `${it.opener} ${fill(state.settings.body, state.settings)}`
const commentText = (it) => it.commentEdit ?? it.comment
const subject = (it) => fill(state.settings.subject, state.settings, { sub: it.sub })
function dmUrl(it) {
  const base = `https://www.reddit.com/message/compose/?to=${encodeURIComponent(it.top.author)}&subject=${encodeURIComponent(subject(it))}`
  const withText = `${base}&message=${encodeURIComponent(dmText(it))}`
  return withText.length < 1900 ? withText : base // a very long link may not open, so fall back to copying the text
}

async function load() {
  const r = await chrome.storage.local.get(['items', 'settings', 'status'])
  state.items = r.items || []
  state.settings = normalize(r.settings)
  state.status = r.status || {}
  render()
}

async function patch(id, fields) {
  const { items = [] } = await chrome.storage.local.get('items')
  const at = items.findIndex((x) => x.id === id)
  if (at < 0) return
  items[at] = { ...items[at], ...fields }
  mute = Date.now() + 500
  await chrome.storage.local.set({ items })
  state.items = items
}

const viewOf = (it) => VIEWS.findIndex((v) => v.has(it))
const visible = () => state.items.filter((i) => viewOf(i) === state.view && (!state.sub || i.sub === state.sub))

function render() {
  const subs = [...new Set(state.items.map((i) => i.sub))]
  $('subfilter').innerHTML = `<option value="">All subreddits</option>` + subs.map((s) => `<option${s === state.sub ? ' selected' : ''}>${esc(s)}</option>`).join('')
  $('chips').innerHTML = VIEWS.map((v, n) => {
    const count = state.items.filter((i) => viewOf(i) === n).length
    return `<button data-view="${n}" aria-pressed="${n === state.view}">${v.label} <b>${count}</b></button>`
  }).join('')

  const list = visible()
  if (!list.some((i) => i.id === state.selected)) state.selected = list[0]?.id ?? null
  $('rows').innerHTML = list.length
    ? list.map((i) => `<li><button class="row" data-id="${esc(i.id)}"${i.id === state.selected ? ' aria-current="true"' : ''}>
        <span class="row-head"><span class="handle">r/${esc(i.sub)}</span><span class="state">${i.top ? 'u/' + esc(i.top.author) : 'no commenter'}</span></span>
        <span class="row-text">${esc(i.title)}</span></button></li>`).join('')
    : `<li class="rows-empty">${state.items.length ? 'No one here.' : 'Nothing yet.'}</li>`

  const s = state.status
  $('runstate').textContent = s.running ? 'Looking through your subreddits…' : s.error ? '' : s.message || ''
  $('find').disabled = Boolean(s.running)
  renderDetail(state.items.find((i) => i.id === state.selected))
}

function renderDetail(it) {
  const el = $('detail')
  if (!it) {
    el.innerHTML = state.items.length
      ? '<h2>All clear here</h2><p class="hint">Pick another view.</p>'
      : `<h2>No posts yet</h2><p class="hint">Add your subreddits in Settings, then choose <b>Find top posts</b>.</p>${state.status.error ? `<p class="error">${esc(state.status.error)}</p>` : ''}`
    return
  }
  const idx = STATUSES.indexOf(it.dmStatus)
  const next = idx <= 2 ? { label: NEXT[idx], to: STATUSES[idx + 1] } : null
  const prev = idx >= 1 && idx <= 3 ? { label: PREV[idx - 1], to: STATUSES[idx - 1] } : null
  const flags = it.flags?.length
    ? `<p class="warn">r/${esc(it.sub)}'s rules mention: ${it.flags.map(esc).join(', ')}. Read them, and ask the moderators, before you message or reply.</p>`
    : ''
  const dm = it.top
    ? `<section>
        <h3>Message the top commenter <span class="pill">${esc(it.dmStatus)}</span></h3>
        <p class="meta"><a href="https://www.reddit.com/user/${encodeURIComponent(it.top.author)}/" target="_blank" rel="noopener">u/${esc(it.top.author)}</a>, ${it.top.score} upvotes${it.top.url ? `, <a href="${esc(it.top.url)}" target="_blank" rel="noopener">their comment</a>` : ''}</p>
        <blockquote>${esc(it.top.body)}</blockquote>
        <textarea data-edit="dm" rows="6" aria-label="Your message">${esc(dmText(it))}</textarea>
        <div class="actions">
          ${idx === 4 ? '<button class="primary" data-set="To send">Put back in the queue</button>' : `
            <a class="button ${idx === 0 ? 'primary' : 'secondary'}" href="${esc(dmUrl(it))}" target="_blank" rel="noopener">Open message on Reddit</a>
            <button class="secondary" data-copy="dm">Copy message</button>
            ${next ? `<button class="${idx === 0 ? 'secondary' : 'primary'}" data-set="${next.to}">${next.label}</button>` : '<span class="done">Interview booked.</span>'}
            ${prev ? `<button class="quiet" data-set="${prev.to}">${prev.label}</button>` : ''}
            ${idx === 0 ? '<button class="quiet" data-set="Skip">Skip</button>' : ''}`}
          ${it.dmEdit !== undefined ? '<button class="quiet" data-restore="dm">Restore original</button>' : ''}
        </div>
      </section>`
    : `<section><h3>Message the top commenter</h3><p class="hint">No suitable commenter on this post. You can still reply to it below.</p></section>`
  const text = commentText(it)
  const reply = `<section>
      <h3>Reply to the post <span class="pill">${esc(it.commentStatus)}</span></h3>
      ${text
        ? `<textarea data-edit="comment" rows="6" aria-label="Your reply">${esc(text)}</textarea>`
        : `<p class="hint">No reply drafted. Add an AI key in Settings to get one.</p>`}
      <div class="actions">
        <a class="button secondary" href="${esc(it.url)}" target="_blank" rel="noopener">Open the post</a>
        ${text ? '<button class="secondary" data-copy="comment">Copy reply</button>' : ''}
        ${it.commentStatus === 'To post'
          ? `<button class="${text ? 'primary' : 'secondary'}" data-comment="Posted">Mark as posted</button><button class="quiet" data-comment="Skip">Skip</button>`
          : `<button class="quiet" data-comment="To post">${it.commentStatus === 'Skip' ? 'Put back' : 'Unmark as posted'}</button>`}
        ${it.commentEdit !== undefined ? '<button class="quiet" data-restore="comment">Restore original</button>' : ''}
      </div>
    </section>`
  el.innerHTML = `
    <header class="post">
      <p class="meta">r/${esc(it.sub)}, ${it.score} upvotes, ${it.comments} comments</p>
      <h2><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></h2>
      ${it.body ? `<p class="body">${esc(it.body)}</p>` : ''}
    </header>
    ${flags}${dm}${reply}`
}

// Change an item. If that moves it out of the current view, move on to its neighbour so you keep your place.
async function act(it, fields) {
  const list = visible()
  const at = list.findIndex((i) => i.id === it.id)
  await patch(it.id, fields)
  if (viewOf(state.items.find((i) => i.id === it.id)) !== state.view) state.selected = (list[at + 1] ?? list[at - 1])?.id ?? null
  render()
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button')
  if (!t) return
  const it = state.items.find((i) => i.id === state.selected)
  if (t.dataset.view) { state.view = Number(t.dataset.view); render() }
  else if (t.dataset.id) { state.selected = t.dataset.id; render() }
  else if (t === $('find')) chrome.runtime.sendMessage({ type: 'run' })
  else if (it && t.dataset.set) await act(it, { dmStatus: t.dataset.set })
  else if (it && t.dataset.comment) await act(it, { commentStatus: t.dataset.comment })
  else if (it && t.dataset.copy) {
    const text = t.dataset.copy === 'dm' ? dmText(it) : commentText(it)
    try { await navigator.clipboard.writeText(text) } catch { document.querySelector(`[data-edit="${t.dataset.copy}"]`)?.select(); document.execCommand('copy') }
    const label = t.textContent
    t.textContent = 'Copied'
    setTimeout(() => (t.textContent = label), 1500)
  } else if (it && t.dataset.restore) {
    await patch(it.id, t.dataset.restore === 'dm' ? { dmEdit: undefined } : { commentEdit: undefined })
    render()
  }
})

document.addEventListener('input', (e) => {
  const kind = e.target.dataset?.edit
  const it = state.items.find((i) => i.id === state.selected)
  if (kind && it) patch(it.id, kind === 'dm' ? { dmEdit: e.target.value } : { commentEdit: e.target.value })
})
$('subfilter').addEventListener('change', (e) => { state.sub = e.target.value; render() })
$('settings').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage() }
chrome.storage.onChanged.addListener(() => { if (Date.now() > mute) load() })
load()
