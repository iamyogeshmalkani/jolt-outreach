# Jolt outreach

Find people on TikTok who describe their own screen-time struggle, write a personal opening line
for each, and work through them in a simple desk. You send every message and post every comment
yourself.

It has two parts. Neither needs Claude or any AI service.

- **`jolt_outreach.py`** a Python script that reads TikTok in your own browser and writes a list of
  people and videos worth a comment to a folder on your computer.
- **the app** (this folder) a local web page that shows that list one conversation at a time, with
  a copy button and a suggested next step.

The script only reads TikTok. It never follows, likes, comments or messages anyone.

## Set up (once)

You need Python 3.9 or newer, Node 20 or newer, and Chrome.

    npm install
    npm run setup       # creates a private Python environment and installs what the script needs
    npm run selftest    # should end with "hourly selftest ok"
    npm run login       # a Chrome window opens: log into TikTok there, then press Enter in the terminal

Use a spare TikTok account for `npm run login` if you can (see "Please read"). The login is saved
in the output folder, so you only do this once.

## Get real data

Open two terminals in this folder.

    # terminal 1: find people and videos
    npm run find        # about 20 people to message (5 to 10 minutes, leave the window alone)
    npm run videos      # about 8 videos worth a comment

    # terminal 2: the app
    npm run dev         # open http://localhost:5173

The yellow "Sample data" banner disappears once `npm run find` or `npm run videos` has written real
data. Reload the page once. After that the app refreshes by itself.

If a run says it found nothing, or "couldn't read the caption", TikTok's page markup has changed.
The selectors near the top of `jolt_outreach.py` need updating.

## Keep looking for videos every hour

    npm run watch

This keeps running in that terminal. Each hour it searches twice and queues up to 2 new videos, only
between 8am and 10pm (use `node scripts/py.mjs --videos --every 60 --hours 9-20` to change the hours).
A few minutes of random timing are added to each wait.

- It pauses by itself while 30 or more videos are still waiting for a comment, so the list can't grow
  faster than you can work through it.
- It stops, and says why, if TikTok asks you to log in or solve a check. Fix that in the window, then
  start it again.
- A Chrome window opens briefly each hour. The computer must be on and awake. To start it
  automatically, run `npm run watch` from Task Scheduler (Windows, at log on) or a login item (Mac).
- If one run fails, for example because the browser was already open, it tries again next hour.

Running a logged-in account on a schedule looks more automated than a daily run, so the risk to that
account is higher. See "Please read" below.

Both parts share one folder, `~/jolt_outreach` (your home folder). Set `JOLT_OUT_DIR` to use another.
It holds `people.json`, `videos.json`, your statuses (`ui_state.json`) and the browser profile with
your TikTok login. **Don't commit or share that folder.** It contains your login and the handles
and comments of real people.

## Make it yours

Open `jolt_outreach.py` and edit the settings at the top: `NAME`, `OFFER` and `BODY` (the main
message), the search phrases in `QUERIES` and `VIDEO_QUERIES`, and how many people or videos each run
finds. In the app, **Message template** changes the name, offer and message without touching code.

To skip people you have already contacted, list their handles (separated by spaces or new lines) in a file called
`seen_seed.txt` inside the output folder.

## How it decides

- **People:** comments that describe the commenter's own experience (first person plus a
  screen-time word). It skips anyone who looks under 18, anything about mental health or medication,
  sexual content, promo codes and brand accounts. It marks comments that name a specific app or
  experience as "Specific" and sorts them first.
- **Videos:** found through search phrases like "dopamine detox". Kept when the caption is on topic
  and the video has at least 2 comments (`MIN_COMMENTS`). One video per creator.
- **Drafts:** comment drafts are questions, never a pitch, never a link, never a claim of personal
  experience. Edit each one so it sounds like you before you post it.

## Please read

- **TikTok's terms.** Automating a logged-in account, even only to read pages, is against TikTok's
  terms of service and can get that account restricted. Use a spare account, keep volume low (the
  defaults are), and don't send messages or comments with a tool. The script stops if TikTok shows a
  login or captcha check.
- **People are real.** Message each person individually, be honest about who you are and why you're
  asking, and drop anyone who says no. Don't contact anyone under 18.
- **TikTok changes its pages.** The script reads captions and counts using TikTok's current page
  markup. If a run says it couldn't read something, the selectors near the top of
  `jolt_outreach.py` need updating.

## Optional: better opening lines

    .venv/bin/pip install anthropic     # on Windows: .venv\Scripts\pip install anthropic
    export ANTHROPIC_API_KEY=...        # on Windows: set ANTHROPIC_API_KEY=...

One small model call per run then writes the opening lines and comment drafts. Without a key,
built-in templates are used and nothing is sent anywhere.

## Layout

- `jolt_outreach.py` the script, run through `npm run find`, `videos`, `watch` and `login`
- `scripts/py.mjs` runs the script with the project's own Python environment on Mac, Linux and Windows
- `server/dataApi.ts` small local API the app uses to read the folder and save statuses
- `src/` the app (`Workbench.tsx` holds the state, `Queue.tsx` the list, `Conversation.tsx` the
  reply and next step)

Shortcuts: `J` and `K` move through the list, `C` copies the reply.
