import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { COMMENT_SYSTEM, OPENER_SYSTEM, ask, check, improve, parseList } from '../lib/claude.js'

// A stand-in for POST /v1/messages. `reply(body, headers)` returns [status, json].
function fakeAnthropic(reply) {
  const seen = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = JSON.parse(raw)
      seen.push({ url: req.url, headers: req.headers, body })
      const [status, json] = reply(body, req.headers, seen.length)
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(json))
    })
  })
  return new Promise((resolve) => server.listen(0, () => resolve({ seen, server, api: `http://127.0.0.1:${server.address().port}` })))
}
const text = (t) => [200, { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: t }] }]
const cfg = (api, extra = {}) => ({ key: 'sk-test', api, ...extra })

test('sends the request the API expects and reads the text block', async () => {
  const { seen, server, api } = await fakeAnthropic(() => text('["a comment that is long enough to keep"]'))
  try {
    const out = await ask(cfg(api), 'be brief', '["caption"]')
    assert.equal(out, '["a comment that is long enough to keep"]')
    const [{ url, headers, body }] = seen
    assert.equal(url, '/v1/messages')
    assert.equal(headers['x-api-key'], 'sk-test')
    assert.equal(headers['anthropic-version'], '2023-06-01')
    assert.equal(headers['anthropic-dangerous-direct-browser-access'], 'true')
    assert.equal(body.model, 'claude-haiku-5-5')
    assert.deepEqual(body.output_config, { effort: 'low' })
    assert.equal(body.system, 'be brief')
    assert.deepEqual(body.messages, [{ role: 'user', content: '["caption"]' }])
    assert.ok(body.max_tokens >= 200)
    for (const banned of ['temperature', 'top_p', 'top_k', 'thinking', 'prefill']) assert.ok(!(banned in body), banned)
  } finally { server.close() }
})

test('uses the model from settings', async () => {
  const { seen, server, api } = await fakeAnthropic(() => text('x'))
  try {
    await ask(cfg(api, { model: 'claude-sonnet-5-5' }), 's', 'u')
    assert.equal(seen[0].body.model, 'claude-sonnet-5-5')
  } finally { server.close() }
})

test('retries once without the effort setting if the model does not take it', async () => {
  const { seen, server, api } = await fakeAnthropic((body) =>
    body.output_config ? [400, { error: { message: 'output_config.effort is not supported for this model' } }] : text('ok'))
  try {
    assert.equal(await ask(cfg(api, { model: 'claude-older' }), 's', 'u'), 'ok')
    assert.equal(seen.length, 2)
    assert.ok(!('output_config' in seen[1].body))
  } finally { server.close() }
})

test('explains common failures in plain words', async () => {
  const cases = [
    [401, {}, /did not accept the API key/],
    [404, {}, /does not know this model/],
    [429, {}, /limiting requests|spend cap/],
    [400, { error: { message: 'You have reached your specified API usage limits' } }, /spend limit or credit balance/],
    [400, { error: { message: 'Your credit balance is too low' } }, /spend limit or credit balance/],
  ]
  for (const [status, json, want] of cases) {
    const { server, api } = await fakeAnthropic(() => [status, json])
    try { await assert.rejects(ask(cfg(api), 's', 'u'), want) } finally { server.close() }
  }
  await assert.rejects(ask(cfg('http://127.0.0.1:1'), 's', 'u'), /Could not reach Anthropic/)
})

test('treats a refusal as a failure', async () => {
  const { server, api } = await fakeAnthropic(() => [200, { stop_reason: 'refusal', content: [] }])
  try { await assert.rejects(ask(cfg(api), 's', 'u'), /declined/) } finally { server.close() }
})

test('reads a list even when the model adds words around it', () => {
  assert.deepEqual(parseList('Here you go:\n["one", "two"]\nHope that helps!', 2), ['one', 'two'])
  assert.throws(() => parseList('no list here', 1), /did not return a list/)
  assert.throws(() => parseList('["a"]', 2), /wrong number/)
  assert.throws(() => parseList('[not json]', 1), /could not be read/)
})

test('replaces drafts and opening lines with Claude\'s, keeping the template where Claude breaks a rule', async () => {
  const { seen, server, api } = await fakeAnthropic((body) => {
    if (body.system === COMMENT_SYSTEM) return text(JSON.stringify([
      'What would make the first week of a detox actually feel doable?',
      'Check out Jolt, link in bio',               // breaks the rules: must be replaced by the template
    ]))
    return text(JSON.stringify([
      'It sounds like quitting and coming back is the hard part.',
      'visit https://example.com',                 // breaks the rules
    ]))
  })
  try {
    const result = {
      videos: [{ caption: 'my dopamine detox', draft: 'TEMPLATE-1' }, { caption: 'doomscrolling', draft: 'TEMPLATE-2' }],
      people: [{ comment: 'I quit and came back', opener: 'OPENER-1' }, { comment: 'I scroll too much', opener: 'OPENER-2' }],
    }
    const lines = []
    const used = await improve(cfg(api), result, async (l) => lines.push(l))
    assert.deepEqual(result.videos.map((v) => v.draft), ['What would make the first week of a detox actually feel doable?', 'TEMPLATE-2'])
    assert.deepEqual(result.people.map((p) => p.opener), ['It sounds like quitting and coming back is the hard part.', 'OPENER-2'])
    assert.deepEqual(used, { comments: 1, openers: 1 })
    assert.equal(seen.length, 2, 'one request for all comments, one for all openers')
    assert.deepEqual(JSON.parse(seen[0].body.messages[0].content), ['my dopamine detox', 'doomscrolling'])
    assert.ok(seen.some((s) => s.body.system === OPENER_SYSTEM))
    assert.ok(lines.some((l) => /Claude wrote 1 draft comments and 1 opening lines/.test(l)))
  } finally { server.close() }
})

test('a failing Claude never breaks the run: the templates stay and the reason is logged', async () => {
  const { server, api } = await fakeAnthropic(() => [401, {}])
  try {
    const result = { videos: [{ caption: 'x', draft: 'TEMPLATE' }], people: [{ comment: 'y', opener: 'OPENER' }] }
    const lines = []
    const used = await improve(cfg(api), result, async (l) => lines.push(l))
    assert.equal(result.videos[0].draft, 'TEMPLATE')
    assert.equal(result.people[0].opener, 'OPENER')
    assert.deepEqual(used, { comments: 0, openers: 0 })
    assert.equal(lines.filter((l) => /did not accept the API key/.test(l)).length, 2)
  } finally { server.close() }
})

test('does nothing, and makes no request, when there is nothing to improve', async () => {
  const { seen, server, api } = await fakeAnthropic(() => text('[]'))
  try {
    await improve(cfg(api), { videos: [], people: [] })
    assert.equal(seen.length, 0)
  } finally { server.close() }
})

test('the settings check makes one tiny real request and names the model', async () => {
  const { seen, server, api } = await fakeAnthropic(() => text('OK'))
  try {
    assert.equal(await check(cfg(api)), 'claude-haiku-5-5')
    assert.equal(seen.length, 1)
  } finally { server.close() }
  const empty = await fakeAnthropic(() => text(''))
  try { await assert.rejects(check(cfg(empty.api)), /answered with nothing/) } finally { empty.server.close() }
})
