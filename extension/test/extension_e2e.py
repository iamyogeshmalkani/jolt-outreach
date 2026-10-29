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
FILES, PUTS, AI_CALLS = {}, [], []


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
        """A stand-in for Groq's POST /openai/v1/chat/completions."""
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        AI_CALLS.append((self.path, body))
        if self.headers.get("Authorization") != "Bearer sk-test":
            return self._send(401, {"error": {"message": "invalid api key"}})
        system = next(m["content"] for m in body["messages"] if m["role"] == "system")
        user = next(m["content"] for m in body["messages"] if m["role"] == "user")
        comments = json.loads(user)
        if "screen public TikTok comments" in system:  # the check of which comments are about the writer's own habit
            text = json.dumps(["came back" in c for c in comments])
        else:
            text = json.dumps([f"Groq opener number {i} written for this one" for i in range(len(comments))])
        self._send(200, {"choices": [{"finish_reason": "stop", "message": {"role": "assistant", "content": text, "reasoning": "..."}}]})

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

        # 1. one hourly alarm, for people
        time.sleep(1)
        alarms = sorted(a["name"] for a in sw.evaluate("chrome.alarms.getAll()"))
        assert alarms == ["people"], alarms
        print("alarms scheduled:", alarms)

        # 2. popup asks for a token first, and offers only one action
        popup = ctx.new_page()
        popup.goto(f"chrome-extension://{ext_id}/popup.html")
        popup.wait_for_function("document.getElementById('state').textContent.length > 0")
        assert "Add your GitHub token" in popup.inner_text("#state"), popup.inner_text("#state")
        assert popup.query_selector("#videos") is None and popup.inner_text("#people") == "Find people now"
        print("popup before setup:", popup.inner_text("#state"))

        # 3. settings page: validates input, and offers only the two providers
        opts = ctx.new_page()
        opts.goto(f"chrome-extension://{ext_id}/options.html")
        providers = opts.eval_on_selector_all("#aiProvider option", "els => els.map(e => e.value)")
        assert providers == ["groq", "anthropic"], providers
        opts.fill("#repo", "not a repo")
        opts.fill("#token", "x")
        opts.click("#save")
        opts.wait_for_function("document.getElementById('msg').textContent.length > 0")
        assert "owner/name" in opts.inner_text("#msg")
        print("settings validation:", opts.inner_text("#msg"), "| providers:", providers)

        # 4. a full people run, with opening lines written by (mock) Groq
        sw.evaluate("api => chrome.storage.local.set({settings: {repo: 'o/r', token: 'good', api, aiApi: api, aiProvider: 'groq', aiKey: 'sk-test', aiModel: '', useAi: true, enabled: true, startHour: 0, endHour: 24, skip: '', paused: false}})", api)
        popup.reload()
        popup.wait_for_function("!document.getElementById('people').disabled")
        popup.click("#people")
        status = wait_idle(sw, timeout=420)
        assert not status.get("error"), status
        people = json.loads(FILES["people.json"]["text"])
        assert 1 <= len(people) <= 8, len(people)
        assert all(x["handle"].startswith("fan") and "reply that must be ignored" not in x["comment"] for x in people)
        assert all(x["opener"].startswith("Groq opener number") and x["priority"] in "AB" for x in people), [x["opener"] for x in people][:3]
        assert all(path == "/openai/v1/chat/completions" and call["model"] == "openai/gpt-oss-20b" for path, call in AI_CALLS), AI_CALLS
        opener_calls = [c for _, c in AI_CALLS if "screen public TikTok comments" not in c["messages"][0]["content"]]
        assert len(opener_calls) == 1 and len(AI_CALLS) > 1, "one check per video's comments, then one request for the opening lines"
        assert PUTS[0][0] == "people.json" and PUTS[0][1]["branch"] == "data"
        assert "videos.json" not in FILES
        print(f"people run ok: {len(people)} people published, opening line by Groq: {people[0]['opener']!r}")
        popup.wait_for_function("document.getElementById('state').textContent.includes('Saved')")
        print("popup after run:", popup.inner_text("#state"))

        # 5. running again never saves the same person twice
        popup.click("#people")
        wait_idle(sw, timeout=420)
        handles = [x["handle"] for x in json.loads(FILES["people.json"]["text"])]
        assert len(handles) == len(set(handles)), handles
        print("second run: no duplicate people:", len(handles), "in total")

        # 6. a wrong AI key ends the run with the reason and saves nobody, because no comment could be checked
        sw.evaluate("chrome.storage.local.get('settings').then(r => chrome.storage.local.set({settings: {...r.settings, aiKey: 'wrong'}, seen: {}}))")
        FILES.pop("people.json")
        popup.click("#people")
        status = wait_idle(sw, timeout=420)
        assert "did not accept the API key" in status.get("error", ""), status
        assert "people.json" not in FILES, FILES.keys()
        print("wrong AI key: run stopped with:", status["error"])

        # 7. a verification check pauses the hourly runs
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
