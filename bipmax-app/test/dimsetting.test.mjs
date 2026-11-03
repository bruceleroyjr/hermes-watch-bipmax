// Run (in zepp-app-bipmax): node --test test/*.test.mjs
import test from 'node:test'
import assert from 'node:assert'
import { dimSeconds, dimLabel } from '../shared/dimsetting.js'

test('unknown or empty values give the 1 minute default', () => {
  for (const v of [undefined, null, '', 'abc', 0, -5]) assert.strictEqual(dimSeconds(v), 60)
})

test('values are clamped to 1 - 5 minutes and accept strings and JSON quoting', () => {
  assert.strictEqual(dimSeconds(10), 60)
  assert.strictEqual(dimSeconds('900'), 300)
  assert.strictEqual(dimSeconds('"120"'), 120)
  assert.strictEqual(dimSeconds('[180]'), 180)
  assert.strictEqual(dimSeconds(150), 150)
})

test('labels read as minutes', () => {
  assert.strictEqual(dimLabel(30), '30 s')
  assert.strictEqual(dimLabel(60), '1 min')
  assert.strictEqual(dimLabel(90), '1 min 30 s')
  assert.strictEqual(dimLabel(300), '5 min')
})
