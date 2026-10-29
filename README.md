# Jolt outreach

Find people on TikTok who describe their own screen-time struggle, write a personal opening line
for each, and work through them in a simple page. You send every message and post every comment
yourself.

**Live page:** https://iamyogeshmalkani.github.io/jolt-outreach/

Everything runs on GitHub, with nothing to install:

- **The finder** (`jolt_outreach.py`) runs on GitHub every hour for videos worth a comment and once
  a day for people to message. It only reads TikTok in a browser, and saves what it finds to the
  `data` branch of this repo.
- **The page** reads that data and shows one conversation at a time, with a copy button and a
  suggested next step. Statuses (sent, replied, booked) are saved in your own browser.

## One-time setup: the TikTok login

The hourly job needs a TikTok login. Use a spare account. This needs Node and Python on one computer, once.

    npm install
    npm run setup          # private Python environment
    npm run login          # a Chrome window opens: log into TikTok there, press Enter in the terminal
    npm run export-session # writes jolt-session.json (works like a password: never commit or share it)
    gh secret set TIKTOK_SESSION < jolt-session.json
    rm jolt-session.json

Then start a first run from the repo's **Actions** tab: **Find people and videos**, **Run workflow**.
After that it runs by itself (about 8:47am to 9:47pm India time, hourly). If TikTok shows a
verification check the run fails and says so. Export a fresh login and set the secret again.

GitHub's servers are not a normal home connection, so TikTok may block them more often than your own
computer. If most runs fail, run the finder on your own computer instead (below).

## Run on your own computer instead

    npm run login
    npm run find           # about 20 people to message
    npm run videos         # about 8 videos worth a comment
    npm run watch          # keep looking every hour, 8am to 10pm
    npm run dev            # the page, reading ~/jolt_outreach (override with JOLT_OUT_DIR)

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
  and the video has at least 2 comments (`MIN_COMMENTS`). One video per creator.
- **Drafts:** comment drafts are questions, never a pitch, never a link, never a claim of personal
  experience. Edit each one so it sounds like you before you post it.

## Make it yours

Edit the settings at the top of `jolt_outreach.py`: `NAME`, `OFFER` and `BODY` (the main message),
the search phrases in `QUERIES` and `VIDEO_QUERIES`, and the run sizes. On the page, **Message
template** changes the name, offer and message for your browser. To change the schedule, edit the
`cron` lines in `.github/workflows/finder.yml`.

## Please read

- **TikTok's terms.** Automating a logged-in account, even only to read pages, is against TikTok's
  terms of service and can get that account restricted. Use a spare account and keep volume low.
  Don't send messages or comments with a tool.
- **People are real.** Message each person individually, be honest about who you are and why you're
  asking, and drop anyone who says no. Don't contact anyone under 18.
- **TikTok changes its pages.** If runs say they couldn't read a caption, the selectors near the
  top of `jolt_outreach.py` need updating.

## Optional: better opening lines

Add an `ANTHROPIC_API_KEY` repository secret (and `anthropic` to `requirements.txt`) and one small
model call per run writes the opening lines and comment drafts. Without it, built-in templates are
used and nothing is sent anywhere.

## Layout

- `jolt_outreach.py` the finder
- `.github/workflows/finder.yml` the hourly job, `pages.yml` publishes the page
- `src/` the page, `server/dataApi.ts` the local service used only by `npm run dev`
- `scripts/py.mjs` runs the finder with its own Python environment on Mac, Linux and Windows

Shortcuts on the page: `J` and `K` move through the list, `C` copies the reply.
