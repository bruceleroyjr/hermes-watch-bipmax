// Run: node --test test/
import test from 'node:test'
import assert from 'node:assert'
import { toDecimal, makeFix, locationFor, MAX_AGE_MS } from '../shared/location.js'

test('toDecimal: numbers pass through, DMS objects convert with S/W negative', () => {
  assert.strictEqual(toDecimal(21.3069), 21.3069)
  assert.ok(Math.abs(toDecimal({ degrees: 21, minutes: 18, seconds: 25, direction: 'N' }) - 21.306944) < 1e-5)
  assert.ok(Math.abs(toDecimal({ degrees: 157, minutes: 51, seconds: 30, direction: 'W' }) + 157.858333) < 1e-5)
  assert.ok(Number.isNaN(toDecimal(undefined)))
})

test('makeFix: rejects empty (0,0), out-of-range and non-numbers', () => {
  assert.deepStrictEqual(makeFix(21.3, -157.8, 5), { lat: 21.3, lon: -157.8, at: 5 })
  assert.strictEqual(makeFix(0, 0, 5), null)
  assert.strictEqual(makeFix(91, 0.5, 5), null)
  assert.strictEqual(makeFix(21, 181, 5), null)
  assert.strictEqual(makeFix(undefined, -157.8, 5), null)
})

test('locationFor: rounds to 5 decimals with age; too old or missing gives null', () => {
  const fix = { lat: 21.3069444, lon: -157.8583333, at: 1000 }
  assert.deepStrictEqual(locationFor(fix, 4000), { lat: 21.30694, lon: -157.85833, age_s: 3 })
  assert.strictEqual(locationFor(fix, 1000 + MAX_AGE_MS + 1), null)
  assert.strictEqual(locationFor(null, 4000), null)
  assert.strictEqual(locationFor({ ...fix, at: 10 * 60 * 1000 }, 0), null) // clock went backwards
})
