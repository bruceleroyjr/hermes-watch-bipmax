// Run (in zepp-app-bipmax): node --test test/*.test.mjs
import test from 'node:test'
import assert from 'node:assert'
import { linkRecord, linkPending, linkAck, linkOutcome, LINK_MAX, LINK_BATCH } from '../shared/linklog.js'

const memory = () => { const m = new Map(); return { getItem: (k, d) => (m.has(k) ? m.get(k) : d), setItem: (k, v) => m.set(k, v) } }

test('entries come back as relay-log lines, oldest first, in UTC', () => {
  const s = memory()
  linkRecord(s, 'open', 'v1 ble true', Date.UTC(2026, 10, 1, 17, 49, 3))
  linkRecord(s, 'fail', 'ask 15012 ms: shake timeout', Date.UTC(2026, 10, 1, 17, 50, 0))
  const p = linkPending(s)
  assert.strictEqual(p.count, 2)
  assert.deepStrictEqual(p.lines, ['link 17:49:03Z open v1 ble true', 'link 17:50:00Z fail ask 15012 ms: shake timeout'])
})

test('entries stay until acknowledged, so a failed send loses nothing', () => {
  const s = memory()
  for (let i = 0; i < 3; i++) linkRecord(s, 'wake', String(i), 1000 + i)
  assert.strictEqual(linkPending(s).count, 3)
  assert.strictEqual(linkPending(s).count, 3) // no ack yet
  linkAck(s, 2)
  assert.deepStrictEqual(linkPending(s).lines.map((l) => l.slice(-1)), ['2'])
})

test('only the newest LINK_MAX are kept and a batch never exceeds what the relay accepts', () => {
  const s = memory()
  for (let i = 0; i < LINK_MAX + 15; i++) linkRecord(s, 'dark', String(i), 1000 + i)
  const p = linkPending(s)
  assert.strictEqual(p.count, LINK_BATCH)
  assert.ok(p.lines[0].endsWith(' 15')) // the first 15 fell off
  linkAck(s, LINK_BATCH * 5)
  assert.strictEqual(linkPending(s).count, 0)
})

test('newlines and pipes in an error cannot make fake lines; long text is cut', () => {
  const s = memory()
  linkRecord(s, 'fail', 'a\nlink 00:00:00Z open x' + 'z'.repeat(300), 0)
  const [line] = linkPending(s).lines
  assert.ok(!line.includes('\n'))
  assert.ok(line.length < 140)
})

test('broken storage never throws', () => {
  const s = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('y') } }
  linkRecord(s, 'open', '')
  assert.deepStrictEqual(linkPending(s), { count: 0, lines: [] })
})

test('outcomes: failures always, successes only when slow or after a failure', () => {
  assert.strictEqual(linkOutcome('ask', 900, null, false), null)
  assert.strictEqual(linkOutcome('ask', 9000, null, false).kind, 'slow')
  assert.strictEqual(linkOutcome('ask', 900, null, true).kind, 'ok')
  const f = linkOutcome('ask', 15012, new Error('shake timeout'), false)
  assert.strictEqual(f.kind, 'fail')
  assert.ok(f.detail.includes('shake timeout') && f.detail.includes('15012'))
})
