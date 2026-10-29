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
        """A stand-in for Anthropic's POST /v1/messages."""
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        CLAUDE_CALLS.append(body)
        if self.headers.get("x-api-key") != "sk-test":
            return self._send(401, {"error": {"message": "invalid x-api-key"}})
        n = len(json.loads(body["messages"][0]["content"]))
        kind = "comment" if "join public TikTok" in body["system"] else "opener"
        text = json.dumps([f"Claude {kind} number {i} written for this one" for i in range(n)])
        self._send(200, {"stop_reason": "end_turn", "content": [{"type": "text", "text": text}]})

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

        # 1. hourly and daily alarms are scheduled
        time.sleep(1)
        alarms = sorted(a["name"] for a in sw.evaluate("chrome.alarms.getAll()"))
        assert alarms == ["people", "videos"], alarms
        print("alarms scheduled:", alarms)

        # 2. popup asks for a token first
        popup = ctx.new_page()
        popup.goto(f"chrome-extension://{ext_id}/popup.html")
        popup.wait_for_function("document.getElementById('state').textContent.length > 0")
        assert "Add your GitHub token" in popup.inner_text("#state"), popup.inner_text("#state")
        print("popup before setup:", popup.inner_text("#state"))

        # 3. settings page validates input
        opts = ctx.new_page()
        opts.goto(f"chrome-extension://{ext_id}/options.html")
        opts.fill("#repo", "not a repo")
        opts.fill("#token", "x")
        opts.click("#save")
        opts.wait_for_function("document.getElementById('msg').textContent.length > 0")
        assert "owner/name" in opts.inner_text("#msg")
        print("settings validation:", opts.inner_text("#msg"))

        # 4. a full videos run
        sw.evaluate("api => chrome.storage.local.set({settings: {repo: 'o/r', token: 'good', api, claudeApi: api, anthropicKey: 'sk-test', useClaude: true, claudeModel: 'claude-haiku-5-5', enabled: true, startHour: 0, endHour: 24, skip: '', paused: False}})".replace("False", "false"), api)
        popup.reload()
        popup.wait_for_function("!document.getElementById('videos').disabled")
        popup.click("#videos")
        status = wait_idle(sw)
        assert not status.get("error"), status
        videos = json.loads(FILES["videos.json"]["text"])
        assert 1 <= len(videos) <= 2, videos
        assert all(v["draft"] and "jolt" not in v["draft"].lower() and v["comments"] == "40" for v in videos)
        assert all(v["creator"] in ("maker1", "maker2") for v in videos), "the off-topic result must not be queued"
        assert all("doomscrolling" in v["caption"] or "dopamine" in v["caption"] for v in videos)
        assert PUTS[0][1]["branch"] == "data"
        assert all(v["draft"].startswith("Claude comment number") for v in videos), [v["draft"] for v in videos]
        assert len(CLAUDE_CALLS) == 1 and CLAUDE_CALLS[0]["model"] == "claude-haiku-5-5", CLAUDE_CALLS
        assert sorted(json.loads(CLAUDE_CALLS[0]["messages"][0]["content"])) == sorted(v["caption"] for v in videos)
        print(f"videos run ok: {len(videos)} videos published, drafted by Claude: {videos[0]['draft']!r}")
        popup.wait_for_function("document.getElementById('state').textContent.includes('Saved')")
        print("popup after run:", popup.inner_text("#state"))

        # 5. running again does not queue the same creators twice
        popup.click("#videos")
        wait_idle(sw)
        after = [v["creator"] for v in json.loads(FILES["videos.json"]["text"])]
        assert len(after) == len(set(after)) and set(after) <= {"maker1", "maker2"}, after
        print("second run: no duplicate creators:", after)

        # 6. a people run
        popup.click("#people")
        status = wait_idle(sw, timeout=420)
        assert not status.get("error"), status
        people = json.loads(FILES["people.json"]["text"])
        assert people and all(x["opener"] and x["priority"] in "AB" for x in people), people
        assert all(x["handle"].startswith("fan") and "reply that must be ignored" not in x["comment"] for x in people)
        assert all(x["opener"].startswith("Claude opener number") for x in people), [x["opener"] for x in people][:3]
        print(f"people run ok: {len(people)} people published, opening line by Claude: {people[0]['opener']!r}")

        # 6b. a wrong Claude key never breaks a run: the built-in drafts are used and the reason is logged
        sw.evaluate("chrome.storage.local.get('settings').then(r => chrome.storage.local.set({settings: {...r.settings, anthropicKey: 'wrong'}, seen: {}}))")
        FILES.pop("videos.json")
        popup.click("#videos")
        status = wait_idle(sw)
        assert not status.get("error"), status
        fallback = json.loads(FILES["videos.json"]["text"])
        assert fallback and all(not v["draft"].startswith("Claude") and len(v["draft"]) > 10 for v in fallback), fallback
        log = sw.evaluate("chrome.storage.local.get('log').then(r => r.log.join('\\n'))")
        assert "did not accept the API key" in log, log[-400:]
        print("wrong Claude key: run still saved", len(fallback), "videos with the built-in drafts")

        # 7. a verification check pauses the hourly runs
        ctx.unroute("https://www.tiktok.com/**")
        ctx.route("https://www.tiktok.com/**", lambda r: r.fulfill(status=200, content_type="text/html", body="<body>Please verify to continue</body>"))
        popup.click("#videos")
        status = wait_idle(sw)
        assert "verification" in status["error"], status
        print("verification check reported:", status["error"])
        ctx.close()
    server.shutdown()
    print("ALL OK")


if __name__ == "__main__":
    main()
