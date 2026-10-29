import { pending, upgradeItem } from './lib/rules.js'
import { DEFAULTS, fill, normalize } from './lib/settings.js'
import { syncFromSettings } from './lib/sync.js'

const STATUSES = ['To send', 'Sent', 'Replied', 'Booked', 'Skip']
// A post stays in "To do" until every message and the reply have been dealt with. After that it sits under the furthest any person got.
const anyone = (it, ...statuses) => it.people.some((p) => statuses.includes(p.dmStatus))
const VIEWS = [
  { label: 'To do', has: pending },
  { label: 'Sent', has: (it) => !pending(it) && anyone(it, 'Sent') },
  { label: 'Replied', has: (it) => !pending(it) && !anyone(it, 'Sent') && anyone(it, 'Replied', 'Booked') },
  { label: 'Done', has: (it) => !pending(it) && !anyone(it, 'Sent', 'Replied', 'Booked') },
]
const NEXT = ['Mark as sent', 'They replied', 'Interview booked']
const PREV = ['Unmark as sent', 'Unmark replied', 'Unmark booked']

const state = { items: [], settings: { ...DEFAULTS }, status: {}, view: 0, sub: '', selected: null }
let mute = 0 // ignore the storage change caused by our own save, so typing is not interrupted

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

const key = (p) => p.author.toLowerCase()
const dmText = (p) => p.dmEdit ?? `${p.opener} ${fill(state.settings.body, state.settings)}`
const commentText = (it) => it.commentEdit ?? it.comment
const subject = (it) => fill(state.settings.subject, state.settings, { sub: it.sub })
function dmUrl(it, p) {
  const base = `https://www.reddit.com/message/compose/?to=${encodeURIComponent(p.author)}&subject=${encodeURIComponent(subject(it))}`
  const withText = `${base}&message=${encodeURIComponent(dmText(p))}`
  return withText.length < 1900 ? withText : base // a very long link may not open, so fall back to copying the text
}

async function load() {
  const r = await chrome.storage.local.get(['items', 'settings', 'status'])
  state.items = (r.items || []).map(upgradeItem)
  state.settings = normalize(r.settings)
  state.status = r.status || {}
  render()
}

// The reply to a post, and the message to each person, are stamped separately, so two devices changing different ones both keep their change.
const COMMENT_FIELDS = ['commentStatus', 'commentEdit']

async function save(id, change) {
  const { items = [] } = await chrome.storage.local.get('items')
  const at = items.findIndex((x) => x.id === id)
  if (at < 0) return
  items[at] = change(upgradeItem(items[at]))
  mute = Date.now() + 500
  await chrome.storage.local.set({ items })
  state.items = items.map(upgradeItem)
  scheduleSync()
}

const patch = (id, fields) =>
  save(id, (it) => ({ ...it, ...fields, ...(COMMENT_FIELDS.some((k) => k in fields) ? { commentAt: Date.now() } : {}) }))

const patchPerson = (id, who, fields) =>
  save(id, (it) => ({ ...it, people: it.people.map((p) => (key(p) === who ? { ...p, ...fields, dmAt: Date.now() } : p)) }))

// ---- keeping other devices in step ----
let syncTimer = 0
let syncing = false
let lastSync = 0
const syncConfigured = () => Boolean(state.settings.syncRepo && state.settings.syncToken)
const scheduleSync = () => {
  clearTimeout(syncTimer)
  syncTimer = setTimeout(doSync, 2500) // a moment after the last change, not on every keystroke
}

async function showSyncState() {
  const el = $('syncstate')
  $('sync').hidden = !syncConfigured()
  if (!syncConfigured()) { el.textContent = ''; return }
  const { syncStatus } = await chrome.storage.local.get('syncStatus')
  el.className = syncStatus?.error ? 'bad' : 'hint'
  el.textContent = syncing ? 'Syncing…' : syncStatus?.error ? `Sync failed: ${syncStatus.error}` : syncStatus ? 'Synced.' : ''
}

