// "Listen when Hermes opens": a phone-settings toggle, OFF by default. When on, a fresh open of
// the app goes straight to the listening screen; when off it shows the idle screen and waits for a TALK tap.
// The phone stores the toggle under AUTO_LISTEN_KEY ('true'/'false'); the side service hands it to the watch
// ('settings' request) and the watch remembers it for the next open. Plain JS, shared with Node tests.

export const AUTO_LISTEN_KEY = 'autoListen'

// stored value (boolean or string, maybe JSON-quoted) -> true only when clearly on; anything unknown is off
export function autoListenOn(raw) {
  let v = raw
  try {
    if (typeof v === 'string' && /^[["]/.test(v)) v = JSON.parse(v)
  } catch (e) {}
  if (Array.isArray(v)) v = v[0]
  return v === true || v === 'true' || v === 1 || v === '1'
}
