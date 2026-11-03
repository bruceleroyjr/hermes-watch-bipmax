// PROTOTYPE (1.6.16): when the phone doesn't answer even after the 15 s wake wait, drop the app's
// message link to the phone service (zml stop) and set it up again (zml connect), then try once more.
// The watch's Bluetooth radio can't be reset from an app; this only rebuilds the app-level link, so
// whether it clears a wedge is what the link log (shared/linklog.js) is there to show.
// Plain JS, so it runs on the watch and in Node tests.

export const RECON_MIN_GAP_MS = 3 * 60 * 1000 // at most one automatic reconnect per 3 minutes
export const RECON_SETTLE_MS = 600 // pause between dropping and re-making the link
export const RECON_RETRY_MS = 8000 // the one extra wake-wait after a reconnect (15 + 0.6 + 8 stays under 30 s)

const errText = (e) => (e && e.message ? e.message : String(e))
// "shake timeout": the phone service never answered the handshake. "timeout in 30000ms": it took the
// request and the reply never came back. Not "ble disconnect": the watch itself says there is no link.
const WORTH = /shake timeout|timeout in \d+\s*ms/i

export function shouldReconnect(error, now, lastAt, minGapMs = RECON_MIN_GAP_MS) {
  if (!WORTH.test(errText(error))) return false
  return !lastAt || now - lastAt >= minGapMs
}
