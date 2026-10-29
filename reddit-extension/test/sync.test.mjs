import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {
  LOCAL_ONLY, MAX_ITEMS, SYNC_FILE, checkSync, mergeItem, mergeItems, mergeSeen, mergeSettings, mergeStates, readLocal, sameState, syncFromSettings, syncNow, writeLocal,
} from '../lib/sync.js'

const item = (id, over = {}) => ({
  id, sub: 'nosurf', title: `Post ${id}`, comment: 'a reply', opener: 'an opener', top: { author: 'alice' },
  dmStatus: 'To send', commentStatus: 'To post', dmAt: 0, commentAt: 0, foundAt: 1000, ...over,
})

// A chrome.storage.local stand-in.
const memoryStore = (initial = {}) => {
  const data = structuredClone(initial)
  return {
    data,
    async get(keys) {
      const list = typeof keys === 'string' ? [keys] : keys
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]))
    },
    async set(obj) { Object.assign(data, structuredClone(obj)) },
  }
}

// A stand-in for GitHub's contents API for one repo.
function fakeGitHub({ isPrivate = true, push = true, file = null } = {}) {
  const state = { file, sha: file ? 's0' : null, puts: 0, failNext: 0 }
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
      if (req.headers.authorization !== 'Bearer good') return send(401, {})
      if (req.url === '/repos/o/data') return send(200, { full_name: 'o/data', private: isPrivate, permissions: { push } })
      if (req.url === `/repos/o/data/contents/${SYNC_FILE}`) {
        if (req.method === 'GET') {
          return state.file ? send(200, { sha: state.sha, content: Buffer.from(state.file).toString('base64') + '\n' }) : send(404, {})
        }
        const body = JSON.parse(raw)
        if (state.failNext > 0) { state.failNext--; return send(409, {}) }
        if (state.file && body.sha !== state.sha) return send(409, {})
        state.file = Buffer.from(body.content, 'base64').toString('utf8')
        state.sha = 's' + ++state.puts
        return send(200, {})
      }
      send(404, {})
    })
  })
  return new Promise((resolve) => server.listen(0, () => resolve({ state, server, api: `http://127.0.0.1:${server.address().port}` })))
}
const cfg = (api, token = 'good') => ({ repo: 'o/data', token, api })
const remoteData = (state) => JSON.parse(state.file)

test('two devices changing different parts of one post both keep their change', () => {
  const base = item('p1')
  const deviceA = { ...base, dmStatus: 'Sent', dmAt: 5000 }
  const deviceB = { ...base, commentStatus: 'Posted', commentAt: 6000 }
  for (const merged of [mergeItem(deviceA, deviceB), mergeItem(deviceB, deviceA)]) {
    assert.equal(merged.dmStatus, 'Sent')
    assert.equal(merged.commentStatus, 'Posted')
    assert.deepEqual([merged.dmAt, merged.commentAt], [5000, 6000])
  }
})

test('for the same part, the newest change wins on every device', () => {
  const a = item('p1', { dmStatus: 'Sent', dmAt: 5000 })
  const b = item('p1', { dmStatus: 'Replied', dmAt: 7000 })
  assert.equal(mergeItem(a, b).dmStatus, 'Replied')
  assert.equal(mergeItem(b, a).dmStatus, 'Replied')
})

test('"restore original" travels too: an edit removed on one device is removed on the other', () => {
  const edited = item('p1', { dmEdit: 'my own words', dmAt: 5000 })
  const restored = item('p1', { dmAt: 8000 }) // no dmEdit any more
  assert.ok(!('dmEdit' in mergeItem(edited, restored)))
  assert.ok(!('dmEdit' in mergeItem(restored, edited)))
  assert.equal(mergeItem(item('p1', { dmEdit: 'newer', dmAt: 9000 }), item('p1', { dmAt: 8000 })).dmEdit, 'newer')
})

