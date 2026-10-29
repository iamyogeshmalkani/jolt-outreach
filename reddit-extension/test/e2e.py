"""Loads the real extension in Chromium and runs it end to end, with Reddit and Grok both mocked.
Run:  ../../.venv/bin/python e2e.py      (needs `python -m playwright install chromium` once)"""
import json
import re
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

EXT = str(Path(__file__).resolve().parent.parent)
MODE = {"blocked": False}
GROK_CALLS = []


def p(id, sub, **over):
    d = {"id": id, "subreddit": sub, "title": f"Post {id} about cutting my phone time", "selftext": "Here is what I tried so far.",
         "author": "op_user", "score": 300, "num_comments": 40, "permalink": f"/r/{sub}/comments/{id}/post_{id}/",
         "over_18": False, "stickied": False, "locked": False, "archived": False, "removed_by_category": None}
    d.update(over)
    return {"kind": "t3", "data": d}


def c(author, body, score=50, **over):
    d = {"id": "c_" + author, "author": author, "body": body, "score": score, "permalink": f"/r/x/comments/y/z/c_{author}/",
         "distinguished": None, "stickied": False, "depth": 0, "replies": ""}
    d.update(over)
    return {"kind": "t1", "data": d}


def listing(children):
    return {"kind": "Listing", "data": {"after": None, "children": children}}


