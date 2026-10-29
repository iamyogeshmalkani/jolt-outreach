import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { JUDGE_SYSTEM, OPENER_SYSTEM, ask, check, improve, keyProblem, parseList, pickRelevant } from '../lib/llm.js'

// A stand-in for an AI API. `reply(body, headers, url, count)` returns [status, json].
function fake(reply) {
  const seen = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = JSON.parse(raw)
      seen.push({ url: req.url, headers: req.headers, body })
      const [status, json] = reply(body, req.headers, req.url, seen.length)
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(json))
    })
  })
  return new Promise((resolve) => server.listen(0, () => resolve({ seen, server, api: `http://127.0.0.1:${server.address().port}` })))
}
// Shapes follow each provider's documentation.
const claudeText = (t) => [200, { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: t }] }]
const groqText = (t) => [200, { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: t, reasoning: 'thinking it over' } }] }]
const thread = (body) => (Array.isArray(body.messages) ? body.messages : Array.isArray(body.input) ? body.input : [])
const systemOf = (body) => body.system ?? (thread(body).find((m) => m.role === 'system')?.content ?? body.input)
const userOf = (body) => thread(body).find((m) => m.role === 'user').content
const groq = (api, extra = {}) => ({ provider: 'groq', key: 'gsk-test', api, ...extra })
const claude = (api, extra = {}) => ({ provider: 'anthropic', key: 'sk-test', api, ...extra })

test('Claude: sends the documented request and reads the text block', async () => {
  const { seen, server, api } = await fake(() => claudeText('["a comment that is long enough to keep"]'))
  try {
    assert.equal(await ask(claude(api), 'be brief', '["caption"]'), '["a comment that is long enough to keep"]')
    const [{ url, headers, body }] = seen
    assert.equal(url, '/v1/messages')
    assert.equal(headers['x-api-key'], 'sk-test')
    assert.equal(headers['anthropic-version'], '2023-06-01')
    assert.equal(headers['anthropic-dangerous-direct-browser-access'], 'true')
    assert.equal(body.model, 'claude-haiku-5-5')
    assert.deepEqual(body.output_config, { effort: 'low' })
    assert.equal(body.system, 'be brief')
    for (const banned of ['temperature', 'top_p', 'top_k', 'thinking', 'prefill']) assert.ok(!(banned in body), banned)
  } finally { server.close() }
})

test('Claude: retries once without the effort setting if the model does not take it; explains failures', async () => {
  const { seen, server, api } = await fake((body) =>
    body.output_config ? [400, { error: { message: 'output_config.effort is not supported for this model' } }] : claudeText('ok'))
  try {
    assert.equal(await ask(claude(api, { model: 'claude-older' }), 's', 'u'), 'ok')
    assert.ok(!('output_config' in seen[1].body))
  } finally { server.close() }
  for (const [status, json, want] of [
    [401, {}, /Claude did not accept the API key/],
    [400, { error: { message: 'Your credit balance is too low' } }, /credit balance/],
    [429, {}, /limiting requests/],
  ]) {
    const f = await fake(() => [status, json])
    try { await assert.rejects(ask(claude(f.api), 's', 'u'), want) } finally { f.server.close() }
  }
  const refusal = await fake(() => [200, { stop_reason: 'refusal', content: [] }])
  try { await assert.rejects(ask(claude(refusal.api), 's', 'u'), /declined/) } finally { refusal.server.close() }
})

test('spots a key pasted under the wrong provider, before sending anything', async () => {
  assert.match(keyProblem({ provider: 'anthropic', key: 'gsk_abc' }), /looks like a Groq key.*Choose Groq/)
  assert.match(keyProblem({ provider: 'groq', key: 'sk-ant-abc' }), /looks like a Claude \(Anthropic\) key.*Choose Claude/)
  assert.match(keyProblem({ provider: 'groq', key: 'xai-abc' }), /xAI Grok key.*does not use xAI Grok/)
  assert.equal(keyProblem({ provider: 'groq', key: 'gsk_abc' }), '')
  assert.equal(keyProblem({ provider: 'anthropic', key: 'sk-ant-abc' }), '')
  assert.equal(keyProblem({ provider: 'groq', key: 'something-unrecognised' }), '')
  const { seen, server, api } = await fake(() => groqText('x'))
  try {
    await assert.rejects(ask({ provider: 'groq', key: 'xai-abc', api }, 's', 'u'), /xAI Grok key/)
    assert.equal(seen.length, 0, 'nothing is sent with a key that cannot work')
  } finally { server.close() }
})

