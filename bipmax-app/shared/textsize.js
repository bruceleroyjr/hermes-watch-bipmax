// Text size of the email body on the watch, picked with a slider in the phone settings (setting/index.js) and
// kept in Settings Storage under TEXT_SIZE_KEY as a percent. The side service sends the scale with every message.
// Plain JS, so the settings page, the side service and Node tests share it.

export const TEXT_SIZE_KEY = 'textSizePercent'
export const TEXT_SIZE_MIN = 100
export const TEXT_SIZE_MAX = 200
export const TEXT_SIZE_STEP = 10

// stored value (a number or a string, maybe JSON-quoted) -> percent, clamped to the slider range, 100 when unknown
export function textSizePercent(raw) {
  let v = raw
  try {
    if (typeof v === 'string' && /^[["]/.test(v)) v = JSON.parse(v)
  } catch (e) {}
  if (Array.isArray(v)) v = v[0]
  const n = Number(v)
  if (!isFinite(n) || n <= 0) return TEXT_SIZE_MIN
  return Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, Math.round(n)))
}

export function textScale(raw) {
  return textSizePercent(raw) / 100
}
