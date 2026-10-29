# Jolt outreach

Find people on TikTok who describe their own screen-time struggle, write a personal opening line
for each, and work through them in a simple page. You send every message and post every comment
yourself.

**Live page:** https://iamyogeshmalkani.github.io/jolt-outreach/

It has two parts, and nothing to run in a terminal:

- **The Jolt finder** is a Chrome extension. It runs in your own Chrome, where you are already
  logged into TikTok, and only reads pages: it opens a small TikTok window, looks at search results
  and comments, and saves what it finds to the `data` branch of this repo.
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
5. Click the extension and choose **Find videos now** to try it.

After that it looks for videos every hour (8am to 10pm, setting changeable) and for people once a day
(about 9:06am), while Chrome is open. A small Chrome window appears briefly during each run. Leave it
alone. The page picks up new results within about 5 minutes.

The token stays in your Chrome and is only ever sent to GitHub. It can only touch this one repo.

- If TikTok shows a verification check or you are logged out, the run stops, says why, and the hourly
  runs pause. Fix it in Chrome and choose **Resume hourly runs**.
- Run the extension in **one** Chrome. It merges with what is already published, so a second one
  would not lose data, but the two would not know about each other's recent finds.
- If a publish fails (no internet, or the token expired) it says so in the popup. Nothing is queued
  to retry: the next run finds new things.

## Optional: draft comments and opening lines written by AI

Without this, drafts come from a few built-in templates. With an API key, an AI model writes each draft
comment from that video's caption, and each opening line from what the person actually said. Two
providers are supported:

- **Grok (xAI), the default.** Get a key at console.x.ai and check there what your free quota covers.
  Default model `grok-4.20-0309-non-reasoning`.
- **Claude (Anthropic).** Get a key at platform.claude.com, in a workspace with a low monthly spend limit.
  It is billed to your Anthropic account, separately from any Claude.ai plan. Default model `claude-haiku-5-5`.

In the extension's **Settings**, choose the provider, paste the key and choose **Save and check**. It
makes one tiny real request, so a wrong key, model or an empty quota shows up straight away. The model
box can stay empty to use the default.

Each run sends one request for all its comments and one for all its opening lines. Only public captions
and comment text are sent. The key stays in your Chrome and is only sent to that provider.

The model's text is checked against the same rules as the templates: no app or brand names, no links,
a sensible length. Anything that fails the check, or any error (wrong key, quota or spend limit
reached, no internet), quietly falls back to the built-in text, and the popup's log says why. A run
never fails because of the AI.

## What gets published

The live page and the `data` branch are public. The `data` branch holds the TikTok handles and
public comments of the people it finds, the newest 300 people and 150 videos. The page asks search
engines not to index it. To have someone removed, open an issue with their handle.
Mental-health and medication comments, anyone who looks under 18, brand accounts and promo codes
are filtered out before anything is saved.

## How it decides

- **People:** comments that describe the commenter's own experience (first person plus a
  screen-time word). Comments that name a specific app or experience are marked "Specific" and sorted first.
- **Videos:** found through search phrases like "dopamine detox". Kept when the caption is on topic
  and the video has at least 2 comments. One video per creator.
- **Drafts:** comment drafts are questions, never a pitch, never a link, never a claim of personal
  experience. Edit each one so it sounds like you before you post it.

The rules are in `extension/lib/rules.js`. The search phrases and run sizes are there too.

## Please read

- **TikTok's terms.** Automating a logged-in account, even only to read pages, is against TikTok's
  terms of service and can get that account restricted. Use a spare account and keep volume low.
  Don't send messages or comments with a tool.
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
    npm run videos      # about 8 videos worth a comment
    npm run watch       # keep looking every hour
    npm run dev         # the page on your computer, reading ~/jolt_outreach

Use one or the other, not both. Add `--no-publish` to keep results on your computer only.

## Tests

    npm run test:extension                          # rules, GitHub saving, AI suggestions and run logic
    .venv/bin/python extension/test/pages_test.py   # page readers against mock TikTok pages
    .venv/bin/python extension/test/extension_e2e.py  # loads the extension in Chromium, mocks TikTok and GitHub (~2 min)

The end-to-end test needs `.venv/bin/python -m playwright install chromium` once. None of the tests
touch real TikTok.

## Layout

- `extension/` the Chrome extension (`lib/rules.js` filters, `lib/tasks.js` what a run does,
  `lib/pages.js` what is read from TikTok pages, `lib/github.js` saving, `lib/llm.js` the optional
  AI suggestions)
- `src/` the page, `.github/workflows/pages.yml` publishes it and the extension download
- `jolt_outreach.py`, `scripts/py.mjs` the Python alternative

Shortcuts on the page: `J` and `K` move through the list, `C` copies the reply.
