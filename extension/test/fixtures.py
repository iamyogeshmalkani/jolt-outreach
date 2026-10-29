"""A mock TikTok search page built from the structure of a real one (data-e2e names taken from a real page):
results are search_video-item cards, and clicking one opens the video over the results with browse-* elements
and a scrollable list of comment-level-1 comments."""

CAPTIONS = {
    1: "Why I can't stop doomscrolling #dopamine detox",
    2: "my dopamine detox: day 7",
    3: "cooking pasta tonight #dinner",
    4: "",  # a video with no caption at all
}


def search_html(captions=CAPTIONS, comment_count="40", open_delay_ms=600):
    cards = "".join(
        f"""<div class="item">
  <div data-e2e="search_video-item"><a href="https://www.tiktok.com/@maker{i}/video/{i}"><strong data-e2e="video-views">{i}35</strong></a></div>
  <div data-e2e="search-card-desc">{cap}</div>
  <a data-e2e="search-card-user-link" href="/@maker{i}"><p data-e2e="search-card-user-unique-id">maker{i}</p></a>
</div>"""
        for i, cap in captions.items()
    )
    return f"""<body>
<form data-e2e="search-box">search</form>
<div data-e2e="search_video-item-list">{cards}</div>
<script>(() => {{
  const caption = (a) => a.closest('.item').querySelector('[data-e2e="search-card-desc"]').innerText
  document.addEventListener('click', (e) => {{
    const a = e.target.closest('a[href*="/video/"]')
    if (!a) return
    e.preventDefault()
    setTimeout(() => {{
      document.getElementById('modal')?.remove()
      const m = document.createElement('div')
      m.id = 'modal'
      m.innerHTML = `<button data-e2e="browse-close"></button>
        ${{caption(a) ? '<div data-e2e="browse-video-desc">' + caption(a) + '</div>' : ''}}
        <strong data-e2e="browse-like-count">9K</strong><strong data-e2e="browse-comment-count">{comment_count}</strong>
        <div id="panel" style="height:200px;overflow:auto"></div>`
      document.body.appendChild(m)
      const panel = m.querySelector('#panel')
      let n = 0
      const add = (k) => {{ for (let i = 0; i < k; i++, n++) {{ const r = document.createElement('div')
        r.innerHTML = `<a data-e2e="comment-avatar-1" href="/@fan${{n}}?lang=en"></a><span data-e2e="comment-username-1">Fan ${{n}}</span>
          <p data-e2e="comment-level-1">Quit again for a couple days but came back to it, my phone wins ${{n}}</p>
          <p data-e2e="comment-level-2">a reply that must be ignored</p>`
        panel.appendChild(r) }} }}
      add(5)
      panel.addEventListener('scroll', () => {{ if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 5 && n < 40) add(8) }})
      m.querySelector('[data-e2e="browse-close"]').addEventListener('click', () => m.remove())
    }}, {open_delay_ms})
  }})
}})()</script></body>"""
