import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { COMMENT_SYSTEM, OPENER_SYSTEM, ask, check, improve, parseList } from '../lib/llm.js'

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
const grokText = (t) => [200, { status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: t }] }] }]
const groqText = (t) => [200, { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: t, reasoning: 'thinking it over' } }] }]
const thread = (body) => (Array.isArray(body.messages) ? body.messages : Array.isArray(body.input) ? body.input : [])
const systemOf = (body) => body.system ?? (thread(body).find((m) => m.role === 'system')?.content ?? body.input)
const userOf = (body) => thread(body).find((m) => m.role === 'user').content
const groq = (api, extra = {}) => ({ provider: 'groq', key: 'gsk-test', api, ...extra })
const grok = (api, extra = {}) => ({ provider: 'xai', key: 'xai-test', api, ...extra })
const claude = (api, extra = {}) => ({ provider: 'anthropic', key: 'sk-test', api, ...extra })

test('Grok: sends the documented request and reads the message text, skipping reasoning items', async () => {
  const { seen, server, api } = await fake(() => grokText('["a comment that is long enough to keep"]'))
  try {
    assert.equal(await ask(grok(api), 'be brief', '["caption"]'), '["a comment that is long enough to keep"]')
    const [{ url, headers, body }] = seen
    assert.equal(url, '/v1/responses')
    assert.equal(headers.authorization, 'Bearer xai-test')
    assert.equal(body.model, 'grok-4.20-0309-non-reasoning')
    assert.deepEqual(body.input, [{ role: 'system', content: 'be brief' }, { role: 'user', content: '["caption"]' }])
    assert.ok(body.max_output_tokens >= 200)
    for (const unwanted of ['messages', 'max_tokens', 'output_config', 'thinking']) assert.ok(!(unwanted in body), unwanted)
  } finally { server.close() }
})

test('Grok: uses the model from settings, and a plain string if the message form is rejected', async () => {
  const { seen, server, api } = await fake((body) => (Array.isArray(body.input) ? [400, { error: { message: 'bad input' } }] : grokText('ok')))
  try {
    assert.equal(await ask(grok(api, { model: 'grok-4.3' }), 'sys', 'usr'), 'ok')
    assert.equal(seen.length, 2)
    assert.equal(seen[0].body.model, 'grok-4.3')
    assert.equal(seen[1].body.input, 'sys\n\nusr')
  } finally { server.close() }
})

test('Grok: explains common failures in plain words', async () => {
  const cases = [
    [401, {}, /Grok did not accept the API key/],
    [403, {}, /not allowed to use this model, or the account has no credit or quota/],
    [404, {}, /does not know this model/],
    [429, {}, /limiting requests, or the quota/],
    [402, {}, /spend limit, credit balance or free quota has run out/],
  ]
  for (const [status, json, want] of cases) {
    const { server, api } = await fake(() => [status, json])
    try { await assert.rejects(ask(grok(api), 's', 'u'), want) } finally { server.close() }
  }
  await assert.rejects(ask(grok('http://127.0.0.1:1'), 's', 'u'), /Could not reach Grok/)
})

test('Groq: sends an OpenAI-style chat request and reads the message content', async () => {
  const { seen, server, api } = await fake(() => groqText('["a comment that is long enough to keep"]'))
  try {
    assert.equal(await ask(groq(api), 'be brief', '["caption"]'), '["a comment that is long enough to keep"]')
    const [{ url, headers, body }] = seen
    assert.equal(url, '/openai/v1/chat/completions')
    assert.equal(headers.authorization, 'Bearer gsk-test')
    assert.equal(body.model, 'openai/gpt-oss-20b')
    assert.deepEqual(body.messages, [{ role: 'system', content: 'be brief' }, { role: 'user', content: '["caption"]' }])
    assert.equal(body.reasoning_effort, 'low')
    assert.ok(body.max_completion_tokens >= 1500, 'room for the model\'s thinking as well as its answer')
    for (const unwanted of ['input', 'system', 'temperature', 'max_output_tokens']) assert.ok(!(unwanted in body), unwanted)
  } finally { server.close() }
})

