"""Runs the in-page functions from lib/pages.js against a mock TikTok page in a real browser.
Run:  .venv/bin/python extension/test/pages_test.py"""
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

from fixtures import search_html

SRC = (Path(__file__).parent.parent / "lib" / "pages.js").read_text(encoding="utf-8")


def fn(name, args=""):
    m = re.search(r"export (async )?function " + name + r"\(.*?\n\}", SRC, re.S)
    assert m, name
    return "(" + m.group(0).replace("export ", "", 1) + ")(" + args + ")"


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True)
        page = b.new_page()

        # guard
        for html, want in [
            ("<body>Please verify to continue. Drag the slider</body>", {"loggedOutHint": False, "verify": True}),
            ("<body>Log in to follow creators</body>", {"loggedOutHint": True, "verify": False}),
            ("<body>For You</body>", {"loggedOutHint": False, "verify": False}),
        ]:
            page.set_content(html)
            assert page.evaluate(fn("readGuard")) == want
        print("readGuard ok")

        # search results: each card paired with its own caption and creator
        page.set_content(search_html())
        cards = page.evaluate(fn("readSearchCards"))
        assert [c["url"] for c in cards] == [f"https://www.tiktok.com/@maker{i}/video/{i}" for i in (1, 2, 3)], cards
        assert cards[0]["caption"] == "Why I can't stop doomscrolling #dopamine detox", cards[0]
        assert cards[2]["caption"] == "cooking pasta tonight #dinner" and cards[1]["creator"] == "maker2", cards
        assert cards[1]["views"] == "235", cards[1]
        print("readSearchCards ok:", [(c["creator"], c["caption"][:22]) for c in cards])

        page.set_content("<body>no results</body>")
        assert page.evaluate(fn("readSearchCards")) == []

        # open a result by clicking it, read it, then close it
        page.set_content(search_html())
        assert page.evaluate(fn("clickCard", "'/@maker2/video/2'")) is True
        assert page.evaluate(fn("clickCard", "'/@nobody/video/9'")) is False
        info = page.evaluate(fn("readOpenVideo"))
        assert info["caption"] == "my dopamine detox: day 7" and info["likes"] == "9K" and info["comments"] == "40", info
        assert info["markers"] == []
        print("clickCard + readOpenVideo ok:", info["caption"], info["comments"])
        assert page.evaluate(fn("closeVideo")) is True
        assert page.query_selector('[data-e2e="browse-video-desc"]') is None
        print("closeVideo ok")

        # opened video: comments (top-level only), scrolled for more
        page.evaluate(fn("clickCard", "'/@maker1/video/1'"))
        page.evaluate(fn("readOpenVideo"))
        got = page.evaluate(fn("readCommentsPage"))
        assert got["ok"] and len(got["rows"]) > 8, len(got["rows"])
        assert got["rows"][0] == {"handle": "fan0", "text": "Quit again for a couple days but came back to it, my phone wins 0"}, got["rows"][0]
        assert not any("reply that must be ignored" in r["text"] for r in got["rows"])
        print(f"readCommentsPage ok: {len(got['rows'])} comments, first = {got['rows'][0]}")

        # a page without the expected elements reports what it does have
        page.set_content('<body><div data-e2e="something-new">x</div><div data-e2e="browse-music">m</div></body>')
        info = page.evaluate(fn("readOpenVideo"))
        assert info["caption"] == "" and info["markers"] == ["something-new", "browse-music"], info
        assert page.evaluate(fn("readCommentsPage")) == {"ok": False, "rows": []}
        print("missing caption lists the page's elements:", info["markers"])
        b.close()


if __name__ == "__main__":
    sys.exit(main())
