import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { RedditError, getJson, reddit } from '../lib/reddit.js'
import { comment, commentsPage, listing, post, rules } from './fixtures.mjs'

function fake(handler) {
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push(req.url)
    const [status, type, body] = handler(req.url)
    res.writeHead(status, { 'content-type': type })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  })
  return new Promise((resolve) => server.listen(0, () => resolve({ seen, server, base: `http://127.0.0.1:${server.address().port}` })))
}
const JSON_T = 'application/json'

test('builds the right addresses and reads posts, comments and rules', async () => {
  const { seen, server, base } = await fake((url) => {
    if (url.includes('/top.json')) return [200, JSON_T, listing([post(), { kind: 't1', data: {} }, post({ id: 'p2' })])]
    if (url.includes('/comments/')) return [200, JSON_T, commentsPage([comment()])]
    return [200, JSON_T, rules([['No self-promotion']])]
  })
  try {
    const api = reddit(base)
    assert.deepEqual((await api.top('nosurf', 'week')).map((p) => p.id), ['p1', 'p2'])
    assert.equal((await api.comments('p1'))[0].data.author, 'thoughtful_reader')
    assert.equal((await api.rules('nosurf')).rules[0].short_name, 'No self-promotion')
    assert.deepEqual(seen, [
      '/r/nosurf/top.json?t=week&limit=25&raw_json=1',
      '/comments/p1.json?sort=top&limit=40&depth=1&raw_json=1',
      '/r/nosurf/about/rules.json?raw_json=1',
    ])
  } finally { server.close() }
})

test('explains each way Reddit can refuse, in plain words', async () => {
  const cases = [
    [429, 'text/html', 'slow down', 'limited', /limiting requests/],
    [404, JSON_T, {}, 'missing', /not found/],
    [403, JSON_T, { reason: 'private', error: 403 }, 'private', /private or restricted/],
    [403, 'text/html', "You've been blocked by network security.", 'blocked', /logged into Reddit in this Chrome/],
    [200, 'text/html', '<html>log in to continue</html>', 'blocked', /blocked the request/],
    [500, JSON_T, {}, 'network', /answered 500/],
  ]
  for (const [status, type, body, kind, message] of cases) {
    const { server, base } = await fake(() => [status, type, body])
    try {
      await assert.rejects(getJson(base, '/x.json'), (e) => e instanceof RedditError && e.kind === kind && message.test(e.message), `${status} ${kind}`)
    } finally { server.close() }
  }
  await assert.rejects(getJson('http://127.0.0.1:1', '/x.json'), (e) => e.kind === 'network' && /Could not reach Reddit/.test(e.message))
})