test('equally new versions resolve the same way whichever side merges them, so devices never ping-pong', () => {
  const a = item('p1', { dmStatus: 'Sent', dmAt: 5000 })
  const b = item('p1', { dmStatus: 'Skip', dmAt: 5000 })
  assert.deepEqual(mergeItem(a, b), mergeItem(b, a))
  const x = [item('p1'), item('p2', { foundAt: 3000 })]
  const y = [item('p2', { foundAt: 3000, dmStatus: 'Sent', dmAt: 1 }), item('p3', { foundAt: 2000 })]
  assert.deepEqual(mergeItems(x, y), mergeItems(y, x))
  assert.deepEqual(mergeItems(mergeItems(x, y), y), mergeItems(x, y), 'merging again changes nothing')
})

test('a post found on only one device is kept, newest first, and the list is capped', () => {
  const merged = mergeItems([item('a', { foundAt: 1 })], [item('b', { foundAt: 3 }), item('c', { foundAt: 2 })])
  assert.deepEqual(merged.map((i) => i.id), ['b', 'c', 'a'])
  const many = Array.from({ length: MAX_ITEMS + 40 }, (_, i) => item('p' + i, { foundAt: i }))
  const capped = mergeItems(many, [])
  assert.equal(capped.length, MAX_ITEMS)
  assert.equal(capped[0].id, 'p' + (MAX_ITEMS + 39), 'the newest are kept')
})

test('what has been seen is combined', () => {
  assert.deepEqual(mergeSeen({ posts: ['b', 'a'], authors: ['x'] }, { posts: ['c', 'a'], authors: ['y'] }), { posts: ['a', 'b', 'c'], authors: ['x', 'y'] })
  assert.deepEqual(mergeSeen(undefined, { posts: ['a'] }), { posts: ['a'], authors: [] })
})

test('the most recently saved settings win as a whole', () => {
  const old = { subs: 'nosurf', settingsAt: 100 }
  const recent = { subs: 'nosurf, digitalminimalism', settingsAt: 200 }
  assert.equal(mergeSettings(old, recent).subs, 'nosurf, digitalminimalism')
  assert.equal(mergeSettings(recent, old).subs, 'nosurf, digitalminimalism')
})

test('keys and tokens never leave the device', async () => {
  const store = memoryStore({
    settings: { subs: 'nosurf', aiKey: 'gsk_secret', syncToken: 'ghp_secret', syncRepo: 'o/data', xaiKey: 'xai-secret', redditBase: 'http://x', aiApi: 'http://y', name: 'Isha', settingsAt: 5 },
    items: [], seen: {},
  })
  const local = await readLocal(store)
  assert.deepEqual(Object.keys(local.settings).sort(), ['name', 'settingsAt', 'subs'])
  for (const k of LOCAL_ONLY) assert.ok(!(k in local.settings), k)
  // and a settings change pulled from another device does not touch this device's own keys
  await writeLocal(store, { items: [], seen: {}, settings: { subs: 'phoneaddiction', name: 'Yogesh', settingsAt: 9, aiKey: 'EVIL' } })
  assert.equal(store.data.settings.subs, 'phoneaddiction')
  assert.equal(store.data.settings.aiKey, 'gsk_secret')
  assert.equal(store.data.settings.syncToken, 'ghp_secret')
})

test('the first sync creates the file; a second sync with nothing new writes nothing', async () => {
  const { state, server, api } = await fakeGitHub()
  try {
    const store = memoryStore({ items: [item('p1')], seen: { posts: ['p1'], authors: ['alice'] }, settings: { subs: 'nosurf', settingsAt: 3 } })
    assert.deepEqual(await syncNow(store, cfg(api)), { pushed: true, pulled: false, items: 1 })
    assert.equal(remoteData(state).items[0].id, 'p1')
    assert.equal(remoteData(state).settings.subs, 'nosurf')
    assert.deepEqual(await syncNow(store, cfg(api)), { pushed: false, pulled: false, items: 1 })
    assert.equal(state.puts, 1, 'no needless commits')
  } finally { server.close() }
})

