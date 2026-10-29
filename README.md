# Jolt outreach

Find people on TikTok who describe their own screen-time struggle, write a personal opening line
for each, and work through them in a simple page. You send every message yourself.

**Live page:** https://iamyogeshmalkani.github.io/jolt-outreach/

It has two parts, and nothing to run in a terminal:

- **The Jolt finder** is a Chrome extension. It runs in your own Chrome, where you are already
  logged into TikTok, and only reads pages: it opens a small TikTok window, reads the comments of a few
  popular videos about screen time, and saves the people it finds to the `data` branch of this repo.
- **The page** is hosted on GitHub. It reads the `data` branch and shows one conversation at a
  time, with a copy button and a suggested next step. Statuses (sent, replied, booked) are saved in
  your own browser.

## Set up the extension (once, about 3 minutes)

1. **Get it.** Download https://iamyogeshmalkani.github.io/jolt-outreach/jolt-finder-extension.zip and
   unzip it. In Chrome open `chrome://extensions`, turn on **Developer mode**, choose **Load
   unpacked** and pick the unzipped folder.
2. **Log into TikTok** in that same Chrome. Use a spare account if you can.
3. **Make a GitHub token** at https://github.com/settings/personal-access-tokens/new. Choose **Only
   select repositories**, pick `jolt-outreach`, and under **Repository permissions** set
   **Contents** to **Read and write**.
4. Click the extension, open **Settings**, paste the token, and choose **Save and check**.
5. Click the extension and choose **Find people now** to try it.

After that it looks for a few people every hour (8am to 10pm, changeable in Settings) while Chrome is
open. Each run is small, up to 8 people, so the day's total builds up gradually. A small Chrome window
appears briefly during each run. Leave it alone. The page picks up new people within about 5 minutes.

The token stays in your Chrome and is only ever sent to GitHub. It can only touch this one repo.

- If TikTok shows a verification check or you are logged out, the run stops, says why, and the hourly
  runs pause. Fix it in Chrome and choose **Resume hourly runs**.
- Run the extension in **one** Chrome. It merges with what is already published, so a second one
  would not lose data, but the two would not know about each other's recent finds.
- If a publish fails (no internet, or the token expired) it says so in the popup. Nothing is queued
  to retry: the next run finds new things.

## Optional: opening lines written by AI

Without this, the first line of each message comes from a few built-in templates, picked by words in
the person's comment. With an API key, an AI model writes it from what the person actually said. Two
providers are supported:

- **Groq, the default.** Get a key at console.groq.com/keys. Default model `openai/gpt-oss-20b`. Check your
  account's limits page for what the free plan allows. Signup may or may not ask for a card.
- **Claude (Anthropic).** Get a key at platform.claude.com, in a workspace with a low monthly spend limit.
  It is billed to your Anthropic account, separately from any Claude.ai plan. Default model `claude-haiku-5-5`.

In the extension's **Settings**, choose the provider, paste the key and choose **Save and check**. It
makes one tiny real request, so a wrong key, model or an empty quota shows up straight away. The model
box can stay empty to use the default.

Each run sends one request for all its opening lines. Only the public text of each comment is sent.
The key stays in your Chrome and is only sent to that provider.

The model's text is checked against the same rules as the templates: no links, no company names, a
sensible length. Anything that fails the check, or any error (wrong key, quota or spend limit reached,
no internet), quietly falls back to the built-in line, and the popup's log says why. A run never fails
because of the AI.

## The Reddit extension

A second, separate extension for Reddit. For each subreddit you list, it finds the top posts, picks the
top commenter on each, and drafts two things with an AI model: a message to that commenter, and a reply you
could post on the post. You send and post everything yourself.

1. Download https://iamyogeshmalkani.github.io/jolt-outreach/jolt-reddit-extension.zip, unzip it and load
   it on `chrome://extensions` (Developer mode, Load unpacked), the same way as the TikTok one.
2. Log into Reddit in that Chrome.
3. Open its **Settings**. Add your subreddits, choose how many posts, pick the AI provider and paste its
   key: **Groq** (key from console.groq.com/keys, starts with `gsk_`, default model `openai/gpt-oss-20b`) or
   **Grok (xAI)** (key from console.x.ai, starts with `xai-`). They are different companies and a key from
   one does not work with the other. Settings says so if you mix them up. Use **Test Reddit** and **Test AI** to check both.
4. Click the extension, choose **Find top posts**, then **Open dashboard**.

