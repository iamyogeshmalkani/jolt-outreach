// Runs on TikTok pages. When a video is opened from the outreach page's "Comment" link, the address ends in
//   #jolt=<{"h": "handle", "t": "start of their comment"}>
// and this scrolls the video's comments (loading more as it goes) until that person's comment shows, then highlights it.
// Opened any other way, it does nothing.
;(() => {
  if (window.__joltJump) return
  window.__joltJump = true

  const ask = (() => {
    const m = /[#&]jolt=([^&]+)/.exec(location.hash)
    if (!m) return null
    try {
      const v = JSON.parse(decodeURIComponent(m[1]))
      return v && v.h ? { h: String(v.h).toLowerCase().replace(/^@/, ''), t: norm(v.t) } : null
    } catch {
      return null
    }
  })()
  if (!ask) return

  function norm(s) {
    return String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const items = () => [...document.querySelectorAll('[data-e2e="comment-level-1"]')]

  const banner = (() => {
    const el = document.createElement('div')
    el.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:12px;transform:translateX(-50%);background:#111;color:#b5fc4f;' +
      'font:600 14px system-ui,sans-serif;padding:8px 14px;border-radius:8px;box-shadow:0 2px 12px #0008;cursor:pointer'
    el.title = 'Click to dismiss'
    el.onclick = () => el.remove()
    return el
  })()
  const say = (text) => {
    banner.textContent = text
    if (!banner.isConnected) document.documentElement.appendChild(banner)
  }

  // The writer of a comment: the first profile link in the smallest wrapper that has one.
  const writerOf = (el) => {
    let c = el
    for (let i = 0; i < 5 && c && !c.querySelector('a[href^="/@"]'); i++) c = c.parentElement
    const a = c && c.querySelector('a[href^="/@"]')
    return a ? a.getAttribute('href').split('?')[0].slice(2).toLowerCase() : ''
  }
  const find = () => items().find((el) => writerOf(el) === ask.h && (!ask.t || norm(el.innerText).includes(ask.t)))

  const openComments = () => {
    const tab = [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && /^Comments( \(\d+\))?$/.test((e.textContent || '').trim()))
    if (tab) tab.click()
  }
  const panel = () =>
    [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 50 && d.querySelector('[data-e2e="comment-level-1"]')).pop()

  async function run() {
    say('Jolt: looking for the comment…')
    for (let i = 0; i < 20 && !items().length; i++) {
      if (i % 4 === 3) openComments()
      await sleep(1000)
    }
    let stale = 0
    let last = -1
    for (let round = 0; round < 600; round++) {
      const hit = find()
      if (hit) {
        hit.scrollIntoView({ block: 'center', behavior: 'smooth' })
        hit.style.cssText += ';outline:3px solid #b5fc4f;outline-offset:4px;background:#b5fc4f33;border-radius:6px'
        say('Jolt: found their comment')
        setTimeout(() => banner.remove(), 6000)
        return
      }
      const n = items().length
      stale = n === last ? stale + 1 : 0
      last = n
      if (stale >= 6) break // nothing new has loaded for a while: this is all of them
      const p = panel()
      if (p) p.scrollTop = p.scrollHeight
      else items().at(-1)?.scrollIntoView({ block: 'end' })
      say(`Jolt: looking for the comment… (${n} read)`)
      await sleep(1200)
    }
    say('Jolt: could not find the comment (it may have been deleted)')
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true })
  else run()
})()
