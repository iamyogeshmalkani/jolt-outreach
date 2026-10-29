"""Runs the in-page functions from lib/pages.js against mock TikTok pages in a real browser.
Run:  .venv/bin/python extension/test/pages_test.py"""
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

SRC = (Path(__file__).parent.parent / "lib" / "pages.js").read_text(encoding="utf-8")


def fn(name):
    m = re.search(r"export (async )?function " + name + r"\(.*?\n\}", SRC, re.S)
    assert m, name
    return "(" + m.group(0).replace("export ", "", 1) + ")()"


SEARCH = """<body>
<a href="https://www.tiktok.com/@a/video/1?lang=en">one</a>
<a href="https://www.tiktok.com/@a/video/1?other=1">one again</a>
<a href="https://www.tiktok.com/@b/video/2">two</a>
<a href="https://www.tiktok.com/@b">profile, not a video</a></body>"""

VIDEO = """<body>
<div data-e2e="browse-video-desc">  Why I can't stop   doomscrolling #fyp </div>
<strong data-e2e="like-count">48.1K</strong><strong data-e2e="comment-count">1,204</strong>
<div id="tabs"><span>Comments (1204)</span></div>
<div id="panel" style="height:200px;overflow:auto"></div>
<script>(() => {
  let n = 0
  const panel = document.getElementById('panel')
  function add(k) {
    for (let i = 0; i < k; i++, n++) {
      const row = document.createElement('div')
      row.innerHTML = `<a href="/@user${n}?lang=en">user${n}</a><div data-e2e="comment-level-1">I can't stop   scrolling my phone, comment ${n}</div>`
      panel.appendChild(row)
    }
  }
  document.querySelector('#tabs span').addEventListener('click', () => { if (!n) add(8) })
  panel.addEventListener('scroll', () => { if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 5 && n < 40) add(8) })
})()</script></body>"""


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True)
        page = b.new_page()

        page.set_content(SEARCH)
        links = page.evaluate(fn("collectLinks"))
        assert links == ["https://www.tiktok.com/@a/video/1", "https://www.tiktok.com/@b/video/2"], links
        print("collectLinks ok:", links)

        page.set_content("<body>Please verify to continue. Drag the slider</body>")
        assert page.evaluate(fn("readGuard")) == {"loggedOutHint": False, "verify": True}
        page.set_content("<body>Log in to follow creators</body>")
        assert page.evaluate(fn("readGuard")) == {"loggedOutHint": True, "verify": False}
        page.set_content("<body>For You</body>")
        assert page.evaluate(fn("readGuard")) == {"loggedOutHint": False, "verify": False}
        print("readGuard ok")

        page.set_content(VIDEO)
        info = page.evaluate(fn("readVideo"))
        assert info == {"caption": "Why I can't stop doomscrolling #fyp", "likes": "48.1K", "comments": "1,204"}, info
        page.set_content("<body>nothing here</body>")
        assert page.evaluate(fn("readVideo")) == {"caption": "", "likes": "", "comments": ""}
        print("readVideo ok:", info)

        page.set_content(VIDEO)
        got = page.evaluate(fn("readCommentsPage"))
        assert got["ok"] and len(got["rows"]) > 8, len(got["rows"])  # opened the tab, then scrolled for more
        first = got["rows"][0]
        assert first == {"handle": "user0", "text": "I can't stop scrolling my phone, comment 0"}, first
        print(f"readCommentsPage ok: {len(got['rows'])} comments, first = {first}")

        page.set_content("<body><span>Comments</span></body>")
        assert page.evaluate(fn("readCommentsPage")) == {"ok": False, "rows": []}
        print("readCommentsPage reports failure when nothing loads: ok")
        b.close()


if __name__ == "__main__":
    sys.exit(main())
