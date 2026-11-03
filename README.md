# Jolt outreach

Find recent, popular TikTok videos and Instagram reels on your topics. For TikTok it also finds the comments
that are about screen time, brain rot, phone addiction, productivity and similar subjects. A simple page lists
each video (with those comments under it), and you open it, then mark it complete so it is never found again.

**Live page:** https://iamyogeshmalkani.github.io/jolt-outreach/

It has two parts, and nothing to run in a terminal:

- **The Jolt finder** is a Chrome extension. It runs in your own Chrome, where you are already
  logged into TikTok, and only reads pages: it searches TikTok for the topics you list in Settings,
  opens the most-viewed recent results to check their comment count, reads the top 50 comments of each
  video that qualifies, and saves the video and the comments about your topics to the `data` branch of
  this repo. A comment is kept when Claude says the writer is talking about their own screen time or digital
  habits (see **Claude checks the comments** below), or, with no Claude key, when it mentions a word or phrase in
  the **Comment topics** list.
- **The page** is hosted on GitHub. It reads the `data` branch and lists the videos, each with the
  comments that matched (the writer's @name links to their TikTok profile), an **Open video** link,
  **Copy link** and **Mark complete**.

A video is listed when it was posted in the last 60 days, has at least 10,000 views and at least 20
comments. All three numbers, the search topics and the comment topics are in the extension's **Settings**.
A video is listed even when none of its comments match, and says so.

**Claude checks the comments (optional, both extensions).** In the extension's Settings, paste a Claude API key
(`sk-ant-...`) and choose **Test Claude**. The key stays in that Chrome and is only ever sent to Anthropic; it is
never saved to the repo or the page, so don't paste it anywhere public. Claude keeps comments where the writer
talks about their own high screen time, doomscrolling, brain rot, phone or social media addiction, lost focus or
productivity, or trying to cut back, and drops reactions to the video, chatter, promotion and crisis topics.
If Claude can't be reached (wrong key, no credit), the run goes on with the Comment topics list and says so.
It is built to use few tokens:
- Comments are cleaned locally first (the creator's own, too short or long, repeats, minors, promotions).
- Only comments that mention a phone or screen word are sent at all; reactions and chatter cost nothing.
- Each comment goes as one short numbered line (cut at 220 characters) with a short instruction, up to 40 per
  request, and Claude answers with just the numbers to keep. Roughly 25 tokens in per comment and a handful out.
- Only reels and videos that already qualify are read, and the default model is the small, cheap
  `claude-haiku-5-5` (changeable in Settings).

**Comment topics.** The default list covers screen time, high screen time, brain rot, doomscrolling,
phone and social media addiction, digital detox, dopamine, digital and phone habits, productivity,
procrastination, focus and distraction. Each entry is a word or phrase. Case, spacing and hyphens don't
matter ("brain rot" also finds "brainrot"), and an entry can be the start of a word ("procrastinat"
finds procrastinating). Comments from the video's own creator, very short or very long ones, repeats,
and any that look like they come from a minor, mention self-harm, are adult, or are promotions are never saved.

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

After that, start a run by hand when you want more videos. A run opens up to 100 videos to check them
(changeable in Settings), takes about 15 seconds per video, and keeps up to 40. A small Chrome window
appears during the run. Leave it alone. The page picks up new videos within about 5 minutes. If you
would rather have it run by itself, tick **Also run by itself every hour** in the popup.

The token stays in your Chrome and is only ever sent to GitHub. It can only touch this one repo.

- **Age** comes from the video's number: a TikTok video number contains the time it was posted, so
  old videos are skipped without opening them. TikTok's search can't be sorted by newest, so a search
  may turn up few recent videos.
- **Mark complete** on the page saves the video to `videos_done.json`, and the finder never lists it
  again. For that the page needs the same kind of GitHub token (page **Settings**, kept in that browser).
  Without a token it only hides the video in that browser.
- If TikTok shows a verification check or you are logged out, the run stops, says why, and any
  automatic runs pause. Fix it in Chrome and choose **Resume automatic runs**.
- Run the extension in **one** Chrome. It merges with what is already published, so a second one
  would not lose data, but the two would not know about each other's recent finds.

## The Instagram extension

A second, separate extension that does the same job on Instagram: it searches your keywords, keeps recent,
popular reels, and lists their links on the same page, under its **Instagram** button. Like the TikTok one, it
reads the top 50 comments of each kept reel and saves the ones about the writer's own digital habits (checked by
Claude if you add a key, otherwise by the Comment topics list in its Settings).

1. Download https://iamyogeshmalkani.github.io/jolt-outreach/jolt-instagram-extension.zip, unzip it and load
   it on `chrome://extensions` (Developer mode, Load unpacked), the same way as the TikTok one.
2. **Log into Instagram** in that same Chrome. Use a spare account if you can.
3. Open its **Settings**, paste the same GitHub token as the TikTok extension (it saves to the same repo, in
   its own files, `instagram_found.json` and `instagram_done.json`), and choose **Save and check**.
4. Click the extension and choose **Find reels now**.

A reel is listed when it is a video, was posted in the last 60 days, and has at least 1,000 likes (or the
creator hides likes). Keywords, days, likes and reels per run are in **Settings**.

- **How it searches.** For each keyword it opens Instagram's search for it and reads the reel links; if the
  search shows nothing it tries the keyword as a hashtag (phone addiction becomes #phoneaddiction).
- **Age** comes from the reel's shortcode, which encodes when it was posted, so old reels are skipped without
  opening them. If a shortcode can't be read, the reel is not filtered out by age.
- **Likes** are not shown in search results, so each candidate reel is opened and read. Instagram does not show
  a reel's views to other people, so likes are the popularity measure.
- **Go gently.** Instagram limits accounts that act like a bot much faster than TikTok does. A run is capped at
  40 reels by default, with pauses of several seconds, and takes about 10 seconds per reel. Start one by hand a
  couple of times a day at most. If Instagram asks for a check or logs you out, the run stops and says so.
- **Mark complete** on the page works the same way as for TikTok, saved to `instagram_done.json`.
- **Reaching out.** Under each reel or video the page lists the saved comments with the writer's @name, the
  comment, why it matched, **Open profile** (their TikTok or Instagram profile) and **Copy profile link**.
- **Instagram changes its pages.** The readers in `instagram-extension/lib/pages.js` use Instagram's search links
  and a post's summary tags. They were tested against mock pages, not the live site, so the first real run may
  need small fixes: the popup's log shows what the page had when a reel would not open.

## What gets published

The live page and the `data` branch are public. The `data` branch holds public TikTok video and Instagram reel links
with their caption, creator name and counts, the public comments that matched (the writer's @name and
the comment text) for the newest 500 videos, plus the list of videos marked complete. The page asks search engines not to index it.

The rules are in `extension/lib/rules.js` and the run logic in `extension/lib/tasks.js`.

## Please read

- **TikTok's terms.** Automating a logged-in account, even only to read pages, is against TikTok's
  terms of service and can get that account restricted. Use a spare account and keep volume low.
  Don't send messages with a tool.
- **TikTok changes its pages.** The extension reads search results and counts using TikTok's current page
  markup. If the popup's log says it couldn't open a video, the selectors in
  `extension/lib/pages.js` need updating.

## Tests

    npm run test:extension                          # rules, GitHub saving and run logic
    npm run test:instagram                          # the same for the Instagram extension
    .venv/bin/python extension/test/pages_test.py   # page readers against mock TikTok pages
    .venv/bin/python extension/test/extension_e2e.py  # loads the extension in Chromium, mocks TikTok and GitHub (~2 min)
    .venv/bin/python instagram-extension/test/pages_test.py       # the same two for Instagram
    .venv/bin/python instagram-extension/test/extension_e2e.py

The end-to-end test needs `.venv/bin/python -m playwright install chromium` once. None of the tests
touch real TikTok.

## Layout

- `instagram-extension/` the Instagram extension (same layout as `extension/`)
- `extension/` the Chrome extension (`lib/rules.js` searches and limits, `lib/tasks.js` what a run does,
  `lib/pages.js` what is read from TikTok pages (search results, video counts, comments), `lib/github.js` saving)
- `src/` the page, `.github/workflows/pages.yml` publishes it and the extension download
- `jolt_outreach.py`, `scripts/py.mjs`, `server/` the older Python finder for people, no longer used by the page
