// Run: node --test test/connection.test.mjs
import test from 'node:test'
import assert from 'node:assert'
import { normalizeRelayUrl, cleanToken, readConnection, RELAY_URL_KEY, TOKEN_KEY } from '../shared/connection.js'

test('normalizeRelayUrl: scheme, trailing slash and pasted paths', () => {
  assert.strictEqual(normalizeRelayUrl('https://my-pc.tail1234.ts.net:8453'), 'https://my-pc.tail1234.ts.net:8453')
  assert.strictEqual(normalizeRelayUrl('  my-pc.tail1234.ts.net:8453/  '), 'https://my-pc.tail1234.ts.net:8453')
  assert.strictEqual(normalizeRelayUrl('HTTPS://My-PC.ts.net/watch/ask?x=1'), 'https://my-pc.ts.net')
  assert.strictEqual(normalizeRelayUrl('http://100.64.0.5:8796'), 'http://100.64.0.5:8796')
  assert.strictEqual(normalizeRelayUrl('"https://a.ts.net:8453"'), 'https://a.ts.net:8453') // JSON-quoted by the storage
})

test('normalizeRelayUrl: junk is rejected', () => {
  for (const v of [undefined, null, '', '   ', 'ftp://x', 'https://', 'not a url', 'https://bad host', 'https://a.ts.net:abc']) {
    assert.strictEqual(normalizeRelayUrl(v), '', String(v))
  }
})

test('cleanToken: trims and drops a pasted "Bearer "', () => {
  assert.strictEqual(cleanToken('  abc123  '), 'abc123')
  assert.strictEqual(cleanToken('Bearer abc123'), 'abc123')
  assert.strictEqual(cleanToken(undefined), '')
})

test('readConnection: says what is missing', () => {
  const store = (o) => ({ getItem: (k) => o[k] })
  assert.match(readConnection(store({})).error, /not set up/)
  assert.match(readConnection(store({ [TOKEN_KEY]: 't' })).error, /relay URL/)
  assert.match(readConnection(store({ [RELAY_URL_KEY]: 'a.ts.net:8453' })).error, /token is missing/)
  const ok = readConnection(store({ [RELAY_URL_KEY]: 'a.ts.net:8453', [TOKEN_KEY]: 't' }))
  assert.deepStrictEqual(ok, { relay: 'https://a.ts.net:8453', token: 't', error: '' })
})