test('reads a list even when the model adds words around it', () => {
  assert.deepEqual(parseList('Here you go:\n["one", "two"]\nHope that helps!', 2), ['one', 'two'])
  assert.throws(() => parseList('no list here', 1), /did not return a list/)
  assert.throws(() => parseList('["a"]', 2), /wrong number/)
  assert.throws(() => parseList('[not json]', 1), /could not be read/)
})

for (const [name, cfgOf, textOf] of [['Groq', groq, groqText], ['Claude', claude, claudeText]]) {
  test(`${name}: replaces opening lines, keeping the template where the model breaks a rule`, async () => {
    const { seen, server, api } = await fake(() =>
      textOf(JSON.stringify(['It sounds like quitting and coming back is the hard part.', 'visit https://example.com'])))
    try {
      const result = { people: [{ comment: 'I quit and came back', opener: 'OPENER-1' }, { comment: 'I scroll too much', opener: 'OPENER-2' }] }
      const lines = []
      const used = await improve(cfgOf(api), result, async (l) => lines.push(l))
      assert.deepEqual(result.people.map((p) => p.opener), ['It sounds like quitting and coming back is the hard part.', 'OPENER-2'])
      assert.equal(used, 1)
      assert.equal(seen.length, 1, 'one request for all opening lines')
      assert.equal(systemOf(seen[0].body), OPENER_SYSTEM)
      assert.deepEqual(JSON.parse(userOf(seen[0].body)), ['I quit and came back', 'I scroll too much'])
      assert.ok(lines.some((l) => new RegExp(`${name} wrote 1 opening lines`).test(l)), lines.join('|'))
    } finally { server.close() }
  })

  test(`${name}: a failing provider never breaks the run; the templates stay and the reason is logged`, async () => {
    const { server, api } = await fake(() => [401, {}])
    try {
      const result = { people: [{ comment: 'y', opener: 'OPENER' }] }
      const lines = []
      assert.equal(await improve(cfgOf(api), result, async (l) => lines.push(l)), 0)
      assert.equal(result.people[0].opener, 'OPENER')
      assert.ok(lines.some((l) => /did not accept the API key/.test(l)))
    } finally { server.close() }
  })

  test(`${name}: the settings check makes one tiny real request and names the model`, async () => {
    const { seen, server, api } = await fake(() => textOf('OK'))
    try {
      const model = await check(cfgOf(api))
      assert.equal(seen.length, 1)
      assert.equal(model, { Groq: 'openai/gpt-oss-20b', Claude: 'claude-haiku-5-5' }[name])
    } finally { server.close() }
    const empty = await fake(() => textOf(''))
    try { await assert.rejects(check(cfgOf(empty.api)), /answered with nothing/) } finally { empty.server.close() }
  })
}

test('makes no request when there is nothing to improve', async () => {
  const { seen, server, api } = await fake(() => groqText('[]'))
  try {
    await improve(groq(api), { people: [] })
    assert.equal(seen.length, 0)
  } finally { server.close() }
})

test('pickRelevant keeps only the comments the model marks true, and asks in groups of 25', async () => {
  const { seen, server, api } = await fake((body) => groqText(JSON.stringify(JSON.parse(userOf(body)).map((t) => /my habit/.test(t) ? true : t === 'maybe' ? 'true' : false))))
  try {
    const rows = [
      { handle: 'a', text: 'my habit is scrolling all night' },
      { handle: 'b', text: 'haha so funny' },
      { handle: 'c', text: 'maybe' },
      ...Array.from({ length: 30 }, (_, i) => ({ handle: 'x' + i, text: i === 29 ? 'my habit again' : 'lol' })),
    ]
    const kept = await pickRelevant(groq(api), rows)
    assert.deepEqual(kept.map((r) => r.handle), ['a', 'x29'], 'only a real true counts, not the string "true"')
    assert.equal(seen.length, 2)
    assert.equal(systemOf(seen[0].body), JUDGE_SYSTEM)
    assert.equal(JSON.parse(userOf(seen[0].body)).length, 25)
  } finally { server.close() }
})

test('pickRelevant throws when the model fails or answers the wrong number of items, so unchecked comments are never kept', async () => {
  const down = await fake(() => [401, {}])
  try { await assert.rejects(pickRelevant(groq(down.api), [{ handle: 'a', text: 'x' }]), /did not accept the API key/) } finally { down.server.close() }
  const short = await fake(() => groqText('[true]'))
  try { await assert.rejects(pickRelevant(groq(short.api), [{ handle: 'a', text: 'x' }, { handle: 'b', text: 'y' }]), /wrong number/) } finally { short.server.close() }
})
