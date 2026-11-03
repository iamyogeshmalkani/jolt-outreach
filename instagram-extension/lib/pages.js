// Functions that run inside an Instagram page. Chrome copies each one into the page, so every function
// must stand alone: no imports and no outside variables.
//
// What they read:
//   search results   links to /reel/<code>/ and /p/<code>/ on the search or hashtag page
//   an opened reel   the page's own summary tags (og:description is "1,234 likes, 56 comments - handle on March 3, 2026: "caption"",
//                    og:video exists for videos), then the page itself as a fallback. Likes can be hidden by the creator.
//   comments         the list items (li) of the comment list, each with the writer's profile link and the comment text; replies sit in
//                    a list inside an item and are skipped

export function readGuard() {
  const body = (document.body ? document.body.innerText : '').slice(0, 4000)
  const path = location.pathname
  return {
    loggedOut: /^\/accounts\/(login|emailsignup)/.test(path) || Boolean(document.querySelector('input[name="username"][type="text"], input[name="password"]')),
    verify: /^\/(challenge|accounts\/suspended|accounts\/disabled)/.test(path) ||
      /confirm (it'?s|that it'?s) you|suspicious activity|automated behavior|try again later|we restrict certain activity|temporarily blocked/i.test(body),
  }
}

// The reel and post links on a search or hashtag page, in the order Instagram shows them.
export async function readSearchCards() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const links = () => [...document.querySelectorAll('a[href*="/reel/"], a[href*="/p/"]')]
  for (let i = 0; i < 30 && !links().length; i++) await sleep(500)
  await sleep(1500)
  const seen = new Set()
  const out = []
  for (const a of links()) {
    const m = /\/(reel|p)\/([A-Za-z0-9_-]{5,})/.exec(new URL(a.href, location.href).pathname)
    if (!m || seen.has(m[2])) continue
    seen.add(m[2])
    const img = a.querySelector('img[alt]')
    out.push({ url: `https://www.instagram.com/${m[1]}/${m[2]}/`, caption: img ? img.alt.replace(/\s+/g, ' ').trim().slice(0, 300) : '', reel: m[1] === 'reel' })
  }
  // Reels first: a /p/ link may be a photo.
  return [...out.filter((c) => c.reel), ...out.filter((c) => !c.reel)].slice(0, 30).map(({ url, caption }) => ({ url, caption }))
}

// Waits for a reel's own page and reads it. `opened` says whether a post is showing at all; if it is not, `markers` lists what the
// page has, to help find out why.
export async function readOpenVideo() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const meta = (name) => (document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.content || '').replace(/\s+/g, ' ').trim()
  const isOpen = () => Boolean(meta('og:description') || meta('og:video') || document.querySelector('video, article'))
  for (let i = 0; i < 24 && !isOpen(); i++) await sleep(500)
  await sleep(1200) // let the video and its counts settle
  const opened = isOpen()
  const desc = meta('og:description')
  const count = '([\\d.,]+\\s*[KMB]?)'
  const likes = new RegExp(`${count}\\s+likes?`, 'i').exec(desc)?.[1]
  const comments = new RegExp(`${count}\\s+comments?`, 'i').exec(desc)?.[1]
  // "... - handle on March 3, 2026: "caption"" and the shorter "handle on Instagram: "caption""
  const who = /(?:-|^)\s*@?([A-Za-z0-9._]{1,30}) on (?:Instagram|[A-Z][a-z]+ \d)/.exec(desc)?.[1]
  const quoted = /: [“"](.*)[”"]\.?$/s.exec(desc)?.[1]
  const fromPage = (document.querySelector('header a[role="link"][href^="/"], article header a[href^="/"]')?.getAttribute('href') || '').split('/')[1]
  const liked = document.querySelector('a[href$="/liked_by/"] span')?.textContent || ''
  const path = location.pathname.replace(/\/(reel|p|tv)\/[^/]+/, '/$1/CODE')
  return {
    opened,
    isVideo: Boolean(meta('og:video') || meta('og:type').includes('video') || document.querySelector('video')),
    caption: (quoted || (document.querySelector('h1')?.innerText || '')).replace(/\s+/g, ' ').trim(),
    likes: (likes || liked || '').replace(/\s+/g, ''),
    comments: (comments || '').replace(/\s+/g, ''),
    creator: who || fromPage || '',
    path,
    markers: opened ? [] : [document.title.slice(0, 60), path, ...[...new Set([...document.querySelectorAll('[role]')].map((e) => e.getAttribute('role')))].slice(0, 12)],
  }
}