TOP = {
    "nosurf": [p("s1", "nosurf", stickied=True), p("n1", "nosurf", over_18=True), p("g1", "nosurf"), p("g2", "nosurf")],
    "digitalminimalism": [p("d1", "digitalminimalism")],
}
COMMENTS = {
    "g1": [c("AutoModerator", "Please read the rules before you post in this community, thanks."), c("op_user", "Thank you all so much for the replies and the advice."),
           c("alice", "Grayscale plus a charger outside the bedroom changed my evenings completely.", 120)],
    "g2": [c("bob", "Logging out of everything every night adds just enough friction to matter.", 80)],
    "d1": [c("carol", "I deleted the feed apps and kept only messaging, and it helped a lot.", 60)],
}
RULES = {"nosurf": {"rules": [{"short_name": "No self-promotion", "description": "No ads or surveys", "priority": 0}, {"short_name": "Be kind", "description": "", "priority": 1}]}}
GOOD_REPLY = "That balance between wanting to stay informed and wanting your attention back is a hard one. What would a good day on your phone look like?"


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj=None, ctype="application/json"):
        self.send_response(code)
        origin = self.headers.get("Origin")
        if origin:  # credentialed requests need the exact origin, not *
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Access-Control-Allow-Headers", "authorization,content-type,accept")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Content-Type", ctype)
        self.end_headers()
        if obj is not None:
            self.wfile.write((obj if isinstance(obj, str) else json.dumps(obj)).encode())

    def do_OPTIONS(self):
        self._send(204)

    def do_GET(self):
        path = urlparse(self.path).path
        if MODE["blocked"]:
            return self._send(403, "You've been blocked by network security.", "text/html")
        m = re.match(r"/r/([^/]+)/top\.json", path)
        if m:
            if m[1] == "privatesub":
                return self._send(403, {"reason": "private", "message": "Forbidden", "error": 403})
            return self._send(200, listing(TOP.get(m[1], [])))
        m = re.match(r"/comments/([^/.]+)\.json", path)
        if m:
            return self._send(200, [listing([]), listing(COMMENTS.get(m[1], []) + [{"kind": "more", "data": {"count": 9}}])])
        m = re.match(r"/r/([^/]+)/about/rules\.json", path)
        if m:
            return self._send(200, RULES.get(m[1], {"rules": []}))
        m = re.match(r"/r/([^/]+)/about\.json", path)
        if m:
            return self._send(200, {"kind": "t5", "data": {"display_name": m[1], "subscribers": 1234567}})
        self._send(404, {})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        GROK_CALLS.append(body)
        if self.headers.get("Authorization") != "Bearer sk-test":
            return self._send(401, {"error": {"message": "invalid api key"}})
        system = next(m["content"] for m in body["input"] if m["role"] == "system")
        if system.startswith("Reply with the single word OK"):  # the settings page's tiny check
            return self._send(200, {"status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": "OK"}]}]})
        n = len(json.loads(next(m["content"] for m in body["input"] if m["role"] == "user")))
        text = json.dumps([GOOD_REPLY if "write replies to Reddit posts" in system else f"Your point about quitting scrolling really landed ({i})." for i in range(n)])
        self._send(200, {"status": "completed", "output": [{"type": "reasoning", "summary": []}, {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": text}]}]})


def until(page, expression, timeout=20):
    """Waits for a page expression to become true. (Playwright's own wait_for_function is blocked by extension pages' security policy.)"""
    end = time.time() + timeout
    while time.time() < end:
        if page.evaluate(expression):
            return
        time.sleep(0.2)
    raise TimeoutError(expression)


def wait_idle(sw, timeout=120):
    end = time.time() + timeout
    time.sleep(1.5)
    while time.time() < end:
        s = sw.evaluate("chrome.storage.local.get('status').then(r => r.status || {})")
        if not s.get("running") and (s.get("lastRun") or s.get("error")):
            return s
        time.sleep(1)
    raise TimeoutError(json.dumps(sw.evaluate("chrome.storage.local.get(['status','log'])"), indent=1))


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"

    with sync_playwright() as pw, tempfile.TemporaryDirectory() as profile:
        ctx = pw.chromium.launch_persistent_context(profile, channel="chromium", headless=True,
                                                    args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=15000)
        ext_id = sw.url.split("/")[2]
        url = lambda page: f"chrome-extension://{ext_id}/{page}"
        print("extension loaded:", ext_id)

        # 1. the popup asks for subreddits first
        popup = ctx.new_page()
        popup.goto(url("popup.html"))
        until(popup, "document.getElementById('state').textContent.length > 0")
        assert "Add the subreddits" in popup.inner_text("#state")
        print("popup before setup:", popup.inner_text("#state"))

        # 2. settings: save subreddits through the page, then point the test at the mocks
        st = ctx.new_page()
        st.goto(url("settings.html"))
        st.fill("#subs", "nosurf, r/privatesub /r/digitalminimalism")
        st.click("#save")
        until(st, "document.getElementById('msg').textContent.includes('Saved')")
        assert "3 subreddits" in st.inner_text("#msg"), st.inner_text("#msg")
        sw.evaluate("base => chrome.storage.local.get('settings').then(r => chrome.storage.local.set({settings: {...r.settings, redditBase: base, aiApi: base, xaiKey: 'sk-test'}}))", base)
        st.reload()
        st.click("#testReddit")
        until(st, "document.getElementById('redditMsg').textContent.includes('works')")
        assert "1,234,567" in st.inner_text("#redditMsg")
        st.click("#testGrok")
        until(st, "document.getElementById('grokMsg').textContent.includes('working')")
        print("settings:", st.inner_text("#msg"), "|", st.inner_text("#redditMsg"), "|", st.inner_text("#grokMsg"))

        # 3. a full run
        popup.reload()
        until(popup, "!document.getElementById('run').disabled")
        popup.click("#run")
        status = wait_idle(sw)
        assert not status.get("error"), status
        items = sw.evaluate("chrome.storage.local.get('items').then(r => r.items)")
        by_id = {i["id"]: i for i in items}
        assert sorted(by_id) == ["d1", "g1", "g2"], (sorted(by_id), sw.evaluate("chrome.storage.local.get(['status','log','settings'])"))  # pinned, adult and private-subreddit posts are skipped
        assert by_id["g1"]["top"]["author"] == "alice" and by_id["g2"]["top"]["author"] == "bob" and by_id["d1"]["top"]["author"] == "carol"
        assert by_id["g1"]["flags"] == ["No self-promotion"] and by_id["d1"]["flags"] == []
        assert all(i["comment"] == GOOD_REPLY for i in items)
        assert all(i["opener"].startswith("Your point about quitting scrolling") for i in items), [i["opener"] for i in items]
        log = sw.evaluate("chrome.storage.local.get('log').then(r => r.log.join('\\n'))")
        assert "r/privatesub: private or restricted, skipped" in log and "Grok wrote 3 replies and 3 opening lines" in log, log
        print("run ok:", sorted(by_id), "| top commenters:", [by_id[k]["top"]["author"] for k in ("g1", "g2", "d1")])

        # 4. the dashboard
        dash = ctx.new_page()
        dash.goto(url("dashboard.html"))
        dash.wait_for_selector(".row")
        assert dash.locator(".row").count() == 3
        dash.locator(".row", has_text="Post g1").click()
        assert "No self-promotion" in dash.inner_text(".warn"), "the rules warning shows"
        dm = dash.input_value('[data-edit="dm"]')
        assert dm.startswith("Your point about quitting scrolling") and "I'm Isha from Jolt" in dm and "a year of Jolt Premium" in dm, dm
        href = dash.get_attribute("a.button.primary", "href")
        assert href.startswith("https://www.reddit.com/message/compose/?to=alice&subject=") and "message=" in href, href
        assert "r%2Fnosurf" in href
        assert dash.input_value('[data-edit="comment"]') == GOOD_REPLY
        dash.set_viewport_size({"width": 1300, "height": 1100})
        dash.screenshot(path="/tmp/reddit_dash.png")
        print("dashboard detail ok. message link:", href[:90] + "…")

        # 5. working through it: edit, mark the reply posted (the post stays in To do), mark the message sent (now it moves on)
        dash.fill('[data-edit="dm"]', "My own edited message to Alice.")
        time.sleep(0.8)
        dash.click("text=Mark as posted")
        time.sleep(0.4)
        assert dash.locator(".row").count() == 3, "a post stays in To do until the message is dealt with too"
        dash.click("text=Mark as sent")
        time.sleep(0.5)
        saved = {i["id"]: i for i in sw.evaluate("chrome.storage.local.get('items').then(r => r.items)")}
        assert saved["g1"]["dmStatus"] == "Sent" and saved["g1"]["commentStatus"] == "Posted" and saved["g1"]["dmEdit"] == "My own edited message to Alice."
        assert dash.locator(".row").count() == 2, "now it moves out of To do"
        dash.reload()
        dash.wait_for_selector(".row")
        assert dash.locator(".row").count() == 2
        chips = dash.inner_text("#chips").replace("\n", " ")
        assert "To do 2" in chips and "Sent 1" in chips, chips
        dash.locator("#chips button", has_text="Sent").click()
        dash.locator(".row").first.click()
        assert dash.input_value('[data-edit="dm"]') == "My own edited message to Alice."
        print("statuses and edits persist across a reload:", chips)

        # 6. a second run does not repeat posts or people
        popup.click("#run")
        wait_idle(sw)
        again = sw.evaluate("chrome.storage.local.get('items').then(r => r.items)")
        assert sorted(i["id"] for i in again) == ["d1", "g1", "g2"], "nothing new to add"
        assert len(again) == 3
        print("second run: nothing repeated")

        # 7. Reddit blocking the request is reported clearly and nothing is lost
        MODE["blocked"] = True
        sw.evaluate("chrome.storage.local.get('settings').then(r => chrome.storage.local.set({settings: {...r.settings, subs: 'newsub'}}))")
        popup.click("#run")
        status = wait_idle(sw)
        assert "blocked the request" in status["error"] and "logged into Reddit" in status["error"], status
        assert len(sw.evaluate("chrome.storage.local.get('items').then(r => r.items)")) == 3
        print("blocked by Reddit reported:", status["error"])
        ctx.close()
    server.shutdown()
    print("ALL OK")


if __name__ == "__main__":
    main()
