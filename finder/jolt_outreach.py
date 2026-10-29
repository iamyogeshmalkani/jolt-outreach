#!/usr/bin/env python3
"""
Jolt TikTok outreach finder
===========================
Finds TikTok commenters who describe their own screen-time struggle, writes a
personal opening line for each, and builds a local page (outreach.html) with
copy buttons and status tracking. It only READS TikTok. You send every DM.

Setup (once)
    pip install playwright
    python jolt_outreach.py --login      # opens Chrome, log into TikTok, press Enter

Each day
    python jolt_outreach.py              # finds ~20 new people, rebuilds outreach.html
    python jolt_outreach.py --videos     # finds ~8 videos worth a comment, rebuilds videos.html

Optional: better opening lines for about a cent a run
    pip install anthropic
    set ANTHROPIC_API_KEY=...            # (export on Mac/Linux)
Without a key, opening lines come from built-in templates. No tokens are used.

Schedule it
    Windows: Task Scheduler -> run `python jolt_outreach.py` daily.
    Mac/Linux: cron, e.g.  36 8 * * *  python3 /path/jolt_outreach.py
    Chrome opens visibly during the run. Leave the computer on.

Safety
    The script never follows, likes, comments, saves or messages anyone. The only
    thing it clicks is the "Comments" tab. It stops if TikTok asks you to log in
    or solve a captcha. Keep volume low (the defaults are).

Commenting (--videos)
    The script only FINDS videos and DRAFTS a comment for each. A person reads the
    draft, edits it so it sounds like them, and posts it by hand, a few a day, spread
    out. Drafts never mention Jolt or contain a link: the profile bio does that job.
    Drafts are questions or observations and never claim an experience you didn't have.
"""
import argparse
import html
import json
import os
import random
import re
import sys
import time
from datetime import date
from pathlib import Path

# ----------------------------- settings you can edit -----------------------------
NAME = "Isha"
OFFER = "a year of Jolt Premium + a $3 gift card"
BODY = ("I'm {NAME} from Jolt. We help people get control of their screen time, and before we "
        "decide what to build next, I'm talking to people about their real phone habits. "
        "Up for a 20-min chat? As a thanks, you'd get {OFFER}.")
TARGET_NEW = 20          # stop once this many new people are found
MAX_VIDEOS = 8           # videos opened per run
QUERIES_PER_RUN = 4      # searches per run, rotated daily
VIDEO_TARGET = 8         # videos to queue for commenting per run
VIDEO_SCAN = 15          # videos opened per run to find them
MIN_COMMENTS = 2         # skip videos with fewer comments than this
OUT_DIR = Path(os.environ.get("JOLT_OUT_DIR") or Path.home() / "jolt_outreach")
VIDEO_QUERIES = [
    "i cant stop doomscrolling", "doomscrolling", "phone addiction", "dopamine detox",
    "digital detox", "screen time reveal", "how to stop scrolling", "brain rot scrolling",
    "my screen time is embarrassing", "digital minimalism", "attention span phone",
]
QUERIES = [
    "opal app review", "one sec app", "brick phone blocker review", "screenzen app",
    "forest app focus", "freedom app blocker", "clearspace app", "jomo app",
    "headway app review", "blinkist review", "deepstash app", "imprint app learning",
    "brilliant app review", "i cant stop doomscrolling", "my screen time is embarrassing",
    "phone addiction", "dopamine detox", "brain rot scrolling", "how to stop scrolling",
    "screen time reveal",
]
SEEN_SEED = []   # handles to skip are read from seen_seed.txt in the output folder (see README)

# ----------------------------------- filtering -----------------------------------
FIRST_PERSON = re.compile(r"\b(i|i'm|im|i’m|i've|ive|my|me|myself)\b", re.I)
SELF_ACTION = re.compile(r"\b(quit|came back|relapsed?|deleted|downloaded|tried)\b", re.I)
STRUGGLE = re.compile(
    r"scroll|phone|screen ?time|addict|hooked|doom|hours|hrs|can'?t stop|cant stop|can’t stop|"
    r"quit|delete|focus|attention|brain|bored|habit|distract|zombie|cooked|tried|worked|"
    r"limit|ignore|relapse|came back|how (do|can) (i|you)", re.I)
MINOR = re.compile(
    r"high ?school|middle ?school|\bgrade \d+|\d+(st|nd|rd|th) grade|freshman|sophomore|"
    r"my (mom|mum|dad|parents)|i'?m (1[0-7])\b|\b1[0-7] ?(yo|y/o|years? old)|homework|teacher", re.I)
