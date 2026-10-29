import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { checkAccess, fetchKnown, mergeLists, publish } from '../lib/github.js'

// A small stand-in for GitHub's Contents API, including the "someone else saved first" conflict.
function fakeGitHub({ files = {}, conflictOnce = false, pushAllowed = true, branchExists = true } = {}) {
  const state = { files: { ...files }, puts: [], conflicted: false }
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const url = new URL(req.url, 'http://x')
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
      if (req.headers.authorization !== 'Bearer good') return send(401, {})
      const file = /\/contents\/(.+)$/.exec(url.pathname)?.[1]
      if (file && req.method === 'GET') {
        const f = state.files[file]
        return f ? send(200, { sha: f.sha, content: Buffer.from(f.text).toString('base64') + '\n' }) : send(404, {})
      }
      if (file && req.method === 'PUT') {
        const data = JSON.parse(body)
        state.puts.push({ file, data })
        if (conflictOnce && !state.conflicted) { state.conflicted = true; state.files[file] = { sha: 'newer', text: JSON.stringify([{ handle: 'concurrent' }]) }; return send(409, {}) }
        if (state.files[file] && data.sha !== state.files[file].sha) return send(409, {})
        state.files[file] = { sha: 'sha' + state.puts.length, text: Buffer.from(data.content, 'base64').toString('utf8') }
        return send(200, {})
      }
      if (url.pathname.endsWith('/branches/data')) return branchExists ? send(200, {}) : send(404, {})
      if (/\/repos\/[^/]+\/[^/]+$/.test(url.pathname)) return send(200, { full_name: 'o/r', permissions: { push: pushAllowed } })
      send(404, {})
    })
  })
  return new Promise((resolve) => server.listen(0, () => resolve({ state, server, api: `http://127.0.0.1:${server.address().port}` })))
}
const cfg = (api, token = 'good') => ({ repo: 'o/r', token, api })

test('merges new items in front, without duplicates, within the cap', () => {
  const out = mergeLists([{ k: 'b' }, { k: 'a' }], [{ k: 'a' }, { k: 'c' }, { k: 'd' }], (x) => x.k, 3)
  assert.deepEqual(out.map((x) => x.k), ['b', 'a', 'c'])
})

test('publishes people and keeps what was already there, including non-English text', async () => {
  const { state, server, api } = await fakeGitHub({ files: { 'people.json': { sha: 's0', text: JSON.stringify([{ handle: 'old', comment: 'ça va' }]) } } })
  try {
    const saved = await publish(cfg(api), { people: [{ handle: 'New', comment: 'I scroll 😭' }, { handle: 'old' }] })
    assert.equal(saved.people, 2)
    const written = JSON.parse(state.files['people.json'].text)
    assert.deepEqual(written.map((p) => p.handle), ['New', 'old'])
    assert.equal(state.puts[0].data.branch, 'data')
    assert.equal(written[0].comment, 'I scroll 😭')
  } finally { server.close() }
})

test('creates a file that does not exist yet', async () => {
  const { state, server, api } = await fakeGitHub()
  try {
    await publish(cfg(api), { videos: [{ url: 'https://tiktok.com/@a/video/1', creator: 'a' }] })
    assert.equal(JSON.parse(state.files['videos.json'].text).length, 1)
    assert.equal(state.puts[0].data.sha, undefined)
  } finally { server.close() }
})

test('retries after a conflict and keeps the other writer\'s data', async () => {
  const { state, server, api } = await fakeGitHub({ files: { 'people.json': { sha: 's0', text: '[]' } }, conflictOnce: true })
  try {
    await publish(cfg(api), { people: [{ handle: 'mine' }] })
    assert.deepEqual(JSON.parse(state.files['people.json'].text).map((p) => p.handle), ['mine', 'concurrent'])
    assert.equal(state.puts.length, 2)
  } finally { server.close() }
})

test('explains a rejected token and a missing branch in plain words', async () => {
  const { server, api } = await fakeGitHub()
  try {
    await assert.rejects(publish(cfg(api, 'bad'), { people: [{ handle: 'x' }] }), /did not accept the token/)
  } finally { server.close() }
  const missing = await fakeGitHub({ branchExists: false })
  try {
    await assert.rejects(publish(cfg(missing.api), { people: [{ handle: 'x' }] }), /could not find the repo or its data branch/)
  } finally { missing.server.close() }
})

test('knows what is already published', async () => {
  const { server, api } = await fakeGitHub({ files: {
    'people.json': { sha: 'a', text: JSON.stringify([{ handle: 'Someone' }]) },
    'videos.json': { sha: 'b', text: JSON.stringify([{ url: 'u1', creator: 'Maker' }]) },
  } })
  try {
    const known = await fetchKnown(cfg(api))
    assert.ok(known.handles.has('someone') && known.urls.has('u1') && known.creators.has('maker'))
  } finally { server.close() }
})

test('checks that the token can write', async () => {
  const ok = await fakeGitHub({ files: { 'people.json': { sha: 'a', text: '[]' } } })
  try { assert.equal(await checkAccess(cfg(ok.api)), 'o/r') } finally { ok.server.close() }
  const ro = await fakeGitHub({ pushAllowed: false })
  try { await assert.rejects(checkAccess(cfg(ro.api)), /can read the repo but not write/) } finally { ro.server.close() }
})
