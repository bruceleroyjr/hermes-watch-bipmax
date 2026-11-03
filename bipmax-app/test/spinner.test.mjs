// Run: node --test test/
import test from 'node:test'
import assert from 'node:assert'
import { ringDots, ringDotsRect, dotColors, blend, elapsedText, dotsText, statusWord, THINKING_WORDS, WORKING_WORDS } from '../shared/spinner.js'

test('dots sit evenly on a circle, first at 12 o\'clock', () => {
  const d = ringDots(4, 233, 233, 200)
  assert.deepStrictEqual(d, [{ x: 233, y: 33 }, { x: 433, y: 233 }, { x: 233, y: 433 }, { x: 33, y: 233 }])
})

test('the square-screen ring: first dot at the top middle, even spacing, clockwise, inside the screen and the rounded corners', () => {
  const W = 432, H = 514, inset = 18, corner = 106
  const d = ringDotsRect(20, W, H, inset, corner)
  assert.strictEqual(d.length, 20)
  assert.deepStrictEqual(d[0], { x: W / 2, y: inset })
  const cx = W / 2, cy = H / 2
  // clockwise: the angle round the centre only grows (starting at 12 o'clock)
  let last = -1
  for (const p of d) {
    const a = (Math.atan2(p.x - cx, -(p.y - cy)) + 2 * Math.PI) % (2 * Math.PI)
    assert.ok(a >= last, `dot at ${p.x},${p.y} is out of order`)
    last = a
  }
  const r = corner - inset
  for (const p of d) {
    assert.ok(p.x >= inset && p.x <= W - inset && p.y >= inset && p.y <= H - inset, `${p.x},${p.y} off the screen`)
    // in a corner square, a dot is on the corner arc (not past it)
    const qx = p.x < inset + r ? inset + r - p.x : p.x > W - inset - r ? p.x - (W - inset - r) : 0
    const qy = p.y < inset + r ? inset + r - p.y : p.y > H - inset - r ? p.y - (H - inset - r) : 0
    if (qx && qy) assert.ok(Math.hypot(qx, qy) <= r + 1.5, `${p.x},${p.y} sticks out of the corner`)
  }
  const gaps = d.map((p, i) => Math.hypot(p.x - d[(i + 1) % 20].x, p.y - d[(i + 1) % 20].y))
  assert.ok(Math.max(...gaps) - Math.min(...gaps) < 30, 'dots are roughly evenly spaced (chords shorten on the arcs)')
})

test('blend mixes two colours channel by channel', () => {
  assert.strictEqual(blend(0x000000, 0xffffff, 0), 0x000000)
  assert.strictEqual(blend(0x000000, 0xffffff, 1), 0xffffff)
  assert.strictEqual(blend(0x000000, 0x204060, 0.5), 0x102030)
})

test('the bright head moves one dot per step and its tail fades behind it', () => {
  const c = dotColors(2, 8, 0x7fd4ff, 0x101820, 4)
  assert.strictEqual(c[2], 0x7fd4ff) // head
  assert.ok(c[1] !== 0x101820 && c[1] !== 0x7fd4ff) // tail
  assert.strictEqual(c[3], 0x101820) // ahead of the head: dim
  assert.strictEqual(c[6], 0x101820)
  assert.strictEqual(dotColors(10, 8, 0x7fd4ff, 0x101820, 4)[2], 0x7fd4ff) // wraps around
})

test('tail brightness falls off with distance from the head', () => {
  const c = dotColors(0, 8, 0xffffff, 0x000000, 4)
  const level = (x) => x & 0xff
  assert.ok(level(c[0]) > level(c[7]) && level(c[7]) > level(c[6]) && level(c[6]) > level(c[5]))
  assert.strictEqual(c[4], 0x000000)
})

test('elapsed time reads m:ss', () => {
  assert.strictEqual(elapsedText(0), '0:00')
  assert.strictEqual(elapsedText(42500), '0:42')
  assert.strictEqual(elapsedText(125000), '2:05')
})

test('thinking dots cycle . .. ...', () => {
  assert.deepStrictEqual([0, 1, 2, 3].map(dotsText), ['.', '..', '...', '.'])
})

test('status word changes every 3 s, starts at the offset and wraps', () => {
  const w = ['a', 'b', 'c']
  assert.deepStrictEqual([0, 2999, 3000, 6000, 9000].map((ms) => statusWord(w, ms)), ['a', 'a', 'b', 'c', 'a'])
  assert.strictEqual(statusWord(w, 0, 2), 'c')
})

test('status words fit one line on the round screen', () => {
  for (const word of [...THINKING_WORDS, ...WORKING_WORDS]) assert.ok(word.length <= 13, word)
})
