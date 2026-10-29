// One run: for each subreddit, the top posts, the top commenter on each, and people who give suggestions or reviews. `api` is lib/reddit.js's reddit(); `pause` waits a moment.
import { RedditError } from './reddit.js'
import { makeItem, parseSubs, parseUsers, pickPeople, postProblem, ruleFlags } from './rules.js'

export async function find(api, s, known, log = async () => {}, pause = async () => {}) {
  const subs = parseSubs(s.subs)
  const skipUsers = parseUsers(s.skip)
  for (const a of known.authors) skipUsers.add(a)
  const items = []
  let stopped = ''
  try {
    for (const sub of subs) {
      let flags = []
      try {
        flags = ruleFlags(await api.rules(sub))
      } catch (e) {
        if (e instanceof RedditError && (e.kind === 'blocked' || e.kind === 'limited')) throw e // rules are optional; only a block matters
      }
      await pause()
      let posts
      try {
        posts = await api.top(sub, s.period)
      } catch (e) {
        if (e instanceof RedditError && (e.kind === 'private' || e.kind === 'missing')) {
          await log(`r/${sub}: ${e.message}, skipped`)
          await pause()
          continue
        }
        throw e
      }
      const skipped = {}
      let kept = 0
      for (const post of posts) {
        if (kept >= s.postsPerSub) break
        if (known.posts.has(post.id)) continue
        const why = postProblem(post, s)
        if (why) {
          skipped[why] = (skipped[why] || 0) + 1
          continue
        }
        await pause()
        const children = await api.comments(post.id)
        const picked = pickPeople(children, { postAuthor: post.author, skipUsers, wantSuggesters: s.suggesters })
        if (picked.top) skipUsers.add(picked.top.author.toLowerCase()) // one message per person per run
        items.push(makeItem(post, picked, flags))
        kept++
      }
      const why = Object.entries(skipped).map(([k, n]) => `${n} ${k}`).join(', ')
      await log(`r/${sub}: ${kept} posts kept${why ? ` (skipped ${why})` : ''}${flags.length ? '; its rules mention: ' + flags.join(', ') : ''}`)
      await pause()
    }
  } catch (e) {
    if (!(e instanceof RedditError)) throw e
    stopped = e.message
  }
  return { items, stopped }
}

