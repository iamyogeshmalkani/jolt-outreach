import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { OPENER_SYSTEM, REPLY_SYSTEM, ask, check, draft, keyProblem, parseList, providerOf } from '../lib/ai.js'
import { normalize } from '../lib/settings.js'

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
// The shapes the two providers document: Groq answers like OpenAI chat completions, xAI like the Responses API.
const groqText = (t) => [200, { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: t, reasoning: 'thinking it over' } }] }]
const xaiText = (t) => [200, { status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: t }] }] }]
const thread = (body) => (Array.isArray(body.messages) ? body.messages : Array.isArray(body.input) ? body.input : [])
const systemOf = (body) => thread(body).find((m) => m.role === 'system')?.content ?? body.input
const userOf = (body) => thread(body).find((m) => m.role === 'user').content
const groq = (api, extra = {}) => ({ provider: 'groq', key: 'gsk_test', api, ...extra })
const xai = (api, extra = {}) => ({ provider: 'xai', key: 'xai-test', api, ...extra })
const item = (n, top = true) => ({ sub: 'nosurf', title: `Post ${n}`, body: `Body ${n}`, comment: '', opener: `FALLBACK-${n}`, top: top ? { author: `u${n}`, body: `Comment ${n} about quitting scrolling` } : null })
const GOOD_REPLY = 'That balance between wanting to stay informed and wanting your attention back is hard. What would a good day on your phone look like?'

test('a key from the other provider is spotted before anything is sent', async () => {
  assert.match(keyProblem({ provider: 'xai', key: 'gsk_abc' }), /looks like a Groq key \(it starts with gsk_\).*Choose Groq/)
  assert.match(keyProblem({ provider: 'groq', key: 'xai-abc' }), /looks like a Grok \(xAI\) key.*Choose Grok \(xAI\)/)
  assert.equal(keyProblem({ provider: 'groq', key: 'gsk_abc' }), '')
  assert.equal(keyProblem({ provider: 'xai', key: 'xai-abc' }), '')
  assert.equal(keyProblem({ provider: 'xai', key: 'something-else' }), '')
  const { seen, server, api } = await fake(() => xaiText('x'))
  try {
    await assert.rejects(ask({ provider: 'xai', key: 'gsk_abc', api }, 's', 'u', 100), /looks like a Groq key/)
    assert.equal(seen.length, 0, 'nothing is sent with a key that cannot work')
  } finally { server.close() }
})

test('Groq is the default provider', () => {
  assert.equal(providerOf({}).label, 'Groq')
  assert.equal(providerOf({ provider: 'nonsense' }).label, 'Groq')
})

test('Groq: sends an OpenAI-style chat request and reads the message content', async () => {
  const { seen, server, api } = await fake(() => groqText('["x"]'))
  try {
    assert.equal(await ask(groq(api), 'be brief', '["caption"]', 500), '["x"]')
    const [{ url, headers, body }] = seen
    assert.equal(url, '/openai/v1/chat/completions')
    assert.equal(headers.authorization, 'Bearer gsk_test')
    assert.equal(body.model, 'openai/gpt-oss-20b')
    assert.deepEqual(body.messages, [{ role: 'system', content: 'be brief' }, { role: 'user', content: '["caption"]' }])
    assert.equal(body.reasoning_effort, 'low')
    assert.ok(body.max_completion_tokens >= 2000, 'room for the model\'s thinking as well as its answer')
    for (const unwanted of ['input', 'system', 'max_output_tokens']) assert.ok(!(unwanted in body), unwanted)
  } finally { server.close() }
})

