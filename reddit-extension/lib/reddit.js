// Reads public Reddit pages as JSON, from the user's own logged-in Chrome. Nothing here writes to Reddit.
export class RedditError extends Error {
  constructor(kind, message) {
    super(message)
    this.kind = kind // 'blocked' and 'limited' stop the whole run; 'private' and 'missing' only skip one subreddit
  }
}

export const BASE = 'https://www.reddit.com'

export async function getJson(base, path) {
  let res
  try {
    res = await fetch(`${base ?? BASE}${path}`, { credentials: 'include', headers: { Accept: 'application/json' } })
  } catch {
    throw new RedditError('network', 'Could not reach Reddit. Check your internet connection.')
  }
  const type = res.headers.get('content-type') || ''
  if (res.status === 429) throw new RedditError('limited', 'Reddit is limiting requests. Wait a few minutes and try again.')
  if (res.status === 404) throw new RedditError('missing', 'not found')
  if (res.status === 403 && type.includes('json')) throw new RedditError('private', 'private or restricted')
  if (res.status === 403 || (res.ok && !type.includes('json'))) {
    throw new RedditError('blocked', 'Reddit blocked the request. Make sure you are logged into Reddit in this Chrome, open reddit.com once, then try again.')
  }
  if (!res.ok) throw new RedditError('network', `Reddit answered ${res.status}.`)
  return res.json()
}

export const reddit = (base) => ({
  async top(sub, period) {
    const data = await getJson(base, `/r/${encodeURIComponent(sub)}/top.json?t=${period}&limit=25&raw_json=1`)
    return (data?.data?.children || []).filter((c) => c.kind === 't3').map((c) => c.data)
  },
  async comments(postId) {
    const data = await getJson(base, `/comments/${encodeURIComponent(postId)}.json?sort=top&limit=40&depth=1&raw_json=1`)
    return data?.[1]?.data?.children || []
  },
  async rules(sub) {
    return getJson(base, `/r/${encodeURIComponent(sub)}/about/rules.json?raw_json=1`)
  },
})
