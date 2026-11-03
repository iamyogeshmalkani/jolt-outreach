"""Mock Instagram pages. Reel pages carry the page summary tags Instagram puts in every post's HTML (og:description is
"<likes> likes, <comments> comments - <handle> on <date>: "<caption>"") and a <video>."""
import time

ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
EPOCH_MS = 1314220021721


def code_at(ms, n=0):
    """The shortcode Instagram gives a post made at `ms` (see lib/rules.js)."""
    i = ((int(ms) - EPOCH_MS) << 23) + n
    out = ""
    while i > 0:
        out = ALPHABET[i % 64] + out
        i //= 64
    return out.rjust(11, "A")


DAY = 86_400_000
NOW = int(time.time() * 1000)
# reel number -> (age in days, likes text or None for hidden, is a video)
REELS = {
    1: (3, "12,345", True),
    2: (10, "2.5K", True),
    3: (5, "40", True),       # too few likes
    4: (90, "9,999", True),   # too old: never opened
    5: (4, None, True),       # likes hidden: kept
    6: (6, "5,000", False),   # a photo post: not a video
}
CODES = {n: code_at(NOW - age * DAY, n) for n, (age, _, _) in REELS.items()}


def search_html(link_kind="reel", numbers=None):
    nums = numbers if numbers is not None else list(REELS)
    links = "".join(
        f'<a href="/{link_kind}/{CODES[n]}/"><img alt="reel {n} about phone addiction" src="x.jpg"></a>' for n in nums
    )
    return f"<html><head><title>Search</title></head><body><main>{links}</main></body></html>"


def reel_html(code, layout="list"):
    """layout "list": comments are li items in a ul, replies in a ul inside the item (Instagram's older markup).
    layout "real": avatar and name links, a <time> beside each comment, "View replies (2)", and a list of suggested accounts without times.
    layout "plain": like "divs" but the text elements have no dir attribute.
    layout "divs": no lists at all; avatar and name links, @mentions inside the text, labels like "Reply", replies in nested divs."""
    n = next((k for k, v in CODES.items() if v == code), None)
    if n is None:
        return "<html><head><title>Page not found</title></head><body>Sorry, this page isn't available.</body></html>"
    _, likes, video = REELS[n]
    counts = f"{likes} likes, 12 comments - " if likes else ""
    desc = f'{counts}maker{n} on March 3, 2026: "Why I cannot stop scrolling #{n}"'
    og_video = '<meta property="og:video" content="https://cdn/x.mp4">' if video else ""
    video_tag = "<video></video>" if video else "<img src='x.jpg'>"
    if layout == "real":
        # shaped like the real page: a "suggested" list with profile links and text but no times, then comments whose time is a <time>
        row = """const d = document.createElement('div')
    d.innerHTML = `<div><a href="/fan${n}/"><img alt="fan${n}'s profile picture" src="a.jpg"></a><div><a href="/fan${n}/" role="link"><span>fan${n}</span></a>
      <a href="/p/CODE/c/${n}/"><time datetime="2026-10-01T00:00:00Z">4w</time></a></div>
      <span dir="auto">${text}</span><div><span>Reply</span><span dir="auto">View replies (2)</span></div></div>`
    list.appendChild(d)"""
        holder = '<div id="comments"></div>'
        before = """<aside><div><a href="/suggested.one/"><span>suggested.one</span></a><span dir="auto">Followed by people you know and more</span></div>
<div><a href="/suggested.two/"><span>suggested.two</span></a><span dir="auto">Suggested for you, my screen time is also bad</span></div></aside>"""
    elif layout == "plain":
        row = """const d = document.createElement('div')
    d.innerHTML = `<div><a href="/fan${n}/"><img src="a.jpg"></a><a href="/fan${n}/"><span>fan${n}</span></a><span>${text}</span><div><span>3d</span><span>Reply</span></div></div>`
    list.appendChild(d)"""
        holder = '<div id="comments"></div>'
    elif layout == "list":
        row = """const li = document.createElement('li')
    li.innerHTML = `<div><a href="/fan${n}/">fan${n}</a><span dir="auto">${text}</span><span dir="auto">3d</span>
      <ul><li><a href="/replier/">replier</a><span dir="auto">a long reply about phone addiction that must be ignored, it is the longest text here</span></li></ul></div>`
    list.appendChild(li)"""
        holder = '<ul id="comments"></ul>'
    else:
        row = """const d = document.createElement('div')
    d.innerHTML = `<div><a href="/fan${n}/"><img src="a.jpg"></a><a href="/fan${n}/" role="link"><span>fan${n}</span></a>
      <div><span dir="auto">${text} <a href="/someone.else/">@someone.else</a></span></div>
      <div><span dir="auto">3d</span><span dir="auto">12 likes</span><span dir="auto">Reply</span><span dir="auto">View 2 replies</span></div></div>`
    list.appendChild(d)"""
        holder = '<div id="comments"></div>'
    before = locals().get("before", "")
    return f"""<html><head><title>maker{n} on Instagram</title>
<meta property="og:description" content='{desc}'>{og_video}</head>
<body>{before}<article><header><a role="link" href="/maker{n}/">maker{n}</a></header>{video_tag}
<div id="panel" style="height:120px;overflow:auto">{holder}</div></article>
<script>(() => {{
  const list = document.getElementById('comments'), panel = document.getElementById('panel')
  let n = 0
  const add = (k) => {{ for (let i = 0; i < k; i++, n++) {{
    const text = n % 2 ? 'what a nice song, love the editing ' + n : 'My screen time is 9 hours a day and the brain rot is real ' + n
    {row}
  }} }}
  add(5)
  panel.addEventListener('scroll', () => {{ if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 5 && n < 80) add(8) }})
}})()</script></body></html>"""