test('Groq: retries in a plainer form if the extra settings are rejected, and explains failures', async () => {
  const { seen, server, api } = await fake((body) => (body.reasoning_effort ? [400, { error: { message: 'unsupported parameter' } }] : groqText('ok')))
  try {
    assert.equal(await ask(groq(api, { model: 'llama-3.3-70b-versatile' }), 's', 'u', 100), 'ok')
    assert.equal(seen.length, 2)
    assert.ok(!('reasoning_effort' in seen[1].body) && seen[1].body.max_tokens >= 1500)
  } finally { server.close() }
  for (const [status, want] of [[401, /Groq did not accept the API key\. Check that it is a Groq key \(it starts with gsk_\)/], [429, /limiting requests/], [404, /does not know this model/], [403, /no credit or quota/]]) {
    const f = await fake(() => [status, {}])
    try { await assert.rejects(ask(groq(f.api), 's', 'u', 100), want) } finally { f.server.close() }
  }
  const cut = await fake(() => [200, { choices: [{ finish_reason: 'length', message: { content: '' } }] }])
  try { await assert.rejects(ask(groq(cut.api), 's', 'u', 100), /ran out of room/) } finally { cut.server.close() }
  await assert.rejects(ask(groq('http://127.0.0.1:1'), 's', 'u', 100), /Could not reach Groq/)
})

test('Grok (xAI): sends the documented request and reads the message text, skipping reasoning items', async () => {
  const { seen, server, api } = await fake(() => xaiText('["x"]'))
  try {
    assert.equal(await ask(xai(api), 'be brief', '["caption"]', 500), '["x"]')
    const [{ url, headers, body }] = seen
    assert.equal(url, '/v1/responses')
    assert.equal(headers.authorization, 'Bearer xai-test')
    assert.equal(body.model, 'grok-4.20-0309-non-reasoning')
    assert.deepEqual(body.input, [{ role: 'system', content: 'be brief' }, { role: 'user', content: '["caption"]' }])
    assert.equal(body.max_output_tokens, 500)
    for (const unwanted of ['messages', 'max_tokens', 'reasoning_effort']) assert.ok(!(unwanted in body), unwanted)
  } finally { server.close() }
})

test('Grok (xAI): a plain string if the message form is rejected, and a clear message for a wrong key', async () => {
  const { seen, server, api } = await fake((body) => (Array.isArray(body.input) ? [400, { error: { message: 'bad input' } }] : xaiText('ok')))
  try {
    assert.equal(await ask(xai(api, { model: 'grok-4.3' }), 'sys', 'usr', 100), 'ok')
    assert.equal(seen[1].body.input, 'sys\n\nusr')
  } finally { server.close() }
  const f = await fake(() => [401, { error: 'Incorrect API key provided. You can obtain an API key from https://console.x.ai.' }])
  try { await assert.rejects(ask(xai(f.api), 's', 'u', 100), /Grok \(xAI\) did not accept the API key.*console\.x\.ai/) } finally { f.server.close() }
})

test('reads a list even when the model adds words around it', () => {
  assert.deepEqual(parseList('Here you go:\n["one", "two"]\nHope that helps!', 2), ['one', 'two'])
  assert.throws(() => parseList('no list', 1), /did not return a list/)
  assert.throws(() => parseList('["a"]', 2), /wrong number/)
  assert.throws(() => parseList('[nope]', 1), /could not be read/)
})

