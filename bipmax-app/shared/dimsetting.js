// Idle dim: how long the Hermes app can sit untouched before the watch screen goes black. Picked with a slider in the
// phone settings (setting/index.js), kept in Settings Storage under DIM_KEY in seconds. The side service hands it to the
// watch ('settings' request) and the watch remembers it for the next open. Plain JS, shared with Node tests.

export const DIM_KEY = 'dimAfterSeconds'
export const DIM_MIN = 60
export const DIM_MAX = 300
export const DIM_STEP = 60
export const DIM_DEFAULT = 60

// stored value (a number or a string, maybe JSON-quoted) -> seconds, clamped to the slider range (1 to 5 min), 60 when unknown
export function dimSeconds(raw) {
  let v = raw
  try {
    if (typeof v === 'string' && /^[["]/.test(v)) v = JSON.parse(v)
  } catch (e) {}
  if (Array.isArray(v)) v = v[0]
  const n = Number(v)
  if (v === null || v === undefined || v === '' || !isFinite(n) || n <= 0) return DIM_DEFAULT
  return Math.min(DIM_MAX, Math.max(DIM_MIN, Math.round(n)))
}

// 60 -> "1 min", 120 -> "2 min"; seconds are kept for odd stored values
export function dimLabel(s) {
  const m = Math.floor(s / 60)
  const r = s % 60
  if (!m) return `${r} s`
  return r ? `${m} min ${r} s` : `${m} min`
}
