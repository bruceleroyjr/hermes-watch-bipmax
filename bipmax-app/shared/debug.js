// true: the phone and watch write voice/request status lines into the PC's relay log (POST
// /watch/diag), for debugging. Off by default - each line is extra Bluetooth and network traffic.
export const DIAG = false

// true: the preview card shows a small grey line with where the seconds went (watch -> phone, phone -> PC,
// Whisper), so a slow voice turn can be traced from a photo of the watch. Off once the speed work is done.
export const TIMING = false

// 'total 3.4s: watch>phone 1.2, phone>PC 1.5, Whisper 0.7' from the watch's own clock (total, ms), the phone's
// round trip (phone_ms) and the PC's numbers (ms = {pc, stt}). Missing parts are left out.
export function timingLine(total, reply) {
  const s = (ms) => (Math.max(0, ms) / 1000).toFixed(1)
  const parts = []
  if (reply.phone_ms) parts.push(`watch>phone ${s(total - reply.phone_ms)}`)
  if (reply.phone_ms && reply.ms) parts.push(`phone>PC ${s(reply.phone_ms - reply.ms.pc)}`)
  if (reply.ms) parts.push(`Whisper ${s(reply.ms.stt)}`)
  return `total ${s(total)}s: ${parts.join(', ')}`
}

// true (1.6.16 prototype test): 5 s after the app opens, the watch rebuilds its link to the phone once
// (shared/reconnect.js) and sends one small request, and the result goes into the link log - to prove the
// reconnect leaves a working link working. Set to false once that is confirmed in the relay log.
export const RECON_SELFTEST = false

// false: the app no longer rebuilds its phone link by itself after a failed request. A test showed
// it doesn't help (the link was stuck below the app; only a watch Bluetooth toggle cleared it) and it costs
// about 9 s per failure. The code stays (page/index.js reconnectLink) in case a different kind of stall shows up.
export const AUTO_RECONNECT = false