test('a second device receives what the first one shared, and shares its own', async () => {
  const { state, server, api } = await fakeGitHub()
  try {
    const a = memoryStore({ items: [item('p1', { foundAt: 1 })], seen: { posts: ['p1'] }, settings: { subs: 'nosurf', settingsAt: 1 } })
    const b = memoryStore({ items: [item('p2', { foundAt: 2 })], seen: { posts: ['p2'] }, settings: { subs: 'old', settingsAt: 0, aiKey: 'B-KEY' } })
    await syncNow(a, cfg(api))
    const r = await syncNow(b, cfg(api))
    assert.deepEqual([r.pushed, r.pulled], [true, true])
    assert.deepEqual(b.data.items.map((i) => i.id), ['p2', 'p1'])
    assert.equal(b.data.settings.subs, 'nosurf', 'the newer settings arrive')
    assert.equal(b.data.settings.aiKey, 'B-KEY', 'its own key is untouched')
    await syncNow(a, cfg(api))
    assert.deepEqual(a.data.items.map((i) => i.id), ['p2', 'p1'])
    assert.ok(!JSON.stringify(remoteData(state)).includes('B-KEY'), 'no key was uploaded')
  } finally { server.close() }
})

test('devices working at the same time lose nothing: a conflict is read and merged again', async () => {
  const { state, server, api } = await fakeGitHub()
  try {
    const a = memoryStore({ items: [item('p1', { dmStatus: 'Sent', dmAt: 5000 })], seen: {}, settings: {} })
    const b = memoryStore({ items: [item('p1', { commentStatus: 'Posted', commentAt: 6000 })], seen: {}, settings: {} })
    await syncNow(a, cfg(api))
    state.failNext = 1 // B's first save is rejected, as if another device saved just before
    await syncNow(b, cfg(api))
    await syncNow(a, cfg(api))
    for (const store of [a, b]) {
      assert.equal(store.data.items[0].dmStatus, 'Sent')
      assert.equal(store.data.items[0].commentStatus, 'Posted')
    }
    assert.deepEqual(remoteData(state).items[0].dmStatus, 'Sent')
  } finally { server.close() }
})

test('refuses a public repo, a read-only token and a wrong token, in plain words', async () => {
  const pub = await fakeGitHub({ isPrivate: false })
  try { await assert.rejects(checkSync(cfg(pub.api)), /public repo.*Use a private repo/) } finally { pub.server.close() }
  const ro = await fakeGitHub({ push: false })
  try { await assert.rejects(checkSync(cfg(ro.api)), /read the repo but not write/) } finally { ro.server.close() }
  const ok = await fakeGitHub()
  try {
    assert.equal(await checkSync(cfg(ok.api)), 'o/data')
    await assert.rejects(checkSync(cfg(ok.api, 'bad')), /did not accept the sync token/)
    await assert.rejects(syncNow(memoryStore(), { ...cfg(ok.api), repo: 'o/missing' }), /could not find the sync repo/)
  } finally { ok.server.close() }
  await assert.rejects(checkSync(cfg('http://127.0.0.1:1')), /Could not reach GitHub/)
})

test('a sync problem is remembered, not thrown, and nothing happens when sync is not set up', async () => {
  const store = memoryStore({ items: [item('p1')], seen: {}, settings: {} })
  assert.equal(await syncFromSettings(store, { syncRepo: '', syncToken: '' }), null)
  assert.ok(!('syncStatus' in store.data))
  const { server, api } = await fakeGitHub()
  try {
    assert.equal(await syncFromSettings(store, { syncRepo: 'o/data', syncToken: 'bad', syncApi: api }), null)
    assert.match(store.data.syncStatus.error, /did not accept the sync token/)
    assert.equal(store.data.items.length, 1, 'local data is untouched')
    assert.ok(await syncFromSettings(store, { syncRepo: 'o/data', syncToken: 'good', syncApi: api }))
    assert.equal(store.data.syncStatus.error, '')
  } finally { server.close() }
})

test('a hand-edited or damaged file is reported instead of being overwritten', async () => {
  const { server, api } = await fakeGitHub({ file: 'not json at all' })
  try { await assert.rejects(syncNow(memoryStore(), cfg(api)), /could not be read/) } finally { server.close() }
})

test('equal states are recognised as equal', () => {
  const s = { items: [item('p1')], seen: { posts: ['a'], authors: [] }, settings: { subs: 'x', settingsAt: 1 } }
  assert.ok(sameState(s, structuredClone(s)))
  assert.ok(!sameState(s, { ...s, items: [item('p1', { dmStatus: 'Sent', dmAt: 9 })] }))
})
