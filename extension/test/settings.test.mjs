import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS, withDefaults } from '../lib/settings.js'

test('a Chrome with an older saved topic list gets the new topics once, and keeps its other settings', () => {
  const old = { token: 't', minViews: 5, keywords: ['doomscrolling'], competitors: { screenTime: ['Opal'] } }
  const s = withDefaults(old)
  assert.deepEqual(s.keywords, DEFAULTS.keywords)
  assert.equal(s.token, 't')
  assert.equal(s.minViews, 5)
  assert.ok(!('competitors' in s))
  const edited = withDefaults({ ...s, keywords: ['my own topic'] })
  assert.deepEqual(edited.keywords, ['my own topic'], 'once saved with the current version, edits are kept')
})

test('nothing saved gives the defaults', () => {
  assert.deepEqual(withDefaults().keywords, DEFAULTS.keywords)
  assert.ok(DEFAULTS.keywords.includes('microlearning app'))
})