SENSITIVE = re.compile(
    r"suicid|kill myself|self.?harm|cutting|anorex|bulimi|eating disorder|overdose|medicat|\bmeds\b|"
    r"therap|trauma|abus|depress|anxiety|panic|ptsd|bipolar|numb myself|\bcope\b|coping", re.I)
SEXUAL = re.compile(r"\b(sex|nsfw|onlyfans|nude|horny)\b", re.I)
BRAND_HANDLE = re.compile(r"(app|official|\.io|promo|deals|steals|coupon|bot|shop|store|ugc|agency)", re.I)
PROMO = re.compile(
    r"https?://|www\.|use my code|referral|promo|(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])\b[A-Z0-9]{6,9}\b")
PRIORITY_A = re.compile(
    r"stopped working|didn'?t work|only worked|worked for|came back|relapse|tried|opal|one ?sec|"
    r"brick|screenzen|freedom|forest|clearspace|jomo|headway|blinkist|ignore|bypass|5 more minutes|"
    r"can'?t figure|don'?t know how|how (do|can) (i|you)|\d+ ?(hrs|hours)", re.I)
STUDY = re.compile(r"\b(study|studying|exam|exams|class|classes|school)\b", re.I)
TOPIC = re.compile(
    r"scroll|screen ?time|phone addict|doom|dopamine|detox|brain ?rot|digital minimal|"
    r"phone habit|attention span|put (my|the|your) phone down", re.I)
BAD_COMMENT = re.compile(r"jolt|https?://|www\.|\bapp\b|download|dm me|link in|promo|code", re.I)

# Drafted comments are questions or observations. They never claim a personal experience
# and never mention an app, so they read as a real viewer joining the conversation.
COMMENT_STARTERS = [
    (re.compile(r"doom", re.I), [
        "What's the hardest part for you: starting to scroll, or stopping once you've started?",
        "Do you think doomscrolling is more about boredom or about avoiding something? Genuinely curious.",
        "The 'just one more' feeling is the part that gets me thinking. What actually breaks it for people?",
    ]),
    (re.compile(r"dopamine|detox", re.I), [
        "Curious how long it took before this started to feel easier, and what made you stick with it?",
        "Do you think the hard part is the detox itself or what you do with the free time afterwards?",
        "What did you replace the scrolling with? That seems like the part most people skip.",
    ]),
    (re.compile(r"screen ?time", re.I), [
        "Do you think the number matters, or what the time is being spent on?",
        "Has seeing the number ever actually changed what you do, or does it fade after a day?",
        "What would make a screen time limit something you'd actually respect instead of ignore?",
    ]),
    (re.compile(r"brain ?rot|attention", re.I), [
        "Do you notice it more in how long you can focus, or in how quickly you get bored?",
        "Is it the short videos themselves or the habit of reaching for the phone that feels worse?",
    ]),
]
COMMENT_DEFAULT = [
    "This is the part people don't talk about enough. What's helped you most so far?",
    "Curious what you think is the hardest part of changing this habit.",
]

OPENERS = [
    (re.compile(r"can'?t stop|cant stop|can’t stop|cannot stop", re.I),
     "Saw your comment about not being able to stop scrolling."),
    (re.compile(r"how (do|can) (i|you)", re.I),
     "Saw you asking how to actually break the scrolling habit."),
    (re.compile(r"stopped working|didn'?t work|only worked|worked for|tried", re.I),
     "Saw your comment about trying to fix this and it not sticking."),
    (re.compile(r"quit|delet", re.I),
     "Saw your comment about quitting or cutting back. How's that going?"),
    (re.compile(r"bored", re.I),
     "Your comment about boredom and scrolling really stuck with me."),
    (re.compile(r"focus|distract|study", re.I),
     "Saw your comment about phone time getting in the way of focus."),
    (re.compile(r"\d+ ?(hrs|hours)|hours", re.I),
     "Saw your comment about how many hours you spend on your phone."),
]


def is_candidate(handle, text, creator):
    t = (text or "").strip()
    if not handle or handle.lower() == (creator or "").lower():
        return False
    if not 20 <= len(t) <= 280:
        return False
    if BRAND_HANDLE.search(handle) or PROMO.search(t):
        return False
    if MINOR.search(t) or SENSITIVE.search(t) or SEXUAL.search(t):
        return False
    return bool(STRUGGLE.search(t) and (FIRST_PERSON.search(t) or SELF_ACTION.search(t)
                                        or re.search(r"how (do|can) (i|you)", t, re.I)))