test('Groq: retries in a plainer form if the extra settings are rejected, and explains failures', async () => {
  const { seen, server, api } = await fake((body) => (body.reasoning_effort ? [400, { error: { message: 'unsupported parameter' } }] : groqText('ok')))
  try {
    assert.equal(await ask(groq(api, { model: 'llama-3.3-70b-versatile' }), 's', 'u'), 'ok')
    assert.equal(seen.length, 2)
    assert.equal(seen[1].body.model, 'llama-3.3-70b-versatile')
    assert.ok(!('reasoning_effort' in seen[1].body) && !('max_completion_tokens' in seen[1].body) && seen[1].body.max_tokens >= 1500)
  } finally { server.close() }
  for (const [status, want] of [[401, /Groq did not accept the API key/], [429, /limiting requests, or the quota/], [404, /does not know this model/]]) {
    const f = await fake(() => [status, {}])
    try { await assert.rejects(ask(groq(f.api), 's', 'u'), want) } finally { f.server.close() }
  }
  const cut = await fake(() => [200, { choices: [{ finish_reason: 'length', message: { content: '' } }] }])
  try { await assert.rejects(ask(groq(cut.api), 's', 'u'), /ran out of room/) } finally { cut.server.close() }
  await assert.rejects(ask(groq('http://127.0.0.1:1'), 's', 'u'), /Could not reach Groq/)
})

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

test('reads a list even when the model adds words around it', () => {
  assert.deepEqual(parseList('Here you go:\n["one", "two"]\nHope that helps!', 2), ['one', 'two'])
  assert.throws(() => parseList('no list here', 1), /did not return a list/)
  assert.throws(() => parseList('["a"]', 2), /wrong number/)
  assert.throws(() => parseList('[not json]', 1), /could not be read/)
})

for (const [name, cfgOf, textOf] of [['Groq', groq, groqText], ['Grok', grok, grokText], ['Claude', claude, claudeText]]) {
  test(`${name}: replaces drafts and opening lines, keeping the template where the model breaks a rule`, async () => {
    const { seen, server, api } = await fake((body) => {
      if (systemOf(body) === COMMENT_SYSTEM) {
        return textOf(JSON.stringify(['What would make the first week of a detox actually feel doable?', 'Check out Jolt, link in bio']))
      }
      return textOf(JSON.stringify(['It sounds like quitting and coming back is the hard part.', 'visit https://example.com']))
    })
    try {
      const result = {
        videos: [{ caption: 'my dopamine detox', draft: 'TEMPLATE-1' }, { caption: 'doomscrolling', draft: 'TEMPLATE-2' }],
        people: [{ comment: 'I quit and came back', opener: 'OPENER-1' }, { comment: 'I scroll too much', opener: 'OPENER-2' }],
      }
      const lines = []
      const used = await improve(cfgOf(api), result, async (l) => lines.push(l))
      assert.deepEqual(result.videos.map((v) => v.draft), ['What would make the first week of a detox actually feel doable?', 'TEMPLATE-2'])
      assert.deepEqual(result.people.map((p) => p.opener), ['It sounds like quitting and coming back is the hard part.', 'OPENER-2'])
      assert.deepEqual(used, { comments: 1, openers: 1 })
      assert.equal(seen.length, 2, 'one request for all comments, one for all openers')
      assert.deepEqual(JSON.parse(userOf(seen[0].body)), ['my dopamine detox', 'doomscrolling'])
      assert.ok(seen.some((s) => systemOf(s.body) === OPENER_SYSTEM))
      assert.ok(lines.some((l) => new RegExp(`${name} wrote 1 draft comments and 1 opening lines`).test(l)), lines.join('|'))
    } finally { server.close() }
  })

  test(`${name}: a failing provider never breaks the run; the templates stay and the reason is logged`, async () => {
    const { server, api } = await fake(() => [401, {}])
    try {
      const result = { videos: [{ caption: 'x', draft: 'TEMPLATE' }], people: [{ comment: 'y', opener: 'OPENER' }] }
      const lines = []
      const used = await improve(cfgOf(api), result, async (l) => lines.push(l))
      assert.equal(result.videos[0].draft, 'TEMPLATE')
      assert.equal(result.people[0].opener, 'OPENER')
      assert.deepEqual(used, { comments: 0, openers: 0 })
      assert.equal(lines.filter((l) => /did not accept the API key/.test(l)).length, 2)
    } finally { server.close() }
  })

  test(`${name}: the settings check makes one tiny real request and names the model`, async () => {
    const { seen, server, api } = await fake(() => textOf('OK'))
    try {
      const model = await check(cfgOf(api))
      assert.equal(seen.length, 1)
      assert.equal(model, { Groq: 'openai/gpt-oss-20b', Grok: 'grok-4.20-0309-non-reasoning', Claude: 'claude-haiku-5-5' }[name])
    } finally { server.close() }
    const empty = await fake(() => textOf(''))
    try { await assert.rejects(check(cfgOf(empty.api)), /answered with nothing/) } finally { empty.server.close() }
  })
}

test('makes no request when there is nothing to improve', async () => {
  const { seen, server, api } = await fake(() => grokText('[]'))
  try {
    await improve(grok(api), { videos: [], people: [] })
    assert.equal(seen.length, 0)
  } finally { server.close() }
})
