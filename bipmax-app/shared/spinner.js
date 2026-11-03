// The "Thinking" / "Still working" animation: a ring of dots around the round screen with a
// bright head chasing around it and a fading tail. Plain JS, so it runs on the watch and in
// Node tests; page/index.js recolours the dots on a timer.

// n dots evenly on a circle, the first at 12 o'clock, going clockwise.
export function ringDots(n, cx, cy, r) {
  const dots = []
  for (let i = 0; i < n; i++) {
    const a = (i * 2 * Math.PI) / n
    dots.push({ x: Math.round(cx + r * Math.sin(a)), y: Math.round(cy - r * Math.cos(a)) })
  }
  return dots
}

// n dots evenly spaced along the edge of a rounded-rectangle screen (the Bip Max is square with
// big rounded corners), the first at 12 o'clock, going clockwise. `inset` is the distance of the
// dot centres from the screen edge, `corner` the screen's corner radius.
export function ringDotsRect(n, w, h, inset, corner) {
  const r = Math.max(1, corner - inset)
  const left = inset, right = w - inset, top = inset, bottom = h - inset
  const quarter = (cx, cy, from) => {
    const pts = []
    for (let k = 1; k <= 24; k++) {
      const a = from + (k * Math.PI) / 2 / 24
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
    }
    return pts
  }
  const line = (a, b) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const pts = []
    const steps = Math.max(1, Math.round(len / 4))
    for (let k = 1; k <= steps; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps })
    return pts
  }
  // Clockwise from the top middle.
  const path = [{ x: w / 2, y: top }]
  const add = (pts) => path.push(...pts)
  add(line({ x: w / 2, y: top }, { x: right - r, y: top }))
  add(quarter(right - r, top + r, -Math.PI / 2))
  add(line({ x: right, y: top + r }, { x: right, y: bottom - r }))
  add(quarter(right - r, bottom - r, 0))
  add(line({ x: right - r, y: bottom }, { x: left + r, y: bottom }))
  add(quarter(left + r, bottom - r, Math.PI / 2))
  add(line({ x: left, y: bottom - r }, { x: left, y: top + r }))
  add(quarter(left + r, top + r, Math.PI))
  add(line({ x: left + r, y: top }, { x: w / 2, y: top }))
  const cum = [0]
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y))
  const total = cum[cum.length - 1]
  const dots = []
  let j = 0
  for (let i = 0; i < n; i++) {
    const at = (i * total) / n
    while (j < cum.length - 1 && cum[j + 1] < at) j++
    dots.push({ x: Math.round(path[j].x), y: Math.round(path[j].y) })
  }
  return dots
}

// Colour between a (t = 0) and b (t = 1), channel by channel.
export function blend(a, b, t) {
  let out = 0
  for (const shift of [16, 8, 0]) {
    const x = (a >> shift) & 0xff
    const y = (b >> shift) & 0xff
    out |= Math.round(x + (y - x) * t) << shift
  }
  return out
}

// Dot colours for one animation step: the head is dot (step % n); the `tail` dots behind it
// fade from head to dim; the rest are dim.
export function dotColors(step, n, head, dim, tail) {
  const h = step % n
  const colors = []
  for (let i = 0; i < n; i++) {
    const behind = (h - i + n) % n
    colors.push(behind < tail ? blend(dim, head, 1 - behind / tail) : dim)
  }
  return colors
}

export function elapsedText(ms) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function dotsText(step) {
  return '.'.repeat((step % 3) + 1)
}

// Playful labels for the waiting screen. Short enough for one 32 px line with the dots. Blue = thinking, gold = a long job.
export const THINKING_WORDS = [
  'Musing', 'Pondering', 'Percolating', 'Conjuring', 'Divining', 'Mulling', 'Brewing', 'Noodling',
  'Ruminating', 'Scheming', 'Winging it', 'Consulting', 'Deliberating', 'Cogitating', 'Tinkering',
]
export const WORKING_WORDS = [
  'Still at it', 'Marinating', 'Simmering', 'Untangling', 'Deep diving', 'Flying back', 'Crunching',
  'Spelunking', 'Wrangling', 'Excavating', 'Assembling', 'Almost there',
]

// The word to show `ms` into the wait: a new one every `everyMs`, starting at `offset`.
export function statusWord(words, ms, offset = 0, everyMs = 3000) {
  return words[(offset + Math.floor(ms / everyMs)) % words.length]
}
