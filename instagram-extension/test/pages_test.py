"""Runs the in-page functions from lib/pages.js against mock Instagram pages in a real browser.
Run:  .venv/bin/python instagram-extension/test/pages_test.py"""
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

from fixtures import CODES, reel_html, search_html

SRC = (Path(__file__).parent.parent / "lib" / "pages.js").read_text(encoding="utf-8")


def fn(name, args=""):
    m = re.search(r"export (async )?function " + name + r"\(.*?\n\}", SRC, re.S)
    assert m, name
    return "(" + m.group(0).replace("export ", "", 1) + ")(" + args + ")"


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True)
        page = b.new_page()

        def show(url, html):
            page.route(url, lambda r: r.fulfill(status=200, content_type="text/html", body=html))
            page.goto(url)
            page.unroute(url)

        # guard: login pages and checks
        for url, html, want in [
            ("https://www.instagram.com/accounts/login/", "<body>Log in</body>", {"loggedOut": True, "verify": False}),
            ("https://www.instagram.com/explore/", "<body><input name='username' type='text'><input name='password' type='password'></body>", {"loggedOut": True, "verify": False}),
            ("https://www.instagram.com/challenge/abc/", "<body>Confirm it's you</body>", {"loggedOut": False, "verify": True}),
            ("https://www.instagram.com/explore/", "<body>Please wait a few minutes before you try again. Try again later.</body>", {"loggedOut": False, "verify": True}),
            ("https://www.instagram.com/explore/", "<body>Explore</body>", {"loggedOut": False, "verify": False}),
        ]:
            show(url, html)
            assert page.evaluate(fn("readGuard")) == want, (url, page.evaluate(fn("readGuard")))
        print("readGuard ok")

        # search results: reel links, one entry per reel, reels before photo-style /p/ links, standard address form
        show("https://www.instagram.com/explore/search/keyword/?q=x", search_html())
        cards = page.evaluate(fn("readSearchCards"))
        assert [c["url"] for c in cards] == [f"https://www.instagram.com/reel/{CODES[n]}/" for n in (1, 2, 3, 4, 5, 6)], cards
        assert cards[0]["caption"] == "reel 1 about phone addiction", cards[0]
        show("https://www.instagram.com/explore/tags/x/", search_html("p", [1, 2]) + '<a href="/reel/' + CODES[3] + '/">r</a><a href="/p/' + CODES[1] + '/">dup</a>')
        cards = page.evaluate(fn("readSearchCards"))
        assert cards[0]["url"].endswith(CODES[3] + "/") and len(cards) == 3, cards
        print("readSearchCards ok:", [c["url"].split("/")[-2][:6] for c in cards])
        show("https://www.instagram.com/explore/search/keyword/?q=x", "<body>nothing</body>")
        assert page.evaluate(fn("readSearchCards")) == []

        # a reel page
        show(f"https://www.instagram.com/reel/{CODES[1]}/", reel_html(CODES[1]))
        info = page.evaluate(fn("readOpenVideo"))
        assert info["opened"] and info["isVideo"] and info["likes"] == "12,345" and info["comments"] == "12", info
        assert info["creator"] == "maker1" and info["caption"] == "Why I cannot stop scrolling #1" and info["markers"] == [], info
        print("readOpenVideo ok:", info["creator"], info["likes"], info["comments"], info["caption"])
        # comments, in Instagram's list markup: replies in a list inside a comment are left out
        got = page.evaluate(fn("readCommentsPage", "50"))
        assert got["ok"] and len(got["rows"]) == 50, len(got["rows"])
        assert got["rows"][0] == {"handle": "fan0", "text": "My screen time is 9 hours a day and the brain rot is real 0"}, got["rows"][0]
        assert not any("must be ignored" in r["text"] for r in got["rows"]), "replies are left out"
        print(f"readCommentsPage (lists) ok: {len(got['rows'])} comments, first = {got['rows'][0]}")
        assert len(page.evaluate(fn("readCommentsPage", "7"))["rows"]) == 7

        # the same reel with no lists at all: avatar and name links, an @mention, times, "Reply" and "View 2 replies" around the text
        show(f"https://www.instagram.com/reel/{CODES[1]}/", reel_html(CODES[1], "divs"))
        page.evaluate(fn("readOpenVideo"))
        got = page.evaluate(fn("readCommentsPage", "50"))
        assert got["ok"] and len(got["rows"]) == 50, len(got["rows"])
        first = got["rows"][0]
        assert first["handle"] == "fan0" and first["text"].startswith("My screen time is 9 hours a day and the brain rot is real 0"), first
        assert all(r["handle"] == f"fan{i}" for i, r in enumerate(got["rows"])), [r["handle"] for r in got["rows"][:5]]
        assert not any(r["text"] in ("Reply", "3d", "12 likes") or r["text"].startswith("View") for r in got["rows"])
        print(f"readCommentsPage (no lists) ok: {len(got['rows'])} comments, first = {first}")

        # shaped like the real page: suggested accounts (profile links with text, no time) must not be read as comments
        show(f"https://www.instagram.com/reel/{CODES[1]}/", reel_html(CODES[1], "real"))
        page.evaluate(fn("readOpenVideo"))
        got = page.evaluate(fn("readCommentsPage", "50"))
        assert got["ok"] and len(got["rows"]) == 50, len(got["rows"])
        assert got["rows"][0] == {"handle": "fan0", "text": "My screen time is 9 hours a day and the brain rot is real 0"}, got["rows"][0]
        assert all(r["handle"] == f"fan{i}" for i, r in enumerate(got["rows"])), [r["handle"] for r in got["rows"][:4]]
        assert not any("suggested" in r["handle"] or r["text"].startswith("View") for r in got["rows"])
        print("readCommentsPage (real-page shape, suggestions ignored) ok")

        # and when the text elements have no dir attribute at all
        show(f"https://www.instagram.com/reel/{CODES[1]}/", reel_html(CODES[1], "plain"))
        page.evaluate(fn("readOpenVideo"))
        got = page.evaluate(fn("readCommentsPage", "50"))
        assert got["ok"] and len(got["rows"]) == 50, len(got["rows"])
        assert got["rows"][0] == {"handle": "fan0", "text": "My screen time is 9 hours a day and the brain rot is real 0"}, got["rows"][0]
        assert all(r["text"] not in ("Reply", "3d") for r in got["rows"])
        print("readCommentsPage (plain text elements) ok")
        show(f"https://www.instagram.com/reel/{CODES[1]}/", reel_html(CODES[1]))
        show(f"https://www.instagram.com/reel/{CODES[2]}/", reel_html(CODES[2]))
        assert page.evaluate(fn("readOpenVideo"))["likes"] == "2.5K"
        show(f"https://www.instagram.com/reel/{CODES[5]}/", reel_html(CODES[5]))
        info = page.evaluate(fn("readOpenVideo"))
        assert info["opened"] and info["likes"] == "" and info["creator"] == "maker5", info
        print("hidden likes read as empty")
        show(f"https://www.instagram.com/p/{CODES[6]}/", reel_html(CODES[6]))
        info = page.evaluate(fn("readOpenVideo"))
        assert info["opened"] and info["isVideo"] is False, info
        print("a photo post is not a video")

        # nothing there: say what the page has
        show("https://www.instagram.com/reel/ZZZZZZZZZZZ/", reel_html("ZZZZZZZZZZZ"))
        info = page.evaluate(fn("readOpenVideo"))
        assert info["opened"] is False and info["markers"][0] == "Page not found" and info["markers"][1] == "/reel/CODE/", info
        print("a missing reel lists what the page has:", info["markers"])
        got = page.evaluate(fn("readCommentsPage"))
        assert got["ok"] is False and got["rows"] == [] and "profile links" in got["diag"] and "lists" in got["diag"], got
        print("no comments: the page is described:", got["diag"])
        b.close()


if __name__ == "__main__":
    sys.exit(main())