In the dashboard, each post shows its top commenter and their comment, a message ready to send (the
button opens Reddit's message form already filled in), and a reply draft. Everything stays in this Chrome.
Nothing is uploaded to GitHub.

### Using it on more than one device

By default everything stays in one Chrome. To share it across devices (and teammates), the extension can
keep your posts, statuses, edits and settings in a **private** GitHub repo:

1. Make a **private** repo (for example `jolt-reddit-data`). It holds other people's usernames and what
   they wrote, so keep it private. The extension refuses a public repo.
2. Make a token at https://github.com/settings/personal-access-tokens/new: **Only select repositories**, pick
   that repo, and set **Contents** to **Read and write**. (This is a different token from the TikTok
   extension's, which is limited to a different repo.)
3. On each device, open **Settings**, fill in **Private sync repo** and **Sync token**, then choose **Test sync**.
   Teammates need access to the repo and their own token.

After that it syncs by itself: before and after each run, a moment after you change anything in the
dashboard, when you come back to the dashboard tab, and with **Sync now**.

- **Changes are merged, not overwritten.** If one device marks the message as sent while another marks the
  reply as posted, both changes survive. If two devices change the same part, the newest change wins.
- **Posts found on one device are not found again on another**, because each run syncs first.
- **Keys never sync.** Your AI key and sync token stay on each device. Settings such as subreddits and the
  message template do sync, and the most recently saved version wins.
- **It keeps the newest 250 posts.** Older ones drop off, on every device.

- **The top commenter** is the highest-scoring top-level comment from a real person. It skips the poster,
  moderators, bots, deleted comments, links, anyone who looks under 18, and sensitive topics. Posts that
  are pinned, adult, locked or about sensitive subjects are skipped too.
- **Check the rules first.** If a subreddit's rules mention promotion, surveys, research or DMs, the post
  shows a warning. Read the rules and ask the moderators before you message or reply. Many communities
  ban unsolicited messages, and Reddit users react badly to them.
- **Replies are drafts.** Edit each one so it sounds like you. Don't post the same text twice.
- **Reddit may block it.** Reddit refuses many automated requests. This reads public pages in your own
  logged-in Chrome, and if Reddit blocks it, the popup says so. Open reddit.com once in that Chrome and try again.
- **Run it sparingly.** A run makes a few dozen requests. Once or twice a day is plenty.

## What gets published

The live page and the `data` branch are public. The `data` branch holds the TikTok handles and
public comments of the people it finds, the newest 300 people. The page asks search
engines not to index it. To have someone removed, open an issue with their handle.
Mental-health and medication comments, anyone who looks under 18, brand accounts and promo codes
are filtered out before anything is saved.

## How it decides

- **People:** comments that describe the commenter's own experience (first person plus a
  screen-time word). Comments that name a specific app or experience are marked "Specific" and sorted first.

The rules are in `extension/lib/rules.js`. The search phrases and run sizes are there too.

## Please read

- **TikTok's terms.** Automating a logged-in account, even only to read pages, is against TikTok's
  terms of service and can get that account restricted. Use a spare account and keep volume low.
  Don't send messages with a tool.
- **People are real.** Message each person individually, be honest about who you are and why you're
  asking, and drop anyone who says no. Don't contact anyone under 18.
- **TikTok changes its pages.** The extension reads captions and comments using TikTok's current page
  markup. If the popup's log says it couldn't read a caption, the selectors in
  `extension/lib/pages.js` need updating.

## Alternative: run it from a terminal

`jolt_outreach.py` does the same job in Python, with its own Chrome profile, and publishes to the same
`data` branch. You need Python 3.9+, Node 20+ and `git` access to this repo.

    npm install && npm run setup
    npm run login       # log into TikTok in the window that opens
    npm run find        # about 20 people to message
    npm run dev         # the page on your computer, reading ~/jolt_outreach

Use one or the other, not both. Add `--no-publish` to keep results on your computer only.

## Tests

    npm run test:extension                          # rules, GitHub saving, AI opening lines and run logic
    .venv/bin/python extension/test/pages_test.py   # page readers against mock TikTok pages
    .venv/bin/python extension/test/extension_e2e.py  # loads the extension in Chromium, mocks TikTok and GitHub (~2 min)

The end-to-end test needs `.venv/bin/python -m playwright install chromium` once. None of the tests
touch real TikTok.

## Layout

- `reddit-extension/` the Reddit extension (its tests: `npm run test:reddit`, and `test/e2e.py`)
- `extension/` the Chrome extension (`lib/rules.js` filters, `lib/tasks.js` what a run does,
  `lib/pages.js` what is read from TikTok pages, `lib/github.js` saving, `lib/llm.js` the optional
  AI opening lines)
- `src/` the page, `.github/workflows/pages.yml` publishes it and the extension download
- `jolt_outreach.py`, `scripts/py.mjs` the Python alternative

Shortcuts on the page: `J` and `K` move through the list, `C` copies the reply.
