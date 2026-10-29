// Functions that run inside a TikTok page. Chrome copies each one into the page, so every function
// must stand alone: no imports and no outside variables.

export function collectLinks() {
  return [...new Set([...document.querySelectorAll('a[href*="/video/"]')].map((a) => a.href.split('?')[0]))].slice(0, 12)
}

export function readGuard() {
  const body = (document.body ? document.body.innerText : '').slice(0, 4000)
  return {
    loggedOutHint: /\bLog in\b/.test(body),
    verify: /captcha|verify to continue|drag the slider|are you human/i.test(body),
  }
}

export function readVideo() {
  const t = (s) => {
    const e = document.querySelector(s)
    return e ? e.innerText.replace(/\s+/g, ' ').trim() : ''
  }
  return {
    caption: t('[data-e2e="browse-video-desc"]'),
    likes: t('[data-e2e="like-count"]'),
    comments: t('[data-e2e="comment-count"]'),
  }
}

export async function readCommentsPage() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const items = () => document.querySelectorAll('[data-e2e="comment-level-1"]')
  for (let i = 0; i < 3 && !items().length; i++) {
    const tab = [...document.querySelectorAll('*')].find(
      (e) => e.childElementCount === 0 && /^Comments( \(\d+\))?$/.test((e.textContent || '').trim()),
    )
    if (tab) tab.click()
    await sleep(2000)
  }
  if (!items().length) return { ok: false, rows: [] }
  const panel = [...document.querySelectorAll('div')]
    .filter((d) => d.scrollHeight > d.clientHeight + 50 && d.querySelector('[data-e2e="comment-level-1"]'))
    .pop()
  for (let i = 0; i < 12; i++) {
    if (panel) panel.scrollTop = panel.scrollHeight
    await sleep(1100)
  }
  const rows = [...items()].map((el) => {
    let c = el
    for (let i = 0; i < 5 && c && !c.querySelector('a[href^="/@"]'); i++) c = c.parentElement
    const a = c && c.querySelector('a[href^="/@"]')
    return { handle: a ? a.getAttribute('href').split('?')[0].slice(2) : '', text: el.innerText.replace(/\s+/g, ' ') }
  })
  return { ok: true, rows }
}
