// Run: node --test test/
import test from 'node:test'
import assert from 'node:assert'
import { whenText, shortTitle, sessionRows } from '../shared/sessions.js'

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime() / 1000
const now = new Date(2026, 9, 28, 20, 0)

test('whenText: today, yesterday, older', () => {
  assert.strictEqual(whenText(at(2026, 10, 28, 15, 42), now), '3:42 PM')
  assert.strictEqual(whenText(at(2026, 10, 27, 0, 5), now), 'Yesterday 12:05 AM')
  assert.strictEqual(whenText(at(2026, 10, 20, 9, 7), now), 'Oct 20 9:07 AM')
})

test('shortTitle: two card lines, never empty', () => {
  assert.strictEqual(shortTitle('Price of big cards'), 'Price of big cards')
  assert.strictEqual(shortTitle('Assess four-year-old son nosebleed cough illness and fever history today').length, 46)
  assert.strictEqual(shortTitle(''), 'Untitled')
})

test('sessionRows: max 10, marks the current one, tolerates bad replies', () => {
  const sessions = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, title: `T${i}`, last: at(2026, 10, 28, 8, 0), turns: i === 0 ? 1 : 3 }))
  const rows = sessionRows({ ok: true, current: 's1', sessions }, now)
  assert.strictEqual(rows.length, 10)
  assert.strictEqual(rows[0].sub, '8:00 AM · 1 question')
  assert.strictEqual(rows[1].sub, '8:00 AM · 3 questions')
  assert.deepStrictEqual(rows.filter(r => r.current).map(r => r.id), ['s1'])
  const withAnswer = sessionRows({ ok: true, sessions: [{ id: 'a', title: 'T', last: at(2026, 10, 28, 8, 0), turns: 2, answer: ' Done.\n It is   sent. ' }, { id: 'b', title: 'T', last: 1, turns: 1 }] }, now)
  assert.strictEqual(withAnswer[0].answer, 'Done. It is sent.')
  assert.strictEqual(withAnswer[1].answer, '')
  assert.deepStrictEqual(sessionRows(null), [])
  assert.deepStrictEqual(sessionRows({ ok: false }), [])
})
