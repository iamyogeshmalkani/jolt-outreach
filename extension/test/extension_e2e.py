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

EXT = str(Path(__file__).resolve().parent.parent)
FILES, PUTS = {}, []


class FakeGitHub(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj=None):
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "authorization,content-type,accept,x-github-api-version")
        self.send_header("Access-Control-Allow-Methods", "GET,PUT,OPTIONS")
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

    def do_PUT(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        name = re.search(r"/contents/(.+)$", self.path)[1]
        assert self.headers["Authorization"] == "Bearer good", self.headers["Authorization"]
        PUTS.append((name, body))
        FILES[name] = {"sha": f"s{len(PUTS)}", "text": base64.b64decode(body["content"]).decode()}
        self._send(200, {})


SEARCH = "<body>" + "".join(f'<a href="https://www.tiktok.com/@maker{i}/video/{i}">v{i}</a>' for i in (1, 2, 3)) + "</body>"
VIDEO = """<body>
<div data-e2e="browse-video-desc">Why I can't stop doomscrolling #dopamine detox</div>
<strong data-e2e="like-count">9K</strong><strong data-e2e="comment-count">40</strong>
<span>Comments (40)</span><div id="panel" style="height:200px;overflow:auto"></div>
<script>(() => {
  const panel = document.getElementById('panel'); let n = 0
  const add = (k) => { for (let i = 0; i < k; i++, n++) { const r = document.createElement('div')
    r.innerHTML = `<a href="/@fan${n}">fan${n}</a><div data-e2e="comment-level-1">Quit again for a couple days but came back to it, my phone wins ${n}</div>`; panel.appendChild(r) } }
  document.querySelector('span').addEventListener('click', () => { if (!n) add(5) })
})()</script></body>"""


def tiktok(route):
    url = route.request.url
    html = SEARCH if "/search/" in url else VIDEO
    route.fulfill(status=200, content_type="text/html", body=html)


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
        sw.evaluate("api => chrome.storage.local.set({settings: {repo: 'o/r', token: 'good', api, enabled: true, startHour: 0, endHour: 24, skip: '', paused: false}})", api)
        popup.reload()
        popup.wait_for_function("!document.getElementById('videos').disabled")
        popup.click("#videos")
        status = wait_idle(sw)
        assert not status.get("error"), status
        videos = json.loads(FILES["videos.json"]["text"])
        assert 1 <= len(videos) <= 2, videos
        assert all(v["draft"] and "jolt" not in v["draft"].lower() and v["comments"] == "40" for v in videos)
        assert PUTS[0][1]["branch"] == "data"
        print(f"videos run ok: {len(videos)} videos published, e.g. {videos[0]['creator']} / {videos[0]['draft']!r}")
        popup.wait_for_function("document.getElementById('state').textContent.includes('Saved')")
        print("popup after run:", popup.inner_text("#state"))

        # 5. running again does not queue the same creators twice
        before = {v["creator"] for v in videos}
        popup.click("#videos")
        wait_idle(sw)
        after = [v["creator"] for v in json.loads(FILES["videos.json"]["text"])]
        assert len(after) == len(set(after)), after
        print("second run: no duplicate creators:", after)

        # 6. a people run
        popup.click("#people")
        status = wait_idle(sw, timeout=420)
        assert not status.get("error"), status
        people = json.loads(FILES["people.json"]["text"])
        assert people and all(x["opener"] and x["priority"] in "AB" for x in people), people
        print(f"people run ok: {len(people)} people published, e.g. @{people[0]['handle']}: {people[0]['opener']}")

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