for (const [name, cfgOf, textOf] of [['Groq', groq, groqText], ['Grok (xAI)', xai, xaiText]]) {
  test(`${name}: drafts a reply for every post and an opening line for every post that has a commenter`, async () => {
    const { seen, server, api } = await fake((body) => {
      const n = JSON.parse(userOf(body)).length
      return textOf(JSON.stringify(Array.from({ length: n }, (_, i) => (systemOf(body) === REPLY_SYSTEM ? GOOD_REPLY + ` (${i})` : `Your point about quitting really landed (${i}).`))))
    })
    try {
      const items = [item(1), item(2, false), item(3)]
      const lines = []
      const used = await draft(cfgOf(api), items, async (l) => lines.push(l))
      assert.deepEqual(used, { comments: 3, openers: 2 })
      assert.ok(items.every((i) => i.comment.startsWith('That balance')))
      assert.deepEqual(items.map((i) => i.opener), ['Your point about quitting really landed (0).', 'FALLBACK-2', 'Your point about quitting really landed (1).'])
      const replyCall = seen.find((s) => systemOf(s.body) === REPLY_SYSTEM)
      assert.deepEqual(JSON.parse(userOf(replyCall.body))[0], { subreddit: 'nosurf', title: 'Post 1', body: 'Body 1' })
      const openerCall = seen.find((s) => systemOf(s.body) === OPENER_SYSTEM)
      assert.deepEqual(JSON.parse(userOf(openerCall.body)).map((x) => x.comment), ['Comment 1 about quitting scrolling', 'Comment 3 about quitting scrolling'])
      assert.ok(lines.some((l) => l.includes(`${name} wrote 3 replies and 2 opening lines`)), lines.join('|'))
    } finally { server.close() }
  })

  test(`${name}: keeps the fallback wherever the model breaks a rule`, async () => {
    const { server, api } = await fake((body) =>
      textOf(JSON.stringify(systemOf(body) === REPLY_SYSTEM
        ? [GOOD_REPLY, 'Try Jolt, it helps with exactly this problem for people.', 'See https://example.com for the full guide on doing this properly.']
        : ['visit https://example.com', 'short'])))
    try {
      const items = [item(1), item(2), item(3)]
      items[2].top = null
      const used = await draft(cfgOf(api), items)
      assert.deepEqual(items.map((i) => i.comment), [GOOD_REPLY, '', ''])
      assert.deepEqual(items.map((i) => i.opener), ['FALLBACK-1', 'FALLBACK-2', 'FALLBACK-3'])
      assert.deepEqual(used, { comments: 1, openers: 0 })
    } finally { server.close() }
  })

  test(`${name}: a failing provider never breaks the run; nothing is drafted and the reason is logged`, async () => {
    const { server, api } = await fake(() => [401, {}])
    try {
      const items = [item(1)]
      const lines = []
      assert.deepEqual(await draft(cfgOf(api), items, async (l) => lines.push(l)), { comments: 0, openers: 0 })
      assert.equal(items[0].comment, '')
      assert.equal(items[0].opener, 'FALLBACK-1')
      assert.equal(lines.filter((l) => /did not accept the API key/.test(l)).length, 2)
    } finally { server.close() }
  })

  test(`${name}: the settings check makes one tiny real request and names the model`, async () => {
    const { seen, server, api } = await fake(() => textOf('OK'))
    try {
      assert.equal(await check(cfgOf(api)), name === 'Groq' ? 'openai/gpt-oss-20b' : 'grok-4.20-0309-non-reasoning')
      assert.equal(seen.length, 1)
    } finally { server.close() }
    const empty = await fake(() => textOf(''))
    try { await assert.rejects(check(cfgOf(empty.api)), /answered with nothing/) } finally { empty.server.close() }
  })
}

test('works through many posts in batches', async () => {
  const { seen, server, api } = await fake((body) => groqText(JSON.stringify(Array.from({ length: JSON.parse(userOf(body)).length }, () => GOOD_REPLY))))
  try {
    const items = Array.from({ length: 11 }, (_, i) => item(i, false))
    await draft(groq(api), items)
    assert.deepEqual(seen.map((s) => JSON.parse(userOf(s.body)).length), [8, 3], 'eight at a time')
  } finally { server.close() }
})

test('an older saved key (typed into the xAI box) keeps working, and a Groq key goes to Groq', () => {
  assert.deepEqual([normalize({ xaiKey: 'gsk_abc' }).provider, normalize({ xaiKey: 'gsk_abc' }).aiKey], ['groq', 'gsk_abc'])
  assert.deepEqual([normalize({ xaiKey: 'xai-abc' }).provider, normalize({ xaiKey: 'xai-abc' }).aiKey], ['xai', 'xai-abc'])
  assert.equal(normalize({ xaiKey: 'xai-abc', provider: 'groq' }).provider, 'groq', 'an explicit choice is kept')
  assert.equal(normalize({}).provider, 'groq')
  assert.ok(!('xaiKey' in normalize({ xaiKey: 'x' })))
})

test('the sync repo is filled in, so only a token is needed; an empty box means the usual repo', () => {
  assert.equal(normalize({}).syncRepo, 'iamyogeshmalkani/jolt-reddit-data')
  assert.equal(normalize({ syncRepo: '' }).syncRepo, 'iamyogeshmalkani/jolt-reddit-data')
  assert.equal(normalize({ syncRepo: '   ' }).syncRepo, 'iamyogeshmalkani/jolt-reddit-data')
  assert.equal(normalize({ syncRepo: 'team/other-data' }).syncRepo, 'team/other-data')
})
