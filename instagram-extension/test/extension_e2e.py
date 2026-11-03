"""Loads the real extension in Chromium and runs it end to end, with Instagram and GitHub both mocked.
Run:  .venv/bin/python instagram-extension/test/extension_e2e.py      (takes a few minutes)"""
import base64
import json
import re
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

from fixtures import CODES, reel_html, search_html

EXT = str(Path(__file__).resolve().parent.parent)
FILES, PUTS, CLAUDE_CALLS = {}, [], []


class FakeGitHub(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj=None):
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "authorization,content-type,accept,x-github-api-version,x-api-key,anthropic-version,anthropic-dangerous-direct-browser-access")
        self.send_header("Access-Control-Allow-Methods", "GET,PUT,POST,OPTIONS")
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        if obj is not None:
            self.wfile.write(json.dumps(obj).encode())

    def do_OPTIONS(self):
        self._send(204)

    def do_GET(self):
        path = self.path.split("?")[0]
        m = re.search(r"/contents/(.+)$", path)
        if m:
            f = FILES.get(m[1])
            return self._send(200, {"sha": f["sha"], "content": base64.b64encode(f["text"].encode()).decode()}) if f else self._send(404, {})
        if path.endswith("/branches/data"):
            return self._send(200, {})
        self._send(200, {"full_name": "o/r", "permissions": {"push": True}})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        assert self.path == "/v1/messages", self.path
        if self.headers["x-api-key"] != "sk-ant-test":
            return self._send(401, {"error": {"message": "invalid x-api-key"}})
        CLAUDE_CALLS.append(body)
        lines = body["messages"][0]["content"].split("\n")  # "number|comment", one per line
        keep = [int(l.split("|", 1)[0]) for l in lines if int(l.rsplit(" ", 1)[1]) % 4 == 0]
        self._send(200, {"stop_reason": "end_turn", "content": [{"type": "text", "text": json.dumps(keep)}]})

    def do_PUT(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        name = re.search(r"/contents/(.+)$", self.path)[1]
        assert self.headers["Authorization"] == "Bearer good", self.headers["Authorization"]
        PUTS.append((name, body))
        FILES[name] = {"sha": f"s{len(PUTS)}", "text": base64.b64decode(body["content"]).decode()}
        self._send(200, {})


SEARCHES = []


def instagram(route):
    url = route.request.url
    m = re.search(r"/(?:reel|p)/([A-Za-z0-9_-]+)", url)
    if m:
        return route.fulfill(status=200, content_type="text/html", body=reel_html(m[1]))
    SEARCHES.append(url)
    if "/explore/search/" in url:
        return route.fulfill(status=200, content_type="text/html", body="<html><body>No results</body></html>")  # forces the hashtag fallback
    route.fulfill(status=200, content_type="text/html", body=search_html())


def wait_idle(sw, timeout=120):
    end = time.time() + timeout
    time.sleep(2)
    while time.time() < end:
        status = sw.evaluate("chrome.storage.local.get('status').then(r => r.status || {})")
        if not status.get("running") and (status.get("lastRun") or status.get("error")):
            return status
        time.sleep(2)
    state = sw.evaluate("chrome.storage.local.get(['status','log'])")
    raise TimeoutError("run did not finish: " + json.dumps(state, indent=1))


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeGitHub)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    api = f"http://127.0.0.1:{server.server_port}"

    with sync_playwright() as p, tempfile.TemporaryDirectory() as profile:
        ctx = p.chromium.launch_persistent_context(
            profile, channel="chromium", headless=True,
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=15000)
        ext_id = sw.url.split("/")[2]
        print("extension loaded:", ext_id)
        ctx.route("https://www.instagram.com/**", instagram)

        # 1. no alarms unless "run every hour" is ticked
        time.sleep(1)
        assert sorted(a["name"] for a in sw.evaluate("chrome.alarms.getAll()")) == []

        # 2. popup asks for a token first
        popup = ctx.new_page()
        popup.goto(f"chrome-extension://{ext_id}/popup.html")
        popup.wait_for_function("document.getElementById('state').textContent.length > 0")
        assert "Add your GitHub token" in popup.inner_text("#state"), popup.inner_text("#state")
        assert popup.inner_text("#run") == "Find reels now"
        print("popup before setup:", popup.inner_text("#state"))

        # 3. settings page
        opts = ctx.new_page()
        opts.goto(f"chrome-extension://{ext_id}/options.html")
        assert opts.input_value("#minLikes") == "1000" and opts.input_value("#maxAgeDays") == "60" and opts.input_value("#videosPerRun") == "40"
        assert "phone addiction" in opts.input_value("#keywords").split("\n")
        assert "screen time" in opts.input_value("#commentTopics").split("\n") and opts.input_value("#aiKey") == ""
        opts.click("#testAi")
        assert "Paste a Claude API key first" in opts.inner_text("#aiMsg"), opts.inner_text("#aiMsg")
        opts.fill("#repo", "not a repo")
        opts.fill("#token", "x")
        opts.click("#save")
        opts.wait_for_function("document.getElementById('msg').textContent.length > 0")
        assert "owner/name" in opts.inner_text("#msg")
        print("settings validation:", opts.inner_text("#msg"))

        # 4. a full run: search finds nothing, the hashtag does; old, unpopular and photo posts are left out
        sw.evaluate("api => chrome.storage.local.set({settings: {repo: 'o/r', token: 'good', api, auto: false, videosPerRun: 40, minLikes: 1000, maxAgeDays: 60, startHour: 0, endHour: 24, paused: false, keywords: ['phone addiction']}})", api)
        popup.reload()
        popup.wait_for_function("!document.getElementById('run').disabled")
        popup.click("#run")
        status = wait_idle(sw, timeout=420)
        assert not status.get("error"), status
        reels = json.loads(FILES["instagram_found.json"]["text"])
        got = sorted(v["url"] for v in reels)
        want = sorted(f"https://www.instagram.com/reel/{CODES[n]}/" for n in (1, 2, 5))
        assert got == want, (got, want)
        by = {v["url"].split("/")[-2]: v for v in reels}
        assert by[CODES[1]]["likes"] == 12345 and by[CODES[1]]["creator"] == "maker1" and by[CODES[1]]["comments"] == 12
        assert by[CODES[2]]["likes"] == 2500 and by[CODES[5]]["likes"] is None
        assert all(v["topic"] == "phone addiction" and v["posted"] for v in reels)
        # the top 50 comments are read; with no Claude key the even ones (about screen time and brain rot) are kept by the topic list
        assert all(v["read"] == 50 and len(v["matches"]) == 25 for v in reels), [(v["read"], len(v["matches"])) for v in reels]
        m = reels[0]["matches"][0]
        assert m["handle"].startswith("fan") and "screen time" in m["text"] and "screen time" in m["topics"], m
        assert not any("nice song" in c["text"] or "ignored" in c["text"] for v in reels for c in v["matches"])
        assert any("/explore/tags/phoneaddiction/" in u for u in SEARCHES), SEARCHES
        assert PUTS[0][0] == "instagram_found.json" and PUTS[0][1]["branch"] == "data"
        assert "videos_found.json" not in FILES
        print(f"run ok: {len(reels)} reels published; searches: {[u.split('instagram.com')[1] for u in SEARCHES]}")
        popup.wait_for_function("document.getElementById('state').textContent.includes('Saved')")
        print("popup after run:", popup.inner_text("#state"))

        # 5. running again lists nothing twice, and a reel marked complete on the page never comes back
        done = reels[0]["url"]
        FILES["instagram_done.json"] = {"sha": "d1", "text": json.dumps([{"url": done, "at": "2026-11-01T00:00:00Z"}])}
        FILES.pop("instagram_found.json")
        popup.click("#run")
        wait_idle(sw, timeout=420)
        again = [v["url"] for v in json.loads(FILES["instagram_found.json"]["text"])] if "instagram_found.json" in FILES else []
        assert done not in again and len(again) == len(set(again)), (done, again)
        print("a reel marked complete is not found again:", len(again), "others listed")

        # 5b. with a Claude key, Claude picks the comments (here: those whose number is a multiple of 4), and only the related ones are sent
        FILES.pop("instagram_found.json", None)
        sw.evaluate("api => chrome.storage.local.get('settings').then(({settings}) => chrome.storage.local.set({settings: {...settings, aiKey: 'sk-ant-test', aiApi: api}, rejected: {}}))", api)
        popup.click("#run")
        status = wait_idle(sw, timeout=420)
        assert not status.get("error"), status
        with_ai = json.loads(FILES["instagram_found.json"]["text"])
        assert with_ai and len(CLAUDE_CALLS) == len(with_ai), (len(with_ai), len(CLAUDE_CALLS))
        assert all(len(v["matches"]) == 13 for v in with_ai), [len(v["matches"]) for v in with_ai]
        sizes = {len(c["messages"][0]["content"].split("\n")) for c in CLAUDE_CALLS}
        assert sizes == {25}, sizes
        print(f"Claude picked the comments: {len(with_ai)} reels, one request each of {sizes} comments")

        # 5c. Claude failing does not fail the run: the topic list is used instead
        FILES.pop("instagram_found.json", None)
        sw.evaluate("chrome.storage.local.get('settings').then(({settings}) => chrome.storage.local.set({settings: {...settings, aiKey: 'wrong'}, rejected: {}}))")
        popup.click("#run")
        status = wait_idle(sw, timeout=420)
        assert not status.get("error") and "Claude was not used" in status.get("message", ""), status
        fallback = json.loads(FILES["instagram_found.json"]["text"])
        assert fallback and all(len(v["matches"]) == 25 for v in fallback)
        print("Claude failure falls back to the topics")

        # 6. a login wall stops the run
        ctx.unroute("https://www.instagram.com/**")
        ctx.route("https://www.instagram.com/**", lambda r: r.fulfill(status=200, content_type="text/html", body="<body><input name='username' type='text'><input name='password' type='password'></body>"))
        popup.click("#run")
        status = wait_idle(sw)
        assert "logged out of Instagram" in status["error"], status
        print("logged out reported:", status["error"])
        ctx.close()
    server.shutdown()
    print("ALL OK")


if __name__ == "__main__":
    main()