def priority(text):
    return "A" if PRIORITY_A.search(text) else "B"


def opener(text):
    for rx, line in OPENERS:
        if rx.search(text):
            return line
    snippet = text.strip().replace("\n", " ")
    if len(snippet) > 70:
        snippet = snippet[:70].rsplit(" ", 1)[0] + "…"
    return f"Saw your comment: “{snippet}”"


def haiku_list(instruction, texts):
    """Optional: one cheap Haiku call writes one string per input text. None if unavailable."""
    if not os.environ.get("ANTHROPIC_API_KEY") or not texts:
        return None
    try:
        import anthropic
        client = anthropic.Anthropic()
        prompt = (instruction + " Return only a JSON array of strings, same length and order.\n\n"
                  + json.dumps(texts, ensure_ascii=False))
        msg = client.messages.create(model="claude-haiku-5-5", max_tokens=3000,
                                     messages=[{"role": "user", "content": prompt}])
        raw = msg.content[0].text
        arr = json.loads(raw[raw.index("["): raw.rindex("]") + 1])
        return arr if len(arr) == len(texts) and all(isinstance(x, str) for x in arr) else None
    except Exception as e:  # noqa: BLE001
        print("  (LLM unavailable, using templates:", e, ")")
        return None


def llm_openers(texts):
    return haiku_list(
        "For each TikTok comment below, write ONE warm, casual sentence (max 22 words) that "
        "refers to exactly what the person said, to open a friendly DM from a researcher. "
        "No pitch, no link, no emoji, do not start with 'Hey'.", texts)


def llm_comments(captions):
    return haiku_list(
        "For each TikTok video caption below, write a short public comment (max 30 words) from "
        "a curious viewer. It must respond to what the caption says and add one thought or ask "
        "one genuine question. Do not mention any app, brand or product, no links, no emoji, no "
        "hashtags, no generic praise, and do not claim any personal experience or result.", captions)


def parse_count(s):
    m = re.match(r"([\d.,]+)\s*([KMB]?)", (s or "").strip(), re.I)
    if not m:
        return 0
    try:
        n = float(m.group(1).replace(",", ""))
    except ValueError:
        return 0
    return int(n * {"": 1, "K": 1e3, "M": 1e6, "B": 1e9}[m.group(2).upper()])


def is_video_candidate(caption, comments):
    c = (caption or "").strip()
    if comments < MIN_COMMENTS or not TOPIC.search(c):
        return False
    return not (SENSITIVE.search(c) or SEXUAL.search(c) or MINOR.search(c))


def template_comment(caption):
    for rx, lines in COMMENT_STARTERS:
        if rx.search(caption):
            return random.choice(lines)
    return random.choice(COMMENT_DEFAULT)


def comment_ok(c):
    return isinstance(c, str) and 10 <= len(c.strip()) <= 220 and not BAD_COMMENT.search(c)


