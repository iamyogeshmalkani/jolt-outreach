# Jolt outreach

Find people on TikTok who describe their own screen-time struggle, write a personal opening line
for each, and work through them in a simple page. You send every message and post every comment
yourself.

**Live page:** https://iamyogeshmalkani.github.io/jolt-outreach/

It has two parts:

- **The finder** (`jolt_outreach.py`) runs **on your own computer**, in your own Chrome with your own
  TikTok login. It only reads TikTok. After each run it publishes what it found to the `data`
  branch of this repo.
- **The page** is hosted on GitHub. It reads the `data` branch and shows one conversation at a
  time, with a copy button and a suggested next step. Statuses (sent, replied, booked) are saved in
  your own browser.

Running the finder at home, not on GitHub's servers, is on purpose: TikTok is far more likely to
block a data-centre address than your normal connection.

## Set up the finder (once)

You need Python 3.9 or newer, Node 20 or newer, Chrome and `git` with access to this repo.

    git clone https://github.com/iamyogeshmalkani/jolt-outreach.git
    cd jolt-outreach
    npm install
    npm run setup       # private Python environment
    npm run selftest    # should end with "publish selftest ok"
    npm run login       # a Chrome window opens: log into TikTok there (a spare account), then press Enter

The login is saved on your computer, in `~/jolt_outreach`. Nothing about it is uploaded.

## Use it

    npm run find        # about 20 people to message (5 to 10 minutes, leave the window alone)
    npm run videos      # about 8 videos worth a comment
    npm run watch       # keep looking every hour, 8am to 10pm, a few videos at a time

Each run publishes to the live page, which picks it up within about 5 minutes. The computer must be
on and awake for `watch`. A Chrome window opens briefly each hour. To start it automatically, run
`npm run watch` from Task Scheduler (Windows, at log on) or a login item (Mac).

Add `--no-publish` to keep results on your computer only, for example
`node scripts/py.mjs --videos --no-publish`, then view them with `npm run dev`
(a page on your computer that reads `~/jolt_outreach`, or the folder in `JOLT_OUT_DIR`).

Run the finder on **one** computer. Two computers publishing would overwrite each other's lists.

- It pauses by itself while 30 or more videos are waiting for a comment (only when you use the
  local page, which is where it can see your statuses).
- It stops, and says why, if TikTok asks you to log in or solve a check. Fix that in the window, then
  start it again.
- If a publish fails (no internet, or no git access to the repo), the results stay on your computer
  and go out with the next successful run.

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
template** changes the name, offer and message for your browser. To skip people you have already
contacted, list their handles in a file called `seen_seed.txt` inside `~/jolt_outreach`.

## Please read

- **TikTok's terms.** Automating a logged-in account, even only to read pages, is against TikTok's
  terms of service and can get that account restricted. Use a spare account and keep volume low.
  Don't send messages or comments with a tool.
- **People are real.** Message each person individually, be honest about who you are and why you're
  asking, and drop anyone who says no. Don't contact anyone under 18.
- **TikTok changes its pages.** If runs say they couldn't read a caption, the selectors near the
  top of `jolt_outreach.py` need updating.

## Optional: better opening lines

    .venv/bin/pip install anthropic     # on Windows: .venv\Scripts\pip install anthropic
    export ANTHROPIC_API_KEY=...        # on Windows: set ANTHROPIC_API_KEY=...

One small model call per run then writes the opening lines and comment drafts. Without a key,
built-in templates are used and nothing is sent anywhere.

## Layout

- `jolt_outreach.py` the finder, run through `npm run find`, `videos`, `watch` and `login`
- `scripts/py.mjs` runs the finder with its own Python environment on Mac, Linux and Windows
- `src/` the page, `server/dataApi.ts` the local service used only by `npm run dev`
- `.github/workflows/pages.yml` publishes the page when the code changes

Shortcuts on the page: `J` and `K` move through the list, `C` copies the reply.
