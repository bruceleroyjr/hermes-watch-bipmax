// Run (in zepp-app-bipmax): node --test test/*.test.mjs
import test from 'node:test'
import assert from 'node:assert'
import { shouldReconnect, RECON_MIN_GAP_MS } from '../shared/reconnect.js'

test('a stuck phone service or a lost reply is worth a reconnect', () => {
  assert.ok(shouldReconnect(new Error('shake timeout'), 1000, 0))
  assert.ok(shouldReconnect(new Error('request id=10001 timeout in 30000ms'), 1000, 0))
  assert.ok(shouldReconnect('Shake Timeout', 1000, 0))
})

test('no link at all, or unrelated errors, are not', () => {
  assert.ok(!shouldReconnect(new Error('ble disconnect'), 1000, 0))
  assert.ok(!shouldReconnect(new Error('HTTP 500'), 1000, 0))
  assert.ok(!shouldReconnect(null, 1000, 0))
})

test('at most one reconnect per gap', () => {
  const e = new Error('shake timeout')
  assert.ok(!shouldReconnect(e, 1000 + RECON_MIN_GAP_MS - 1, 1000))
  assert.ok(shouldReconnect(e, 1000 + RECON_MIN_GAP_MS, 1000))
})