// Reads the first `max` comments of the opened reel (Instagram lists the top ones first), scrolling just enough to load them.
// It does not depend on Instagram's list markup, which changes. It walks the page in reading order: a profile link followed by the text
// beside it is one comment (the avatar link and the name link before the text count once; @mentions inside text, "Reply" and like
// counts are ignored). Every real comment shows how long ago it was written ("4w", a <time> element), and a profile link with text but
// no time is not a comment (suggested accounts, menus and the like), so only rows with a time are kept. Replies in a list inside a comment are skipped; if the page lays replies out another way they are read
// as comments of their own. If the comments are not showing it clicks the comment button. When nothing is found, `diag` describes
// the page so the log shows why.
export async function readCommentsPage(max = 50) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const NOT_PROFILES = new Set(['explore', 'reels', 'reel', 'p', 'tv', 'direct', 'accounts', 'stories', 'about', 'legal', 'web', 'directory', 'tags', 'locations'])
  const profile = (a) => {
    const h = /^\/([A-Za-z0-9._]{1,30})\/$/.exec(new URL(a.href, location.href).pathname)?.[1] || ''
    return NOT_PROFILES.has(h.toLowerCase()) ? '' : h
  }
  const TIME = /^(\d+ ?(s|m|h|d|w|y|sec|min|hr|hour|day|week|month|year)s?|just now|now)( ?[·•].*)?$/i // "4w", "3 days", "4w · Edited"
  const NOISE = /^(reply|replies|like|liked|see translation|translate|edited|pinned|author|·|•|[\d.,KMB]+ ?(likes?|repl(y|ies))|(view|hide)( all)? ?\(?[\d.,]*\)? ?(more )?repl(y|ies)\)?( \(?[\d.,]*\)?)?)$/i
  const inChrome = (e) => Boolean(e.closest('nav, header, [role="navigation"]'))
  // inside a list that sits inside a comment's list item: a reply
  const inReplies = (e) => {
    const li = e.closest('li')
    return Boolean(li && li.parentElement?.closest('li'))
  }
  // Comment text is normally a span or div with dir="auto". If nothing is found that way, any small text element is tried.
  const DIR = 'span[dir="auto"], div[dir="auto"]'
  const rows = (textSel = DIR) => {
    const dir = textSel === DIR
    const out = []
    let cur = null
    const flush = () => {
      if (cur && cur.timed && cur.texts.length) {
        const best = cur.texts.slice().sort((a, b) => b.t.length - a.t.length)[0]
        out.push({ handle: cur.handle, text: best.t, el: best.el })
      }
      cur = null
    }
    for (const e of document.querySelectorAll(`a[href^="/"], time, ${textSel}`)) {
      if (inChrome(e) || inReplies(e)) continue
      if (e.tagName === 'TIME') {
        if (cur) cur.timed = true
      } else if (e.tagName === 'A') {
        const handle = profile(e)
        if (!handle || (dir && e.closest(DIR))) continue // not a profile, or an @mention inside a comment
        if (cur && !cur.texts.length && !cur.timed) cur.handle = handle // the avatar link and the name link of one comment
        else {
          flush()
          cur = { handle, texts: [], timed: false }
        }
      } else if (cur && !e.closest('a') && (dir ? !e.querySelector(DIR) : ![...e.children].some((c) => !/^(A|BR|IMG|SVG)$/i.test(c.tagName)))) {
        const t = e.innerText.replace(/\s+/g, ' ').trim()
        if (TIME.test(t)) cur.timed = true
        else if (t.length > 1 && t.toLowerCase() !== cur.handle.toLowerCase() && !NOISE.test(t)) cur.texts.push({ t, el: e })
      }
    }
    flush()
    return out
  }
  const allRows = () => {
    const found = rows()
    return found.length ? found : rows('span, div')
  }
  const openComments = () => {
    const btn = document.querySelector('[aria-label="Comment"], [aria-label="Comments"], [aria-label^="Comment" i]')
    btn?.closest('[role="button"], button')?.click()
  }

  for (let i = 0; i < 12 && !allRows().length; i++) {
    if (i === 2 || i === 6) openComments()
    await sleep(1000)
  }
  if (!allRows().length) {
    const labels = [...new Set([...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')))].slice(0, 14)
    return {
      ok: false,
      rows: [],
      diag: `${[...document.querySelectorAll('a[href^="/"]')].filter(profile).length} profile links, ${document.querySelectorAll('span[dir="auto"]').length} text spans, ${document.querySelectorAll('time').length} time elements, ` +
        `${document.querySelectorAll('ul').length} lists, aria-labels: ${labels.join(' / ') || 'none'}`,
    }
  }
  const scroller = (el) => {
    for (let n = el.parentElement; n; n = n.parentElement) if (n.scrollHeight > n.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(n).overflowY)) return n
    return null
  }
  const panel = scroller(allRows()[0].el)
  for (let i = 0; i < 12 && allRows().length < max; i++) {
    if (panel) panel.scrollTop = panel.scrollHeight
    else allRows().at(-1)?.el.scrollIntoView({ block: 'end' })
    await sleep(1100)
  }
  return { ok: true, rows: allRows().slice(0, max).map(({ handle, text }) => ({ handle, text })) }
}
