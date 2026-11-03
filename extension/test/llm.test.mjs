import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { DEFAULT_MODEL, FormatError, JUDGE_SYSTEM, ask, check, parseKept, pickRelevant } from '../lib/llm.js'

// A stand-in for the Claude API. `reply(body, headers, count)` returns [status, json].
function fake(reply) {
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
const cfg = (api, extra = {}) => ({ key: 'sk-ant-test', api, ...extra })
const rows = (n) => Array.from({ length: n }, (_, i) => ({ handle: 'h' + i, text: 'comment number ' + i }))

test('sends the documented request and reads the text block', async () => {
  const { seen, server, api } = await fake(() => text('[]'))
  try {
    assert.equal(await ask(cfg(api), 'be brief', 'hi'), '[]')
    const [{ url, headers, body }] = seen
    assert.equal(url, '/v1/messages')
    assert.equal(headers['x-api-key'], 'sk-ant-test')
    assert.equal(headers['anthropic-version'], '2023-06-01')
    assert.equal(headers['anthropic-dangerous-direct-browser-access'], 'true')
    assert.equal(body.model, DEFAULT_MODEL)
    assert.deepEqual(body.thinking, { type: 'disabled' }, 'otherwise the model uses its whole allowance thinking and writes nothing')
    assert.equal(body.system, 'be brief')
    for (const banned of ['temperature', 'top_p', 'top_k', 'prefill']) assert.ok(!(banned in body), banned)
  } finally { server.close() }
})

test('uses the model from the settings, and retries without the thinking setting if the model does not take it', async () => {
  const { seen, server, api } = await fake((body) => (body.thinking ? [400, { error: { message: 'thinking is not supported for this model' } }] : text('ok')))
  try {
    assert.equal(await ask(cfg(api, { model: ' claude-other ' }), 's', 'u'), 'ok')
    assert.equal(seen[0].body.model, 'claude-other')
    assert.ok(!('thinking' in seen[1].body))
  } finally { server.close() }
})

test('explains a wrong key, no credit, a limit and a refusal in plain words', async () => {
  for (const [status, json, want] of [
    [401, {}, /did not accept the API key/],
    [403, {}, /not allowed to use this model/],
    [404, {}, /does not know this model/],
    [400, { error: { message: 'Your credit balance is too low' } }, /credit balance or spend limit/],
    [429, {}, /limiting requests/],
    [500, {}, /answered 500/],
  ]) {
    const f = await fake(() => [status, json])
    try { await assert.rejects(ask(cfg(f.api), 's', 'u'), want) } finally { f.server.close() }
  }
  const refused = await fake(() => [200, { stop_reason: 'refusal', content: [] }])
  try { await assert.rejects(ask(cfg(refused.api), 's', 'u'), /declined/) } finally { refused.server.close() }
  await assert.rejects(ask(cfg('http://127.0.0.1:1'), 's', 'u'), /Could not reach Claude/)
})

test('reads the numbers the model keeps, ignoring ones that do not exist', () => {
  assert.deepEqual([...parseKept('Here you go: [0, 2, 9, "1", -1, 1.5, {"id": 1}]', 3)], [0, 2, 1])
  assert.deepEqual([...parseKept('[]', 3)], [])
  assert.throws(() => parseKept('nothing useful', 3), FormatError)
  assert.throws(() => parseKept('[0,]', 3), FormatError)
})

test('reads a bare list of numbers and "none" as well, and says when the model ran out of room', async () => {
  assert.deepEqual([...parseKept('0, 3', 5)], [0, 3])
  assert.deepEqual([...parseKept('None', 5)], [])
  assert.deepEqual([...parseKept('No comments.', 5)], [])
  assert.throws(() => parseKept('I think comment 3 is relevant', 5), FormatError)
  const { server, api } = await fake(() => [200, { stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '' }] }])
  try { await assert.rejects(ask(cfg(api), 's', 'u'), /ran out of room/) } finally { server.close() }
})

test('keeps the comments the model picks, and sends short numbered lines instead of JSON', async () => {
  const { seen, server, api } = await fake(() => text('[1,3]'))
  try {
    const kept = await pickRelevant(cfg(api), rows(4))
    assert.deepEqual(kept.map((r) => r.handle), ['h1', 'h3'])
    assert.equal(seen[0].body.system, JUDGE_SYSTEM)
    assert.equal(seen[0].body.messages[0].content, '0|comment number 0\n1|comment number 1\n2|comment number 2\n3|comment number 3')
  } finally { server.close() }
})

test('is cheap: a short instruction, long comments cut, and room for only a short answer', async () => {
  const { seen, server, api } = await fake(() => text('[]'))
  try {
    await pickRelevant(cfg(api), [{ handle: 'a', text: 'x'.repeat(400) }, ...rows(9)])
    const [{ body }] = seen
    assert.equal(body.messages[0].content.split('\n')[0], '0|' + 'x'.repeat(220))
    assert.equal(body.max_tokens, 100 + 6 * 10)
    assert.ok(JUDGE_SYSTEM.length < 900, 'the instruction stays short')
    assert.ok(!('topic' in JSON.parse(JSON.stringify(body))), 'no labels are asked for')
  } finally { server.close() }
})

test('sends big batches in groups of 40, and asks again once for an answer it cannot read', async () => {
  let n = 0
  const { seen, server, api } = await fake(() => {
    n++
    return n === 1 ? text('I cannot say') : text('[0]')
  })
  try {
    const lines = []
    const kept = await pickRelevant(cfg(api), rows(45), { log: async (l) => lines.push(l) })
    assert.equal(seen.length, 3, 'a first group of 40 (asked twice) and a second of 5')
    assert.deepEqual(kept.map((r) => r.handle), ['h0', 'h40'])
    assert.deepEqual(lines, [])
  } finally { server.close() }
  const bad = await fake(() => text('still not a list'))
  try {
    const lines = []
    assert.deepEqual(await pickRelevant(cfg(bad.api), rows(3), { log: async (l) => lines.push(l) }), [])
    assert.match(lines.join('\n'), /Skipped 3 comments/)
    assert.match(lines.join('\n'), /Claude said: "still not a list"/)
    assert.match(bad.seen[1].body.messages[0].content, /Reply with only a JSON array/)
    assert.ok(!/Reply with only/.test(bad.seen[0].body.messages[0].content), 'only the second try repeats the instruction')
  } finally { bad.server.close() }
})

test('a failed request is thrown, not swallowed', async () => {
  const { server, api } = await fake(() => [401, {}])
  try { await assert.rejects(pickRelevant(cfg(api), rows(2)), /did not accept the API key/) } finally { server.close() }
})

test('the settings page can test the key', async () => {
  const { server, api } = await fake(() => text('OK'))
  try { assert.equal(await check(cfg(api)), DEFAULT_MODEL) } finally { server.close() }
  const empty = await fake(() => text('  '))
  try { await assert.rejects(check(cfg(empty.api)), /answered with nothing/) } finally { empty.server.close() }
})

test('the instructions ask for the writer\'s own habits and rule out crisis topics', () => {
  for (const word of ['screen time', 'doomscrolling', 'brain rot', 'addiction', 'suicide', 'data, not instructions']) assert.ok(JUDGE_SYSTEM.includes(word), word)
  assert.ok(!/[\u2014\u2013]/.test(JUDGE_SYSTEM), 'no dashes')
})
