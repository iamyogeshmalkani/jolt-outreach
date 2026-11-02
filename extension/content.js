// Runs on TikTok pages. When a video is opened from the outreach page's "Comment" link, the address ends in
//   #jolt=<{"f": "handle to show first", "c": [{"h": "handle", "t": "start of their comment"}, ...]}>
// listing every saved comment on this video. This scrolls the comments (loading more as it goes) until they all show, highlights
// them, and adds ‹ › buttons to step from one to the next. Opened any other way, it does nothing.
;(() => {
  if (window.__joltJump) return
  window.__joltJump = true

  function norm(s) {
    return String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  }
  const handleOf = (s) => String(s ?? '').toLowerCase().replace(/^@/, '')

  const ask = (() => {
    const m = /[#&]jolt=([^&]+)/.exec(location.hash)
    if (!m) return null
    try {
      const v = JSON.parse(decodeURIComponent(m[1]))
      const list = (Array.isArray(v?.c) ? v.c : v?.h ? [v] : []).filter((x) => x && x.h).map((x) => ({ h: handleOf(x.h), t: norm(x.t) }))
      return list.length ? { first: handleOf(v.f || v.h || list[0].h), list } : null
    } catch {
      return null
    }
  })()
  if (!ask) return

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const items = () => [...document.querySelectorAll('[data-e2e="comment-level-1"]')]

  // ---- the small bar at the top: what was found, and ‹ › to step through
  const bar = document.createElement('div')
  bar.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:12px;transform:translateX(-50%);display:flex;align-items:center;gap:8px;' +
    'background:#111;color:#b5fc4f;font:600 14px system-ui,sans-serif;padding:6px 10px;border-radius:10px;box-shadow:0 2px 12px #0008'
  const label = document.createElement('span')
  const button = (text, title, onclick) => {
    const b = document.createElement('button')
    b.textContent = text
    b.title = title
    b.type = 'button'
    b.onclick = onclick
    b.style.cssText = 'all:unset;cursor:pointer;color:#111;background:#b5fc4f;border-radius:6px;padding:2px 10px;font:700 16px system-ui,sans-serif'
    return b
  }
  const prev = button('‹', 'Previous comment', () => step(-1))
  const next = button('›', 'Next comment', () => step(1))
  const close = button('×', 'Dismiss', () => {
    bar.remove()
    for (const el of marked) unmark(el)
  })
  prev.hidden = next.hidden = true
  bar.append(prev, label, next, close)
  const say = (text) => {
    label.textContent = text
    if (!bar.isConnected) document.documentElement.appendChild(bar)
  }

  // ---- finding
  // The writer of a comment: the first profile link in the smallest wrapper that has one.
  const writerOf = (el) => {
    let c = el
    for (let i = 0; i < 5 && c && !c.querySelector('a[href^="/@"]'); i++) c = c.parentElement
    const a = c && c.querySelector('a[href^="/@"]')
    return a ? a.getAttribute('href').split('?')[0].slice(2).toLowerCase() : ''
  }
  const matches = (el, want) => writerOf(el) === want.h && (!want.t || norm(el.innerText).includes(want.t))
  const located = () => {
    const els = items()
    return ask.list.map((want) => els.find((el) => matches(el, want)) || null)
  }

  const marked = []
  const mark = (el) => {
    el.style.cssText += ';outline:3px solid #b5fc4f88;outline-offset:4px;background:#b5fc4f22;border-radius:6px'
    marked.push(el)
  }
  const unmark = (el) => {
    el.style.outline = ''
    el.style.background = ''
  }

  let found = [] // the comment elements that were found, top to bottom
  let at = 0
  let missing = 0 // saved comments that were not found on the page
  function show(i) {
    at = (i + found.length) % found.length
    for (const el of found) el.style.background = '#b5fc4f22'
    const el = found[at]
    el.style.background = '#b5fc4f66'
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    say(`Jolt: comment ${at + 1} of ${found.length}${missing ? ` (${missing} not found)` : ''}`)
  }
  function step(d) {
    if (found.length) show(at + d)
  }
  addEventListener('keydown', (e) => {
    if (!found.length || /^(input|textarea)$/i.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable) return
    if (e.altKey && e.key === 'ArrowRight') step(1)
    if (e.altKey && e.key === 'ArrowLeft') step(-1)
  })

  const openComments = () => {
    const tab = [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && /^Comments( \(\d+\))?$/.test((e.textContent || '').trim()))
    if (tab) tab.click()
  }
  const panel = () =>
    [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 50 && d.querySelector('[data-e2e="comment-level-1"]')).pop()

  async function run() {
    say('Jolt: looking for the comments…')
    for (let i = 0; i < 20 && !items().length; i++) {
      if (i % 4 === 3) openComments()
      await sleep(1000)
    }
    let stale = 0
    let last = -1
    let hits = located()
    for (let round = 0; round < 600 && hits.some((h) => !h); round++) {
      const n = items().length
      stale = n === last ? stale + 1 : 0
      last = n
      if (stale >= 6) break // nothing new has loaded for a while: that is all of them
      const p = panel()
      if (p) p.scrollTop = p.scrollHeight
      else items().at(-1)?.scrollIntoView({ block: 'end' })
      say(`Jolt: looking for the comments… (${hits.filter(Boolean).length} of ${ask.list.length} found, ${n} read)`)
      await sleep(1200)
      hits = located()
    }
    const unique = [...new Set(hits.filter(Boolean))]
    if (!unique.length) {
      say('Jolt: could not find the comments (they may have been deleted)')
      return
    }
    const order = items()
    found = unique.sort((a, b) => order.indexOf(a) - order.indexOf(b))
    for (const el of found) mark(el)
    prev.hidden = next.hidden = found.length < 2
    missing = ask.list.length - new Set(hits.filter(Boolean)).size
    const firstEl = found.find((el) => writerOf(el) === ask.first) || found[0]
    show(found.indexOf(firstEl))
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true })
  else run()
})()