# ------------------------------------ state ------------------------------------
def load(path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return default


def save(path, data):
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


# ----------------------------------- browsing -----------------------------------
EXTRACT_JS = r"""async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const panel = [...document.querySelectorAll('div')].find(
    d => d.scrollHeight > d.clientHeight + 50 && d.querySelector('[data-e2e="comment-level-1"]'));
  for (let i = 0; i < 12; i++) { if (panel) panel.scrollTop = panel.scrollHeight; await sleep(1100); }
  return [...document.querySelectorAll('[data-e2e="comment-level-1"]')].map(el => {
    let c = el;
    for (let i = 0; i < 5 && c && !c.querySelector('a[href^="/@"]'); i++) c = c.parentElement;
    const a = c && c.querySelector('a[href^="/@"]');
    return { handle: a ? a.getAttribute('href').split('?')[0].slice(2) : '', text: el.innerText.replace(/\s+/g, ' ') };
  });
}"""
LINKS_JS = """() => [...new Set([...document.querySelectorAll('a[href*="/video/"]')]
  .map(a => a.href.split('?')[0]))].slice(0, 12)"""
VIDEO_INFO_JS = """() => {
  const t = s => { const e = document.querySelector(s); return e ? e.innerText.replace(/\\s+/g, ' ').trim() : ''; };
  return { caption: t('[data-e2e="browse-video-desc"]'), likes: t('[data-e2e="like-count"]'),
           comments: t('[data-e2e="comment-count"]') };
}"""


class Stop(Exception):
    pass


def pause(a=1.5, b=4.0):
    time.sleep(random.uniform(a, b))


def guard(page, have_links=True):
    body = page.inner_text("body")[:4000]
    if not have_links and re.search(r"\bLog in\b", body):
        raise Stop("TikTok is logged out. Run: python jolt_outreach.py --login")
    if re.search(r"captcha|verify to continue|drag the slider|are you human", body, re.I):
        raise Stop("TikTok is showing a verification check. Solve it in the browser, then run again.")


def open_comments(page):
    for _ in range(3):
        try:
            page.get_by_text(re.compile(r"^Comments( \(\d+\))?$")).first.click(timeout=3000)
        except Exception:  # noqa: BLE001
            pass
        time.sleep(2)
        if page.locator('[data-e2e="comment-level-1"]').count() > 0:
            return True
    return False


def launch(pw):
    OUT_DIR.mkdir(exist_ok=True)
    kwargs = dict(user_data_dir=str(OUT_DIR / "chrome-profile"), headless=False,
                  viewport={"width": 1536, "height": 800})
    try:
        return pw.chromium.launch_persistent_context(channel="chrome", **kwargs)
    except Exception:  # noqa: BLE001
        return pw.chromium.launch_persistent_context(**kwargs)


def do_login():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        ctx = launch(pw)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.tiktok.com/login")
        input("Log into TikTok in the browser window, then press Enter here... ")
        ctx.close()
    print("Saved. Now run: python jolt_outreach.py")


def collect(people, seen, max_new):
    from playwright.sync_api import sync_playwright
    queries = pick_queries()
    print("Searches today:", ", ".join(queries))
    found, fails, opened = [], 0, 0
    with sync_playwright() as pw:
        ctx = launch(pw)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            videos = []
            for q in queries:
                page.goto("https://www.tiktok.com/search/video?q=" + q.replace(" ", "%20"))
                time.sleep(5)
                links = page.evaluate(LINKS_JS)
                guard(page, have_links=bool(links))
                videos += [(q, u) for u in links[:6]]
                pause()
            random.shuffle(videos)
            for q, url in videos:
                if opened >= MAX_VIDEOS or len(found) >= max_new or fails >= 3:
                    break
                creator = (re.search(r"/@([^/]+)/video", url) or [None, ""])[1]
                try:
                    page.goto(url)
                    time.sleep(5)
                    guard(page)
                    if not open_comments(page):
                        raise RuntimeError("comments did not load")
                    rows = page.evaluate(EXTRACT_JS)
                    opened += 1
                    fails = 0
                except Stop:
                    raise
                except Exception as e:  # noqa: BLE001
                    fails += 1
                    print("  skipped a video:", e)
                    continue
                new = 0
                for r in rows:
                    h, t = r["handle"], r["text"]
                    if h in seen or not is_candidate(h, t, creator):
                        continue
                    seen.add(h)
                    found.append({"handle": h, "comment": t, "priority": priority(t),
                                  "source": f"{q} · @{creator}", "url": url,
                                  "note": "Mentions studying. Confirm they're 18+ before booking."
                                  if STUDY.search(t) else ""})
                    new += 1
                print(f"  @{creator}: {len(rows)} comments, {new} new people")
                pause(2, 5)
        except Stop as e:
            print("STOPPED:", e)
        finally:
            ctx.close()
    return found[:max_new]


def collect_videos(seen, creators, max_new):
    """Find videos on our topic with active comment sections. Read-only: opens pages, no clicks."""
    from playwright.sync_api import sync_playwright
    queries = pick_queries(VIDEO_QUERIES)
    print("Searches today:", ", ".join(queries))
    found = []
    with sync_playwright() as pw:
        ctx = launch(pw)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            cands = []
            for q in queries:
                page.goto("https://www.tiktok.com/search/video?q=" + q.replace(" ", "%20"))
                time.sleep(5)
                links = page.evaluate(LINKS_JS)
                guard(page, have_links=bool(links))
                cands += [(q, u) for u in links[:8]]
                pause()
            random.shuffle(cands)
            for q, url in cands[:VIDEO_SCAN]:
                if len(found) >= max_new:
                    break
                creator = (re.search(r"/@([^/]+)/video", url) or [None, ""])[1]
                if url in seen or creator.lower() in creators:
                    continue
                try:
                    page.goto(url)
                    time.sleep(4)
                    guard(page)
                    info = page.evaluate(VIDEO_INFO_JS)
                except Stop:
                    raise
                except Exception as e:  # noqa: BLE001
                    print("  skipped a video:", e)
                    continue
                seen.add(url)
                comments = parse_count(info["comments"])
                if not info["caption"]:
                    print(f"  @{creator}: couldn't read the caption (TikTok layout may have changed)")
                if not is_video_candidate(info["caption"], comments):
                    print(f"  @{creator}: not a fit ({comments} comments)")
                    continue
                creators.add(creator.lower())
                found.append({"creator": creator, "url": url, "caption": info["caption"],
                              "likes": info["likes"], "comments": info["comments"],
                              "source": q})
                print(f"  @{creator}: queued ({info['comments']} comments)")
                pause(2, 5)
        except Stop as e:
            print("STOPPED:", e)
        finally:
            ctx.close()
    return found


def pick_queries(pool=None):
    qs = list(pool or QUERIES)
    random.Random(int(time.time() // 86400)).shuffle(qs)
    return qs[:QUERIES_PER_RUN]


# ------------------------------------ output ------------------------------------
PAGE = r"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Jolt TikTok Outreach</title>
<style>
:root{--bg:#f5f6f9;--sf:#fff;--fg:#161a24;--mu:#5d6577;--ln:#dde1ea;--ac:#3b4fd8;--as:#e6e9fc;--ok:#1f8a55;--os:#e1f4ea;--wn:#a86500;--q:#eef0f5}
@media(prefers-color-scheme:dark){:root{--bg:#10131b;--sf:#181c27;--fg:#e8ebf3;--mu:#9aa2b5;--ln:#2a3040;--ac:#8c9bff;--as:#232a4d;--ok:#5fd29a;--os:#173326;--wn:#f0b65a;--q:#20263a}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0}
.w{max-width:860px;margin:0 auto;padding:28px 16px 64px;display:flex;flex-direction:column;gap:16px}
h1{font-size:28px;margin:0}.mu{color:var(--mu);margin:4px 0 0}
.box,.card{background:var(--sf);border:1px solid var(--ln);border-radius:12px;padding:14px}
.box{display:grid;grid-template-columns:1fr 2fr;gap:12px}.full{grid-column:1/-1}
label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700;color:var(--mu);text-transform:uppercase;letter-spacing:.04em}
input,select,textarea{font:inherit;font-size:14px;color:var(--fg);background:var(--bg);border:1px solid var(--ln);border-radius:8px;padding:8px 10px;text-transform:none;letter-spacing:0;font-weight:400;min-width:0}
.row{display:flex;gap:8px;flex-wrap:wrap}.stats .s{background:var(--sf);border:1px solid var(--ln);border-radius:10px;padding:8px 12px}
.card{display:flex;flex-direction:column;gap:10px}.top{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.h{font-family:ui-monospace,monospace;color:var(--ac);text-decoration:none}
.p{font-size:11px;font-weight:700;text-transform:uppercase;padding:2px 8px;border-radius:99px;background:var(--as);color:var(--ac)}
.p.a{background:var(--os);color:var(--ok)}.src{margin-left:auto;font-size:13px;color:var(--mu);text-decoration:none}
.q{background:var(--q);border-radius:8px;padding:8px 12px;margin:0;font-size:14px}.m{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.n{font-size:13px;color:var(--wn)}.b{font:inherit;font-weight:700;background:var(--ac);color:var(--sf);border:0;border-radius:8px;padding:8px 14px;cursor:pointer}
.done{opacity:.6}@media(max-width:560px){.box{grid-template-columns:1fr}.src{margin-left:0}}
</style></head><body><div class="w">
<div><h1>Jolt TikTok outreach</h1><p class="mu">Updated __UPDATED__. Open the profile, copy the message, send it yourself, set the status.</p></div>
<div class="row stats" id="stats"></div>
<div class="box"><label>Your first name<input id="name"></label><label>Thank-you offer<input id="offer"></label>
<label class="full">Main message ({NAME} and {OFFER} fill in)<textarea id="body" rows="3"></textarea></label></div>
<div class="row"><select id="fp"><option value="">All priorities</option><option>A</option><option>B</option></select>
<select id="fs"><option value="">All statuses</option><option>To send</option><option>Sent</option><option>Replied</option><option>Booked</option><option>Skip</option></select>
<select id="fn"><option value="">All dates</option><option value="new">New today</option></select></div>
<div class="w" style="padding:0" id="list"></div></div>
<script>
const D=__DATA__,S=["To send","Sent","Replied","Booked","Skip"];
const st={get(k,d){try{const v=localStorage.getItem(k);return v===null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
const $=i=>document.getElementById(i);let status=st.get("js",{});
$("name").value=st.get("jn",D.cfg.name);$("offer").value=st.get("jo",D.cfg.offer);$("body").value=st.get("jb",D.cfg.body);
const sub=m=>m.replaceAll("{NAME}",$("name").value.trim()||"[name]").replaceAll("{OFFER}",$("offer").value.trim()||"[offer]");
const msg=p=>"Hey! "+p.opener+" "+sub($("body").value.trim());
const e=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function render(){const fp=$("fp").value,fs=$("fs").value,fn=$("fn").value;
 const c={};S.forEach(s=>c[s]=0);D.people.forEach(p=>c[status[p.handle]||"To send"]++);
 $("stats").innerHTML=S.slice(0,4).map(s=>`<div class="s"><b>${c[s]}</b> ${s.toLowerCase()}</div>`).join("");
 $("list").innerHTML=D.people.filter(p=>(!fp||p.priority===fp)&&(!fs||(status[p.handle]||"To send")===fs)&&(!fn||p.added===D.latest)).map(p=>{
  const s=status[p.handle]||"To send";
  return `<article class="card${s==="Skip"||s==="Booked"?" done":""}" data-h="${e(p.handle)}"><div class="top">
  <a class="h" href="https://www.tiktok.com/@${e(p.handle)}" target="_blank" rel="noopener">@${e(p.handle)}</a>
  <span class="p ${p.priority==="A"?"a":""}">Priority ${p.priority}</span>${p.added===D.latest?'<span class="p">New</span>':""}
  <a class="src" href="${e(p.url)}" target="_blank" rel="noopener">${e(p.source)} ↗</a></div>
  <p class="q">“${e(p.comment)}”</p><p class="m">${e(msg(p))}</p>${p.note?`<div class="n">${e(p.note)}</div>`:""}
  <div class="row"><button class="b" data-c>Copy message</button>
  <select data-s>${S.map(x=>`<option${x===s?" selected":""}>${x}</option>`).join("")}</select></div></article>`}).join("")||'<p class="mu">Nobody matches these filters.</p>'}
$("list").addEventListener("click",async ev=>{const b=ev.target.closest("[data-c]");if(!b)return;
 const p=D.people.find(x=>x.handle===b.closest(".card").dataset.h);
 try{await navigator.clipboard.writeText(msg(p));b.textContent="Copied"}catch(x){b.textContent="Copy blocked, select the text"}setTimeout(()=>b.textContent="Copy message",1600)});
$("list").addEventListener("change",ev=>{const s=ev.target.closest("[data-s]");if(!s)return;status[s.closest(".card").dataset.h]=s.value;st.set("js",status);render()});
["fp","fs","fn"].forEach(i=>$(i).addEventListener("change",render));
[["name","jn"],["offer","jo"],["body","jb"]].forEach(([i,k])=>$(i).addEventListener("input",()=>{st.set(k,$(i).value);render()}));
render();
</script></body></html>"""


CSS = re.search(r"<style>(.*?)</style>", PAGE, re.S).group(1)

VIDEO_PAGE = r"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Jolt videos to comment on</title>
<style>__CSS__
textarea.d{width:100%;box-sizing:border-box}
</style></head><body><div class="w">
<div><h1>Videos to comment on</h1><p class="mu">Updated __UPDATED__. Open the video, edit the draft so it sounds like you, post it yourself, set the status. Aim for 5-10 a day, spread through the day.</p></div>
<div class="row stats" id="stats"></div>
<div class="row"><select id="fs"><option value="">All statuses</option><option>To comment</option><option>Posted</option><option>Got replies</option><option>Moved to DM</option><option>Skip</option></select></div>
<div class="w" style="padding:0" id="list"></div></div>
<script>
const D=__DATA__,S=["To comment","Posted","Got replies","Moved to DM","Skip"];
const st={get(k,d){try{const v=localStorage.getItem(k);return v===null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
const $=i=>document.getElementById(i);let status=st.get("vs",{}),drafts=st.get("vd",{});
const e=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function render(){const fs=$("fs").value;const c={};S.forEach(s=>c[s]=0);D.videos.forEach(v=>c[status[v.url]||"To comment"]++);
 $("stats").innerHTML=S.slice(0,4).map(s=>`<div class="s"><b>${c[s]}</b> ${s.toLowerCase()}</div>`).join("");
 $("list").innerHTML=D.videos.filter(v=>!fs||(status[v.url]||"To comment")===fs).map(v=>{
  const s=status[v.url]||"To comment";
  return `<article class="card${s==="Skip"?" done":""}" data-u="${e(v.url)}"><div class="top">
  <a class="h" href="https://www.tiktok.com/@${e(v.creator)}" target="_blank" rel="noopener">@${e(v.creator)}</a>
  ${v.added===D.latest?'<span class="p">New</span>':""}<span class="p">${e(v.comments||"?")} comments</span>
  <a class="src" href="${e(v.url)}" target="_blank" rel="noopener">${e(v.source)} ↗</a></div>
  <p class="q">${e(v.caption)}</p>
  <textarea class="d" data-d rows="2">${e(drafts[v.url]??v.draft)}</textarea>
  <div class="row"><button class="b" data-c>Copy comment</button>
  <select data-s>${S.map(x=>`<option${x===s?" selected":""}>${x}</option>`).join("")}</select></div></article>`}).join("")||'<p class="mu">Nothing matches this filter.</p>'}
$("list").addEventListener("click",async ev=>{const b=ev.target.closest("[data-c]");if(!b)return;
 const t=b.closest(".card").querySelector("[data-d]").value;
 try{await navigator.clipboard.writeText(t);b.textContent="Copied"}catch(x){b.textContent="Copy blocked, select the text"}setTimeout(()=>b.textContent="Copy comment",1600)});
$("list").addEventListener("input",ev=>{const d=ev.target.closest("[data-d]");if(!d)return;drafts[d.closest(".card").dataset.u]=d.value;st.set("vd",drafts)});
$("list").addEventListener("change",ev=>{const s=ev.target.closest("[data-s]");if(!s)return;status[s.closest(".card").dataset.u]=s.value;st.set("vs",status);render()});
$("fs").addEventListener("change",render);render();
</script></body></html>"""


def render_videos_page(videos, today):
    blob = json.dumps({"videos": videos, "latest": today}, ensure_ascii=False).replace("</", "<\\/")
    return (VIDEO_PAGE.replace("__CSS__", CSS).replace("__DATA__", blob)
            .replace("__UPDATED__", html.escape(today)))


def render_page(people, today):
    data = {"people": people, "latest": today, "cfg": {"name": NAME, "offer": OFFER, "body": BODY}}
    blob = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    return PAGE.replace("__DATA__", blob).replace("__UPDATED__", html.escape(today))


# -------------------------------------- main --------------------------------------
def build(people_new, seen, today):
    llm = llm_openers([p["comment"] for p in people_new])
    for i, p in enumerate(people_new):
        p["opener"] = llm[i] if llm else opener(p["comment"])
        p["added"] = today
    people = load(OUT_DIR / "people.json", [])
    people = people_new + people
    save(OUT_DIR / "people.json", people)
    save(OUT_DIR / "seen.json", sorted(seen))
    (OUT_DIR / "outreach.html").write_text(render_page(people, today), encoding="utf-8")
    return people


def build_videos(new, today):
    llm = llm_comments([v["caption"] for v in new])
    for i, v in enumerate(new):
        v["draft"] = llm[i].strip() if llm and comment_ok(llm[i]) else template_comment(v["caption"])
        v["added"] = today
    videos = new + load(OUT_DIR / "videos.json", [])
    save(OUT_DIR / "videos.json", videos)
    (OUT_DIR / "videos.html").write_text(render_videos_page(videos, today), encoding="utf-8")
    return videos


def run_videos(max_new, today):
    OUT_DIR.mkdir(exist_ok=True)
    seen = set(load(OUT_DIR / "seen_videos.json", []))
    creators = {v["creator"].lower() for v in load(OUT_DIR / "videos.json", [])}
    found = collect_videos(seen, creators, max_new)
    save(OUT_DIR / "seen_videos.json", sorted(seen))
    if not found:
        print("No new videos found this run.")
        return
    videos = build_videos(found, today)
    print(f"Queued {len(found)} videos to comment on. {len(videos)} total. "
          f"Open: {OUT_DIR / 'videos.html'}")


def selftest():
    samples = [
        ("quitter1", "Quit again for a couple days but unfortunately came back to it."),
        ("stopped1", "I downloaded it and it worked for a day and then stopped 😭"),
        ("thumb1", "the other night, I was half-asleep and my thumb started scrolling from muscle memory"),
        ("young1", "I'm 15 and my mom takes my phone, I can't stop scrolling"),
        ("sad1", "Scrolling is how i numb myself to cope with circumstances im stuck in"),
        ("promo1", "use my code YYLE5MA for 5k points, I love this phone app"),
        ("someapp", "I can't stop scrolling, try our app"),
        ("loud", "I'm HOOKED to my phone lately and it distracts me so much."),
        ("nice", "love it, thank you"),
    ]
    ok = [(h, t) for h, t in samples if is_candidate(h, t, "creator")]
    print("kept:", [h for h, _ in ok])
    assert [h for h, _ in ok] == ["quitter1", "stopped1", "thumb1", "loud"], ok
    OUT_DIR.mkdir(exist_ok=True)
    ppl = [{"handle": h, "comment": t, "priority": priority(t), "source": "selftest", "url": "https://tiktok.com",
            "note": "", "opener": opener(t), "added": "2026-10-29"} for h, t in ok]
    (OUT_DIR / "selftest.html").write_text(render_page(ppl, "2026-10-29"), encoding="utf-8")
    for p in ppl:
        print(p["handle"], p["priority"], "|", p["opener"])
    print("selftest ok ->", OUT_DIR / "selftest.html")

    assert [parse_count(x) for x in ("1.2K", "3M", "1,234", "87", "", "n/a")] == [1200, 3000000, 1234, 87, 0, 0]
    vids = [
        ("Why I can't stop doomscrolling at night #doomscrolling", 4200, True),
        ("my dopamine detox: day 7", 900, True),
        ("doomscrolling is how I cope with my depression", 5000, False),   # sensitive
        ("I'm 15 and my phone addiction is bad", 3000, False),             # minor
        ("get ready with me", 8000, False),                                # off topic
        ("phone addiction is real", 1, False),                             # too quiet
        ("", 5000, False),                                                 # caption unreadable
    ]
    for cap, n, want in vids:
        assert is_video_candidate(cap, n) == want, (cap, n)
    for _ in range(30):                                                    # templates must pass our own rules
        assert comment_ok(template_comment("doomscrolling")) and comment_ok(template_comment("zzz"))
    assert not comment_ok("Check out Jolt, link in bio") and not comment_ok("use our app")
    assert not comment_ok("too short")
    vp = [{"creator": "someone", "url": "https://tiktok.com/@someone/video/1", "caption": c, "likes": "10K",
           "comments": f"{n}", "source": "selftest", "draft": template_comment(c), "added": "2026-10-29"}
          for c, n, ok in vids if ok]
    (OUT_DIR / "selftest_videos.html").write_text(render_videos_page(vp, "2026-10-29"), encoding="utf-8")
    print("video selftest ok ->", OUT_DIR / "selftest_videos.html")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--login", action="store_true", help="log into TikTok once")
    ap.add_argument("--selftest", action="store_true", help="check filters and page without TikTok")
    ap.add_argument("--videos", action="store_true", help="find videos to comment on and draft comments")
    ap.add_argument("--max", type=int, help=f"new people (default {TARGET_NEW}) or videos (default {VIDEO_TARGET}) to find")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if a.login:
        return do_login()
    today = date.today().isoformat()
    if a.videos:
        return run_videos(a.max or VIDEO_TARGET, today)
    OUT_DIR.mkdir(exist_ok=True)
    seed_file = OUT_DIR / "seen_seed.txt"
    seed = seed_file.read_text(encoding="utf-8").split() if seed_file.exists() else []
    seen = set(load(OUT_DIR / "seen.json", [])) | set(SEEN_SEED) | set(seed)
    found = collect([], seen, a.max or TARGET_NEW)
    if not found:
        print("No new people found this run.")
        return
    people = build(found, seen, today)
    print(f"Added {len(found)} new people ({sum(p['priority'] == 'A' for p in found)} priority A). "
          f"{len(people)} total. Open: {OUT_DIR / 'outreach.html'}")


if __name__ == "__main__":
    sys.exit(main())
