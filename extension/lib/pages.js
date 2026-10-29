// Functions that run inside a TikTok page. Chrome copies each one into the page, so every function
// must stand alone: no imports and no outside variables.
//
// The selectors below come from a real TikTok search page with a video opened over it:
//   search results   search_video-item (thumbnail), search-card-desc (caption), search-card-user-unique-id
//   opened video     browse-video-desc, browse-like-count, browse-comment-count, browse-close
//   comments         comment-level-1 (the text), comment-avatar-1 (link to /@handle); replies are level-2

export function readGuard() {
  const body = (document.body ? document.body.innerText : '').slice(0, 4000)
  return {
    loggedOutHint: /\bLog in\b/.test(body),
    verify: /captcha|verify to continue|drag the slider|are you human/i.test(body),
  }
}

// The video results on a search page, with the caption TikTok shows under each one.
export async function readSearchCards() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const cards = () => document.querySelectorAll('[data-e2e="search_video-item"]')
  for (let i = 0; i < 30 && !cards().length; i++) await sleep(500)
  const text = (root, sel) => {
    const e = root.querySelector(sel)
    return e ? e.innerText.replace(/\s+/g, ' ').trim() : ''
  }
  const out = []
  for (const card of cards()) {
    // Climb to the smallest wrapper that holds this card's caption, without reaching a wrapper that holds other cards.
    let root = card
    for (let i = 0; i < 6 && root.parentElement && root.parentElement.querySelectorAll('[data-e2e="search_video-item"]').length === 1; i++) {
      root = root.parentElement
    }
    const link = root.querySelector('a[href*="/video/"]')
    if (!link) continue
    out.push({
      url: link.href.split('?')[0],
      caption: text(root, '[data-e2e="search-card-desc"]') || text(root, '[data-e2e="search-card-video-caption"]'),
      views: text(root, '[data-e2e="video-views"]'),
      creator: text(root, '[data-e2e="search-card-user-unique-id"]'),
    })
  }
  return out.slice(0, 12)
}

// Opens a result the way a person does: click it, and TikTok shows the video over the search page.
export function clickCard(videoPath) {
  const link = [...document.querySelectorAll('a[href*="/video/"]')].find((a) => a.href.split('?')[0].endsWith(videoPath))
  if (!link) return false
  link.scrollIntoView({ block: 'center' })
  link.click()
  return true
}

// Waits for the opened video and reads its caption and counts. A video can have no caption, so `opened` says
// whether the video panel is showing at all. If it is not, `markers` lists the page's elements to help find out why.
export async function readOpenVideo() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const pick = (sels) => {
    for (const s of sels) {
      const e = document.querySelector(s)
      const t = e ? e.innerText.replace(/\s+/g, ' ').trim() : ''
      if (t) return t
    }
    return ''
  }
  const isOpen = () => Boolean(document.querySelector(
    '[data-e2e="browse-close"], [data-e2e="browse-like-count"], [data-e2e="browse-comment-count"], [data-e2e="browse-video-desc"]'))
  let caption = ''
  let openedAt = -1
  for (let i = 0; i < 24; i++) {
    caption = pick(['[data-e2e="browse-video-desc"]', '[data-e2e="video-desc"]'])
    if (caption) break
    if (isOpen()) {
      if (openedAt < 0) openedAt = i
      if (i - openedAt >= 4) break // open for two seconds and still no caption: this video has none
    }
    await sleep(500)
  }
  const opened = isOpen()
  const noise = /^(nav-|inbox|following-|tiktok-logo|search-box|search-user|upload-icon|profile-icon|copyright|right-click|all$|likes$|comments$|mentions$|followers$|follow-back$)/
  const markers = opened
    ? []
    : [...new Set([...document.querySelectorAll('[data-e2e]')].map((e) => e.getAttribute('data-e2e')))]
        .filter((n) => n && !noise.test(n))
        .slice(0, 30)
  return {
    opened,
    caption,
    likes: pick(['[data-e2e="browse-like-count"]', '[data-e2e="like-count"]']),
    comments: pick(['[data-e2e="browse-comment-count"]', '[data-e2e="comment-count"]']),
    path: location.pathname.replace(/@[^/]+/, '@user').replace(/\d{8,}/, 'ID'),
    markers,
  }
}

// Closes the opened video so the next result can be clicked.
export async function closeVideo() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const gone = () => !document.querySelector(
    '[data-e2e="browse-close"], [data-e2e="browse-like-count"], [data-e2e="browse-video-desc"]')
  const button = document.querySelector('[data-e2e="browse-close"]')
  if (button) button.click()
  for (let i = 0; i < 8 && !gone(); i++) await sleep(500)
  if (!gone()) {
    history.back()
    for (let i = 0; i < 8 && !gone(); i++) await sleep(500)
  }
  return gone()
}

// Reads the comments of the opened video, scrolling for more.
export async function readCommentsPage() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const items = () => document.querySelectorAll('[data-e2e="comment-level-1"]')
  for (let i = 0; i < 6 && !items().length; i++) {
    const tab = [...document.querySelectorAll('*')].find(
      (e) => e.childElementCount === 0 && /^Comments( \(\d+\))?$/.test((e.textContent || '').trim()),
    )
    if (tab) tab.click()
    await sleep(1500)
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
