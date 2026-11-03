// Which screen the watch shows for a relay reply (relay API: README.md).
// Plain JS, so it runs on the watch and in Node tests.

export function screenFor(reply) {
  if (!reply) return { screen: 'error', heard: '', text: 'No answer from the phone. Is the Zepp app running?' }
  if (!reply.ok) return { screen: 'error', heard: '', text: reply.error || 'Something went wrong.' }
  // A recording turned into text, not yet sent to Hermes: the watch shows it with Send / Cancel.
  // where = the GPS header of the recording, kept so the Send still carries it.
  if (reply.kind === 'transcript') {
    if (!reply.heard) return { screen: 'error', heard: '', text: "I didn't catch that. Tap TALK to try again." }
    return { screen: 'preview', heard: '', text: reply.heard, ...(reply.where ? { where: reply.where } : {}), ...(reply.timing ? { timing: reply.timing } : {}) }
  }
  const heard = reply.heard ? `You said: ${reply.heard}` : ''
  // Voice on: the relay's id for the spoken version (and its clip count when split in two)
  const speech = reply.speech ? { speech: reply.speech, ...(reply.speechParts > 1 ? { speechParts: reply.speechParts } : {}) } : {}
  if (reply.kind === 'confirm') {
    return { screen: 'confirm', heard, text: reply.text, id: reply.id, ...(reply.approve ? { approve: true } : {}),
      ...(reply.ttlMs ? { ttlMs: reply.ttlMs } : {}), ...speech }
  }
  if (reply.kind === 'working') {
    return { screen: 'working', heard, text: 'Still working on it...', job: reply.job, ...(reply.note ? { note: reply.note } : {}) }
  }
  // rate: the relay's id for the thumbs up / down under the answer (none on errors and notices)
  return { screen: 'answer', heard, text: reply.text || '', ...speech, ...(reply.rate ? { rate: reply.rate } : {}) }
}

// Reopening the app (the watch closes it when the screen times out) brings back the last
// screen while the relay's Hermes session is still alive (6 h idle). Yes/No ids last as long as the
// relay says (ttlMs: 5 min for Hermes questions) or 60 s (car, texts); Approve cards as long as
// Hermes waits for an approval (5 min).
export const RESUME_MS = 6 * 60 * 60 * 1000
export const CARD_MS = 55 * 1000
export const APPROVE_MS = 4.5 * 60 * 1000
export const JOB_RESUME_MS = 30 * 60 * 1000 // the relay keeps a job (running or finished) this long

// saved = {at, since?, model} -> null (start screen) | {show: model} | {fetchLast: since, heard} | {resumeJob: model, since}
export function resumeFor(saved, now) {
  if (!saved || !saved.model || !(now - saved.at < RESUME_MS)) return null
  const m = saved.model
  if (m.screen === 'error') return null // a stale error looked like a stuck app after a reboot
  if (/^meeting/.test(m.screen)) return null // meeting recording moved to the Meeting Recorder app; a screen saved by an older version is dropped
  // A slow question the relay turned into a job: keep polling that job (it runs on the PC while the watch is off).
  if (m.screen === 'working' && m.job && now - (saved.since || saved.at) < JOB_RESUME_MS) return { resumeJob: m, since: saved.since || saved.at }
  if (m.screen === 'thinking' || m.screen === 'working') return { fetchLast: saved.since || saved.at, heard: m.heard || '' }
  // reopening always starts listening. The last answer, the idle screen, the session list and an
  // expired card are not brought back (past answers are in the sessions list); only a question still waiting for its
  // reply (above), a live Yes/No or Approve card, and a transcript waiting for Send survive a reopen.
  if (m.screen === 'confirm') {
    return now - saved.at > (m.approve ? APPROVE_MS : m.ttlMs ? m.ttlMs - 5000 : CARD_MS) ? null : { show: m }
  }
  if (m.screen !== 'preview') return null
  return { show: m }
}

// The relay's /watch/last says how long ago it replied; only a reply after the question counts.
export function lastIsNew(last, since, now) {
  return !!(last && last.ok && last.kind !== 'none' && now - (last.ago_ms || 0) >= since - 2000)
}

// One poll for a slow answer: keep waiting while Hermes works; a dropped connection
// (no reply, or the side service's retry flag) is retried until 5 in a row.
const MAX_POLL_FAILURES = 5

export function pollStep(reply, failures) {
  if (reply && reply.ok && reply.kind === 'working') return { done: false, failures: 0 }
  if (!reply || (!reply.ok && reply.retry)) {
    if (failures + 1 < MAX_POLL_FAILURES) return { done: false, failures: failures + 1 }
  }
  return { done: true, reply }
}
