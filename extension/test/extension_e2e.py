"""Loads the real extension in Chromium and runs it end to end, with TikTok and GitHub both mocked.
Run:  .venv/bin/python extension/test/extension_e2e.py      (takes about 2 minutes)"""
import base64
import json
import re
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

from fixtures import search_html

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


def tiktok(route):
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
        ctx.route("https://www.tiktok.com/**", tiktok)

        # 1. no alarms unless "run every hour" is ticked
        time.sleep(1)
        alarms = sorted(a["name"] for a in sw.evaluate("chrome.alarms.getAll()"))
        assert alarms == [], alarms
        print("alarms scheduled:", alarms)

        # 2. popup asks for a token first, and offers one action
        popup = ctx.new_page()
        popup.goto(f"chrome-extension://{ext_id}/popup.html")
        popup.wait_for_function("document.getElementById('state').textContent.length > 0")
        assert "Add your GitHub token" in popup.inner_text("#state"), popup.inner_text("#state")
        assert popup.inner_text("#people") == "Find videos now" and popup.query_selector("#backfill") is None
        print("popup before setup:", popup.inner_text("#state"))

        # 3. settings page: topics, comment topics, and what counts as a good video
        opts = ctx.new_page()
        opts.goto(f"chrome-extension://{ext_id}/options.html")
        assert opts.query_selector("#aiKey") and opts.query_selector("#testAi") and opts.input_value("#aiKey") == ""
        assert opts.input_value("#minComments") == "20" and opts.input_value("#maxAgeDays") == "60" and opts.input_value("#minViews") == "10000"
        topics = opts.input_value("#keywords").split("\n")
        assert topics[:7] == ["microlearning app", "learn while scrolling", "digital wellbeing", "digital wellness", "nervous system", "digital detox", "studytalk"], topics
        assert opts.query_selector("#comp-screenTime") is None, "no competitor lists"
        assert "screen time" in opts.input_value("#commentTopics").split("\n") and "brain rot" in opts.input_value("#commentTopics").split("\n")
        opts.click("#testAi")
        assert "Paste a Claude API key first" in opts.inner_text("#aiMsg"), opts.inner_text("#aiMsg")
        opts.fill("#repo", "not a repo")
        opts.fill("#token", "x")
        opts.click("#save")
        opts.wait_for_function("document.getElementById('msg').textContent.length > 0")
        assert "owner/name" in opts.inner_text("#msg")
        print("settings validation:", opts.inner_text("#msg"))

        # 4. a full run: videos are saved with their link and counts, and the top comments about the topics
        sw.evaluate("api => chrome.storage.local.set({settings: {repo: 'o/r', token: 'good', api, auto: false, videosPerRun: 3, minViews: 0, minComments: 20, maxAgeDays: 60, startHour: 0, endHour: 24, paused: false}})", api)
        popup.reload()
        popup.wait_for_function("!document.getElementById('people').disabled")
        popup.click("#people")
        status = wait_idle(sw, timeout=420)
        assert not status.get("error"), status
        videos = json.loads(FILES["videos_found.json"]["text"])
        assert 1 <= len(videos) <= 3, len(videos)
        assert all(v["url"].startswith("https://www.tiktok.com/@maker") and v["comments"] == 40 and v["topic"] for v in videos), videos
        # the top 50 comments are read; only the even ones (about screen time and brain rot) are kept
        assert all(v["read"] == 50 and len(v["matches"]) == 25 for v in videos), [(v["read"], len(v["matches"])) for v in videos]
        m = videos[0]["matches"][0]
        assert m["handle"] == "fan0" and "screen time" in m["text"] and "screen time" in m["topics"] and "brain rot" in m["topics"], m
        assert not any("nice song" in c["text"] or "ignored" in c["text"] for v in videos for c in v["matches"])
        assert len({v["found"] for v in videos}) == 1
        assert PUTS[0][0] == "videos_found.json" and PUTS[0][1]["branch"] == "data"
        assert "people.json" not in FILES
        print(f"run ok: {len(videos)} videos published, first: {videos[0]['url']}")
        popup.wait_for_function("document.getElementById('state').textContent.includes('Saved')")
        print("popup after run:", popup.inner_text("#state"))

        # 5. running again never lists a video twice, and a video marked complete on the page never comes back
        done = videos[0]["url"]
        FILES["videos_done.json"] = {"sha": "d1", "text": json.dumps([{"url": done, "at": "2026-11-01T00:00:00Z"}])}
        FILES.pop("videos_found.json")
        popup.click("#people")
        wait_idle(sw, timeout=420)
        again = [v["url"] for v in json.loads(FILES["videos_found.json"]["text"])] if "videos_found.json" in FILES else []
        assert done not in again and len(again) == len(set(again)), (done, again)
        print("a video marked complete is not found again:", len(again), "others listed")

        # 5b. with a Claude key, Claude picks the comments instead of the topic list (here: those whose number is a multiple of 4)
        FILES.pop("videos_found.json", None)
        sw.evaluate("api => chrome.storage.local.get('settings').then(({settings}) => chrome.storage.local.set({settings: {...settings, aiKey: 'sk-ant-test', aiApi: api}, rejected: {}}))", api)
        popup.click("#people")
        status = wait_idle(sw, timeout=420)
        assert not status.get("error"), status
        with_ai = json.loads(FILES["videos_found.json"]["text"])
        assert with_ai and CLAUDE_CALLS, (len(with_ai), len(CLAUDE_CALLS))
        assert all(len(v["matches"]) == 13 for v in with_ai), [len(v["matches"]) for v in with_ai]
        assert all("screen time" in c["topics"] for v in with_ai for c in v["matches"]), "topics are worked out here, not paid for"
        assert all(int(c["text"].split()[-1]) % 4 == 0 for v in with_ai for c in v["matches"])
        # only the 25 comments that look related are sent (the 25 about a song are not), in one request per video
        sizes = [len(c["messages"][0]["content"].split("\n")) for c in CLAUDE_CALLS]
        assert len(CLAUDE_CALLS) == len(with_ai) and set(sizes) == {25}, sizes
        print(f"Claude picked the comments: {len(with_ai)} videos, {len(CLAUDE_CALLS)} requests")

        # 5c. Claude failing does not fail the run: the topic list is used instead
        FILES.pop("videos_found.json", None)
        sw.evaluate("chrome.storage.local.get('settings').then(({settings}) => chrome.storage.local.set({settings: {...settings, aiKey: 'wrong'}, rejected: {}}))")
        popup.click("#people")
        status = wait_idle(sw, timeout=420)
        assert not status.get("error") and "Claude was not used" in status.get("message", ""), status
        fallback = json.loads(FILES["videos_found.json"]["text"])
        assert fallback and all(len(v["matches"]) == 25 for v in fallback)
        print("Claude failure falls back to the topics:", status["message"][-80:])

        # 6. a verification check pauses the runs
        ctx.unroute("https://www.tiktok.com/**")
        ctx.route("https://www.tiktok.com/**", lambda r: r.fulfill(status=200, content_type="text/html", body="<body>Please verify to continue</body>"))
        popup.click("#people")
        status = wait_idle(sw)
        assert "verification" in status["error"], status
        print("verification check reported:", status["error"])
        ctx.close()
    server.shutdown()
    print("ALL OK")


if __name__ == "__main__":
    main()