async function doSync() {
  if (syncing || !syncConfigured()) return
  syncing = true
  showSyncState()
  try { await syncFromSettings(chrome.storage.local, state.settings) } finally { syncing = false; lastSync = Date.now() }
  showSyncState()
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
        <span class="row-head"><span class="handle">r/${esc(i.sub)}</span><span class="state">${i.people.length ? 'u/' + esc(i.people[0].author) + (i.people.length > 1 ? ` +${i.people.length - 1}` : '') : 'no commenter'}</span></span>
        <span class="row-text">${esc(i.title)}</span></button></li>`).join('')
    : `<li class="rows-empty">${state.items.length ? 'No one here.' : 'Nothing yet.'}</li>`

  const s = state.status
  $('runstate').textContent = s.running ? 'Looking through your subreddits…' : s.error ? '' : s.message || ''
  $('find').disabled = Boolean(s.running)
  showSyncState()
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
  const flags = it.flags?.length
    ? `<p class="warn">r/${esc(it.sub)}'s rules mention: ${it.flags.map(esc).join(', ')}. Read them, and ask the moderators, before you message or reply.</p>`
    : ''
  const personSection = (p) => {
    const idx = STATUSES.indexOf(p.dmStatus)
    const next = idx <= 2 ? { label: NEXT[idx], to: STATUSES[idx + 1] } : null
    const prev = idx >= 1 && idx <= 3 ? { label: PREV[idx - 1], to: STATUSES[idx - 1] } : null
    const who = esc(key(p))
    return `<section>
        <h3>${esc({ suggestion: 'Message someone who gave a suggestion', opinion: 'Message someone who shared an opinion' }[p.why] ?? 'Message the top commenter')} <span class="pill">${esc(p.dmStatus)}</span></h3>
        <p class="meta"><a href="https://www.reddit.com/user/${encodeURIComponent(p.author)}/" target="_blank" rel="noopener">u/${esc(p.author)}</a>, ${p.score} upvotes${p.url ? `, <a href="${esc(p.url)}" target="_blank" rel="noopener">their comment</a>` : ''}</p>
        <blockquote>${esc(p.body)}</blockquote>
        <textarea data-edit="dm" data-p="${who}" rows="6" aria-label="Your message to u/${esc(p.author)}">${esc(dmText(p))}</textarea>
        <div class="actions">
          ${idx === 4 ? `<button class="primary" data-p="${who}" data-set="To send">Put back in the queue</button>` : `
            <a class="button ${idx === 0 ? 'primary' : 'secondary'}" href="${esc(dmUrl(it, p))}" target="_blank" rel="noopener">Open message on Reddit</a>
            <button class="secondary" data-p="${who}" data-copy="dm">Copy message</button>
            ${next ? `<button class="${idx === 0 ? 'secondary' : 'primary'}" data-p="${who}" data-set="${next.to}">${next.label}</button>` : '<span class="done">Interview booked.</span>'}
            ${prev ? `<button class="quiet" data-p="${who}" data-set="${prev.to}">${prev.label}</button>` : ''}
            ${idx === 0 ? `<button class="quiet" data-p="${who}" data-set="Skip">Skip</button>` : ''}`}
          ${p.dmEdit !== undefined ? `<button class="quiet" data-p="${who}" data-restore="dm">Restore original</button>` : ''}
        </div>
      </section>`
  }
  const dm = it.people.length
    ? it.people.map(personSection).join('')
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
async function act(it, change) {
  const list = visible()
  const at = list.findIndex((i) => i.id === it.id)
  await change()
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
  else if (it && t.dataset.set) await act(it, () => patchPerson(it.id, t.dataset.p, { dmStatus: t.dataset.set }))
  else if (it && t.dataset.comment) await act(it, () => patch(it.id, { commentStatus: t.dataset.comment }))
  else if (it && t.dataset.copy) {
    const p = it.people.find((x) => key(x) === t.dataset.p)
    const text = t.dataset.copy === 'dm' ? dmText(p) : commentText(it)
    try { await navigator.clipboard.writeText(text) } catch { t.closest('section')?.querySelector('textarea')?.select(); document.execCommand('copy') }
    const label = t.textContent
    t.textContent = 'Copied'
    setTimeout(() => (t.textContent = label), 1500)
  } else if (it && t.dataset.restore) {
    await (t.dataset.restore === 'dm' ? patchPerson(it.id, t.dataset.p, { dmEdit: undefined }) : patch(it.id, { commentEdit: undefined }))
    render()
  }
})

document.addEventListener('input', (e) => {
  const kind = e.target.dataset?.edit
  const it = state.items.find((i) => i.id === state.selected)
  if (kind && it) kind === 'dm' ? patchPerson(it.id, e.target.dataset.p, { dmEdit: e.target.value }) : patch(it.id, { commentEdit: e.target.value })
})
$('sync').onclick = doSync
window.addEventListener('focus', () => { if (Date.now() - lastSync > 30_000) doSync() })
$('subfilter').addEventListener('change', (e) => { state.sub = e.target.value; render() })
$('settings').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage() }
// Do not redraw the page under someone who is typing; catch up when they click away.
let behind = false
document.addEventListener('focusout', () => { if (behind) { behind = false; load() } })
chrome.storage.onChanged.addListener(() => {
  if (Date.now() <= mute) return
  if (document.activeElement?.tagName === 'TEXTAREA') behind = true
  else load()
})
load().then(doSync)
