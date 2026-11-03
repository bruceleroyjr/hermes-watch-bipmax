// Run: node --test test/autolisten.test.mjs
import test from 'node:test'
import assert from 'node:assert'
import { autoListenOn } from '../shared/autolisten.js'

test('autoListenOn: off unless clearly on', () => {
  for (const v of [undefined, null, '', 'false', false, 0, '0', 'garbage', '[false]']) assert.strictEqual(autoListenOn(v), false, String(v))
  for (const v of [true, 'true', 1, '1', '["true"]', '"true"', '[true]']) assert.strictEqual(autoListenOn(v), true, String(v))
})
