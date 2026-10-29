"""Two Chrome profiles act as two devices that share one (mock) private GitHub repo, with Reddit and Groq mocked.
Run:  ../../.venv/bin/python e2e_sync.py"""
import base64
import json
import re
import tempfile
import threading
import time
from http.server import ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

from e2e import EXT, GROK_CALLS, Fake, until, wait_idle

GH = {"text": None, "sha": None, "puts": 0}


class Everything(Fake):
    """The Reddit and Groq mocks, plus GitHub's contents API for a private repo and a public one."""

    def do_GET(self):
        path = self.path.split("?")[0]
        if not path.startswith("/repos/"):
            return super().do_GET()
        if self.headers.get("Authorization") != "Bearer good":
            return self._send(401, {})
        if path == "/repos/o/private-data":
            return self._send(200, {"full_name": "o/private-data", "private": True, "permissions": {"push": True}})
        if path == "/repos/o/public-data":
            return self._send(200, {"full_name": "o/public-data", "private": False, "permissions": {"push": True}})
        if path == "/repos/o/private-data/contents/reddit-state.json":
            if GH["text"] is None:
                return self._send(404, {})
            return self._send(200, {"sha": GH["sha"], "content": base64.b64encode(GH["text"].encode()).decode()})
        self._send(404, {})

    def do_PUT(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.headers.get("Authorization") != "Bearer good":
            return self._send(401, {})
        if GH["text"] is not None and body.get("sha") != GH["sha"]:
            return self._send(409, {})
        GH["text"] = base64.b64decode(body["content"]).decode()
        GH["puts"] += 1
        GH["sha"] = f"sha{GH['puts']}"
        self._send(200, {})


def remote():
    return json.loads(GH["text"])


def items_of(sw):
    return {i["id"]: i for i in sw.evaluate("chrome.storage.local.get('items').then(r => r.items || [])")}


def device(pw, base, profile, **settings):
    ctx = pw.chromium.launch_persistent_context(profile, channel="chromium", headless=True,
                                                args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=15000)
    base_settings = {"redditBase": base, "aiApi": base, "syncRepo": "o/private-data", "syncToken": "good", "syncApi": base, "provider": "groq"}
    sw.evaluate("s => chrome.storage.local.set({settings: s})", {**base_settings, **settings})
    return ctx, sw, f"chrome-extension://{sw.url.split('/')[2]}"


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Everything)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"

    with sync_playwright() as pw, tempfile.TemporaryDirectory() as pa, tempfile.TemporaryDirectory() as pb:
        # Device A knows the subreddits and has a Groq key. Device B starts with neither, and has its own key.
        ctxA, swA, urlA = device(pw, base, pa, subs="nosurf, digitalminimalism", aiKey="gsk_test", settingsAt=100)
        ctxB, swB, urlB = device(pw, base, pb, aiKey="gsk_ONLY_ON_DEVICE_B", settingsAt=0)
        print("two devices loaded")

        # 1. device A finds posts; they are shared as part of the run
        popupA = ctxA.new_page()
        popupA.goto(f"{urlA}/popup.html")
        until(popupA, "!document.getElementById('run').disabled")
        popupA.click("#run")
        status = wait_idle(swA)
        assert not status.get("error"), status
        itemsA = items_of(swA)
        assert sorted(itemsA) == ["d1", "g1", "g2"]
        assert GH["text"] and sorted(i["id"] for i in remote()["items"]) == ["d1", "g1", "g2"], "the run shared its posts"
        assert remote()["settings"]["subs"] == "nosurf, digitalminimalism"
        for secret in ("gsk_test", "gsk_ONLY_ON_DEVICE_B", '"good"'):
            assert secret not in GH["text"], f"{secret} must never be uploaded"
        print("A ran and shared", sorted(itemsA), "| no keys or tokens in the shared file")

        # 2. device B opens its dashboard and sees A's posts without running anything
        dashB = ctxB.new_page()
        dashB.goto(f"{urlB}/dashboard.html")
        until(dashB, "document.querySelectorAll('.row').length === 3", 20)
        settingsB = swB.evaluate("chrome.storage.local.get('settings').then(r => r.settings)")
        assert settingsB["subs"] == "nosurf, digitalminimalism", "settings arrive too"
        assert settingsB["aiKey"] == "gsk_ONLY_ON_DEVICE_B", "B keeps its own key"
        print("B sees A's 3 posts and settings; keeps its own key")

        # 3. both devices change the same post at the same time: different parts
        dashA = ctxA.new_page()
        dashA.goto(f"{urlA}/dashboard.html")
        dashA.wait_for_selector(".row")
        dashA.locator(".row", has_text="Post g1").click()
        dashB.locator(".row", has_text="Post g1").click()
        dashA.click('button[data-p="alice"][data-set="Sent"]')   # A: the message to the top commenter
        dashB.click("text=Mark as posted")                       # B: the reply to the post, before B has heard from A
        dashB.click('button[data-p="helper"][data-set="Skip"]')  # B: skips the suggestion-giver on the same post
        time.sleep(7)                         # each syncs a moment after its change
        dashA.click("#sync")
        dashB.click("#sync")
        time.sleep(3)
        def check(g1, where):
            who = {p["author"]: p["dmStatus"] for p in g1["people"]}
            assert who == {"alice": "Sent", "helper": "Skip", "opiner": "To send"} and g1["commentStatus"] == "Posted", (where, who, g1["commentStatus"])
        for name, sw in (("A", swA), ("B", swB)):
            check(items_of(sw)["g1"], name)
        check({i["id"]: i for i in remote()["items"]}["g1"], "GitHub")
        print("simultaneous changes to one post (two people and the reply): all survive on A, B and GitHub")

        # 4. B runs the finder: it already knows what A found, so nothing is found twice
        before = len(GROK_CALLS)
        popupB = ctxB.new_page()
        popupB.goto(f"{urlB}/popup.html")
        until(popupB, "!document.getElementById('run').disabled")
        popupB.click("#run")
        status = wait_idle(swB)
        assert not status.get("error"), status
        assert len(items_of(swB)) == 3 and len(GROK_CALLS) == before, "nothing new was found or drafted on B"
        print("B's run found nothing new: it knew what A had already found")

        # 5. a public repo is refused
        stB = ctxB.new_page()
        stB.goto(f"{urlB}/settings.html")
        stB.fill("#syncRepo", "o/public-data")
        stB.click("#testSync")
        until(stB, "document.getElementById('syncMsg').textContent.includes('public repo')")
        print("public repo refused:", stB.inner_text("#syncMsg"))
        stB.fill("#syncRepo", "o/private-data")
        stB.click("#testSync")
        until(stB, "document.getElementById('syncMsg').textContent.includes('Sync works')")
        assert "(private)" in stB.inner_text("#syncMsg")
        print("private repo accepted:", stB.inner_text("#syncMsg"))

        # 6. a settings change on A reaches B, and not the other way round by accident
        stA = ctxA.new_page()
        stA.goto(f"{urlA}/settings.html")
        stA.fill("#name", "Yogesh")
        stA.click("#save")
        until(stA, "document.getElementById('msg').textContent.includes('Saved')")
        time.sleep(1.5)
        dashB.bring_to_front()
        dashB.click("#sync")
        time.sleep(2)
        assert swB.evaluate("chrome.storage.local.get('settings').then(r => r.settings.name)") == "Yogesh"
        assert swB.evaluate("chrome.storage.local.get('settings').then(r => r.settings.aiKey)") == "gsk_ONLY_ON_DEVICE_B"
        print("a settings change on A reached B; B's own key untouched")

        # 7. a bad token is reported, and nothing is lost locally
        swA.evaluate("chrome.storage.local.get('settings').then(r => chrome.storage.local.set({settings: {...r.settings, syncToken: 'wrong'}}))")
        dashA.reload()
        dashA.wait_for_selector(".row")
        until(dashA, "document.getElementById('syncstate').textContent.includes('Sync failed')", 15)
        assert dashA.locator(".row").count() >= 2
        print("bad token reported:", dashA.inner_text("#syncstate"))
        ctxA.close()
        ctxB.close()
    server.shutdown()
    print("ALL OK")


if __name__ == "__main__":
    main()
