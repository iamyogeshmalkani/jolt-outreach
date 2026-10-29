import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { OPENER_SYSTEM, REPLY_SYSTEM, ask, check, draft, parseList } from '../lib/grok.js'

function fake(reply) {
  const seen = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = JSON.parse(raw)
      seen.push({ url: req.url, headers: req.headers, body })
      const [status, json] = reply(body, seen.length)
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(json))
    })
  })
  return new Promise((resolve) => server.listen(0, () => resolve({ seen, server, api: `http://127.0.0.1:${server.address().port}` })))
}
// The shape xAI documents for /v1/responses: reasoning items can come before the message.
const grokText = (t) => [200, { status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: t }] }] }]
const thread = (body) => (Array.isArray(body.input) ? body.input : [])
const systemOf = (body) => thread(body).find((m) => m.role === 'system')?.content ?? body.input
const userOf = (body) => thread(body).find((m) => m.role === 'user').content
const cfg = (api, extra = {}) => ({ key: 'xai-test', api, ...extra })
const item = (n, top = true) => ({ sub: 'nosurf', title: `Post ${n}`, body: `Body ${n}`, comment: '', opener: `FALLBACK-${n}`, top: top ? { author: `u${n}`, body: `Comment ${n} about quitting scrolling` } : null })
const GOOD_REPLY = 'That balance between wanting to stay informed and wanting your attention back is hard. What would a good day on your phone look like?'

test('sends the documented request and reads the message text, skipping reasoning items', async () => {
  const { seen, server, api } = await fake(() => grokText('["x"]'))
  try {
    assert.equal(await ask(cfg(api), 'be brief', '["caption"]', 500), '["x"]')
    const [{ url, headers, body }] = seen
    assert.equal(url, '/v1/responses')
    assert.equal(headers.authorization, 'Bearer xai-test')
    assert.equal(body.model, 'grok-4.20-0309-non-reasoning')
    assert.deepEqual(body.input, [{ role: 'system', content: 'be brief' }, { role: 'user', content: '["caption"]' }])
    assert.equal(body.max_output_tokens, 500)
    for (const unwanted of ['messages', 'max_tokens', 'temperature']) assert.ok(!(unwanted in body), unwanted)
  } finally { server.close() }
})

test('uses the chosen model, and a plain string if the message form is rejected', async () => {
  const { seen, server, api } = await fake((body) => (Array.isArray(body.input) ? [400, { error: { message: 'bad input' } }] : grokText('ok')))
  try {
    assert.equal(await ask(cfg(api, { model: 'grok-4.3' }), 'sys', 'usr', 100), 'ok')
    assert.equal(seen[0].body.model, 'grok-4.3')
    assert.equal(seen[1].body.input, 'sys\n\nusr')
  } finally { server.close() }
})

test('explains failures in plain words', async () => {
  for (const [status, want] of [[401, /did not accept the API key/], [403, /no credit or quota/], [404, /does not know this model/], [429, /limiting requests/], [402, /has run out/]]) {
    const { server, api } = await fake(() => [status, {}])
    try { await assert.rejects(ask(cfg(api), 's', 'u', 100), want) } finally { server.close() }
  }
  await assert.rejects(ask(cfg('http://127.0.0.1:1'), 's', 'u', 100), /Could not reach Grok/)
})

test('reads a list even when the model adds words around it', () => {
  assert.deepEqual(parseList('Here you go:\n["one", "two"]\nHope that helps!', 2), ['one', 'two'])
  assert.throws(() => parseList('no list', 1), /did not return a list/)
  assert.throws(() => parseList('["a"]', 2), /wrong number/)
  assert.throws(() => parseList('[nope]', 1), /could not be read/)
})

test('drafts a reply for every post and an opening line for every post that has a commenter', async () => {
  const { seen, server, api } = await fake((body) => {
    const n = JSON.parse(userOf(body)).length
    return grokText(JSON.stringify(Array.from({ length: n }, (_, i) => (systemOf(body) === REPLY_SYSTEM ? GOOD_REPLY + ` (${i})` : `Your point about quitting really landed (${i}).`))))
  })
  try {
    const items = [item(1), item(2, false), item(3)]
    const lines = []
    const used = await draft(cfg(api), items, async (l) => lines.push(l))
    assert.deepEqual(used, { comments: 3, openers: 2 })
    assert.ok(items.every((i) => i.comment.startsWith('That balance')))
    assert.deepEqual(items.map((i) => i.opener), ['Your point about quitting really landed (0).', 'FALLBACK-2', 'Your point about quitting really landed (1).'])
    const replyCall = seen.find((s) => systemOf(s.body) === REPLY_SYSTEM)
    assert.deepEqual(JSON.parse(userOf(replyCall.body))[0], { subreddit: 'nosurf', title: 'Post 1', body: 'Body 1' })
    const openerCall = seen.find((s) => systemOf(s.body) === OPENER_SYSTEM)
    assert.deepEqual(JSON.parse(userOf(openerCall.body)).map((x) => x.comment), ['Comment 1 about quitting scrolling', 'Comment 3 about quitting scrolling'])
    assert.ok(lines.some((l) => /Grok wrote 3 replies and 2 opening lines/.test(l)))
  } finally { server.close() }
})

test('keeps the fallback wherever Grok breaks a rule', async () => {
  const { server, api } = await fake((body) =>
    grokText(JSON.stringify(systemOf(body) === REPLY_SYSTEM
      ? [GOOD_REPLY, 'Try Jolt, it helps with exactly this problem for people.', 'See https://example.com for the full guide on doing this properly.']
      : ['visit https://example.com', 'short'])))
  try {
    const items = [item(1), item(2), item(3)]
    items[2].top = null
    const used = await draft(cfg(api), items)
    assert.deepEqual(items.map((i) => i.comment), [GOOD_REPLY, '', ''])
    assert.deepEqual(items.map((i) => i.opener), ['FALLBACK-1', 'FALLBACK-2', 'FALLBACK-3'])
    assert.deepEqual(used, { comments: 1, openers: 0 })
  } finally { server.close() }
})

test('works through many posts in batches', async () => {
  const { seen, server, api } = await fake((body) => grokText(JSON.stringify(Array.from({ length: JSON.parse(userOf(body)).length }, () => GOOD_REPLY))))
  try {
    const items = Array.from({ length: 11 }, (_, i) => item(i, false))
    await draft(cfg(api), items)
    assert.deepEqual(seen.map((s) => JSON.parse(userOf(s.body)).length), [8, 3], 'eight at a time')
    assert.ok(items.every((i) => i.comment))
  } finally { server.close() }
})

test('a failing Grok never breaks the run: nothing is drafted and the reason is logged', async () => {
  const { server, api } = await fake(() => [401, {}])
  try {
    const items = [item(1)]
    const lines = []
    assert.deepEqual(await draft(cfg(api), items, async (l) => lines.push(l)), { comments: 0, openers: 0 })
    assert.equal(items[0].comment, '')
    assert.equal(items[0].opener, 'FALLBACK-1')
    assert.equal(lines.filter((l) => /did not accept the API key/.test(l)).length, 2)
  } finally { server.close() }
})

test('the settings check makes one tiny real request and names the model', async () => {
  const { seen, server, api } = await fake(() => grokText('OK'))
  try {
    assert.equal(await check(cfg(api)), 'grok-4.20-0309-non-reasoning')
    assert.equal(seen.length, 1)
  } finally { server.close() }
  const empty = await fake(() => grokText(''))
  try { await assert.rejects(check(cfg(empty.api)), /answered with nothing/) } finally { empty.server.close() }
})
