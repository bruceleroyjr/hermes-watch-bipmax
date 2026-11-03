// A small black box for the watch <-> iPhone link. The watch writes one short entry per link event
// (open, close, black-out, screen off, wake, failed or slow phone request, recovery) into its own
// storage, where it survives a wedge or a reboot, and sends the entries to the PC's relay log (POST
// /watch/diag) the next time a request gets through. So after a wedge the relay log shows what the watch
// saw in the minutes before it - which the relay never can, because nothing reached it.
// Plain JS (storage is passed in), so it runs on the watch and in Node tests.

export const LINK_KEY = 'link-log'
export const LINK_MAX = 60 // entries kept; the oldest fall off
export const LINK_BATCH = 20 // the relay keeps at most 20 lines per diag post
export const SLOW_MS = 8000 // a phone request slower than this is logged even when it worked

const clip = (s, n) => String(s == null ? '' : s).replace(/[\r\n|]+/g, ' ').trim().slice(0, n)

function load(store) {
  try {
    const list = JSON.parse(store.getItem(LINK_KEY, '[]') || '[]')
    return Array.isArray(list) ? list : []
  } catch (e) {
    return []
  }
}

function save(store, list) {
  try {
    store.setItem(LINK_KEY, JSON.stringify(list.slice(-LINK_MAX)))
  } catch (e) {}
}

// kind: short word (open, close, dark, off, wake, fail, slow, ok). detail: free text.
export function linkRecord(store, kind, detail = '', now = Date.now()) {
  const list = load(store)
  list.push([now, clip(kind, 12), clip(detail, 110)])
  save(store, list)
}

// The oldest LINK_BATCH entries as relay-log lines (UTC time, like the relay's own log); they stay in
// storage until linkAck, so a send that fails loses nothing.
export function linkPending(store) {
  const list = load(store).slice(0, LINK_BATCH)
  return { count: list.length, lines: list.map(([t, kind, detail]) => `link ${new Date(t).toISOString().slice(11, 19)}Z ${kind} ${detail}`.trim()) }
}

export function linkAck(store, count) {
  save(store, load(store).slice(count))
}

// What a finished phone request is worth logging: a failure always, a success only when it was slow or
// followed a failure (so the log shows when the link came back without a line for every poll).
export function linkOutcome(method, ms, error, wasFailing) {
  if (error) return { kind: 'fail', detail: `${clip(method, 16)} ${ms} ms: ${clip(error && error.message ? error.message : error, 80)}` }
  if (wasFailing) return { kind: 'ok', detail: `${clip(method, 16)} ${ms} ms (after failures)` }
  if (ms >= SLOW_MS) return { kind: 'slow', detail: `${clip(method, 16)} ${ms} ms` }
  return null
}
