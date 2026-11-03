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
// Replies are left out. If the comments are not showing, it clicks the comment button once.
export async function readCommentsPage(max = 50) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const profile = (a) => /^\/([A-Za-z0-9._]{1,30})\/$/.exec(new URL(a.href, location.href).pathname)?.[1] || ''
  // What belongs to this item only: not its replies, which sit in a list inside it.
  const own = (li, sel) => [...li.querySelectorAll(sel)].filter((e) => e.closest('li') === li)
  const items = () => [...document.querySelectorAll('li')].filter((li) => !li.parentElement.closest('li') &&
    own(li, 'a[href^="/"]').some(profile) && own(li, 'span[dir="auto"]').some((sp) => !sp.closest('a')))
  for (let i = 0; i < 8 && !items().length; i++) {
    if (i === 2) document.querySelector('[aria-label="Comment"]')?.closest('[role="button"], button')?.click()
    await sleep(1000)
  }
  if (!items().length) return { ok: false, rows: [] }
  const scroller = (el) => {
    for (let n = el.parentElement; n; n = n.parentElement) if (n.scrollHeight > n.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(n).overflowY)) return n
    return null
  }
  const panel = scroller(items()[0])
  for (let i = 0; i < 12 && items().length < max; i++) {
    if (panel) panel.scrollTop = panel.scrollHeight
    else items().at(-1)?.scrollIntoView({ block: 'end' })
    await sleep(1100)
  }
  const rows = items().slice(0, max).map((li) => {
    const handle = own(li, 'a[href^="/"]').map(profile).find(Boolean) || ''
    const texts = own(li, 'span[dir="auto"]').filter((sp) => !sp.closest('a')).map((sp) => sp.innerText.replace(/\s+/g, ' ').trim())
    return { handle, text: texts.sort((a, b) => b.length - a.length)[0] || '' }
  })
  return { ok: true, rows }
}
