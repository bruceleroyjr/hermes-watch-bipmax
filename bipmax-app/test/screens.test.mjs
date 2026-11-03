// Run: node --test test/
import test from 'node:test'
import assert from 'node:assert'
import { screenFor, pollStep, resumeFor, lastIsNew, RESUME_MS, JOB_RESUME_MS, CARD_MS, APPROVE_MS } from '../shared/screens.js'

const NOW = 1_800_000_000_000

test('a spoken reply keeps its speech id (answers and Yes/No cards)', () => {
  assert.deepStrictEqual(screenFor({ ok: true, kind: 'answer', text: 'Hi', speech: 's1' }),
    { screen: 'answer', heard: '', text: 'Hi', speech: 's1' })
  assert.strictEqual(screenFor({ ok: true, kind: 'confirm', text: 'Text Alex: hi?', id: 'c', speech: 's2' }).speech, 's2')
})

test('a long spoken reply keeps how many clips it has', () => {
  assert.deepStrictEqual(screenFor({ ok: true, kind: 'answer', text: 'Long...', speech: 's3', speechParts: 2 }),
    { screen: 'answer', heard: '', text: 'Long...', speech: 's3', speechParts: 2 })
})

test('an answer keeps its rate id (thumbs up / down); a notice without one has none', () => {
  assert.deepStrictEqual(screenFor({ ok: true, kind: 'answer', text: 'Sunny.', rate: 'r1', speech: 's1' }),
    { screen: 'answer', heard: '', text: 'Sunny.', speech: 's1', rate: 'r1' })
  assert.strictEqual('rate' in screenFor({ ok: true, kind: 'answer', text: 'New session started.' }), false)
  const saved = { screen: 'answer', heard: '', text: 'Sunny.', rate: 'r1', rated: 'down' }
})

test('approval card keeps approve; working keeps the relay note', () => {
  assert.deepStrictEqual(screenFor({ ok: true, kind: 'confirm', approve: true, text: 'Claude Code wants to change files', id: 'a1' }),
    { screen: 'confirm', heard: '', text: 'Claude Code wants to change files', id: 'a1', approve: true })
  assert.deepStrictEqual(screenFor({ ok: true, kind: 'working', job: 'j', note: 'You can close the app' }),
    { screen: 'working', heard: '', text: 'Still working on it...', job: 'j', note: 'You can close the app' })
})

test('resume: an Approve card stays live for Hermes\' 5-minute approval wait', () => {
  const model = { screen: 'confirm', heard: '', text: 'Claude Code wants to change files', id: 'a1', approve: true }
  assert.deepStrictEqual(resumeFor({ at: NOW - 3 * 60 * 1000, model }, NOW), { show: model })
  assert.strictEqual(resumeFor({ at: NOW - APPROVE_MS - 1, model }, NOW), null) // expired: back to listening
})

test('resume: nothing saved, or older than the Hermes session -> start screen', () => {
  assert.strictEqual(resumeFor(null, NOW), null)
  assert.strictEqual(resumeFor({ at: NOW - RESUME_MS - 1, model: { screen: 'answer', heard: '', text: 'x' } }, NOW), null)
})

test('resume: an error is never brought back (it looked stuck after a reboot)', () => {
  assert.strictEqual(resumeFor({ at: NOW - 1000, model: { screen: 'error', heard: '', text: 'No answer from the phone.' } }, NOW), null)
})

test('resume: the last answer, idle and the sessions list are not brought back - reopen starts listening', () => {
  for (const model of [{ screen: 'answer', heard: 'You said: hi', text: 'Hello' }, { screen: 'idle' }, { screen: 'sessions', rows: [] }]) {
    assert.strictEqual(resumeFor({ at: NOW - 60000, model }, NOW), null)
  }
})

test('resume: a transcript waiting for Send still comes back', () => {
  const model = { screen: 'preview', heard: '', text: 'hi' }
  assert.deepStrictEqual(resumeFor({ at: NOW - 60000, model }, NOW), { show: model })
})

test('resume: a fresh Yes/No card comes back; an expired one is dropped', () => {
  const model = { screen: 'confirm', heard: 'You said: text wife', text: 'Text wife: hi?', id: 'c1' }
  assert.deepStrictEqual(resumeFor({ at: NOW - 10000, model }, NOW), { show: model })
  assert.strictEqual(resumeFor({ at: NOW - CARD_MS - 1, model }, NOW), null)
})

test('resume: thinking or working -> ask the PC for the reply it kept', () => {
  assert.deepStrictEqual(resumeFor({ at: NOW - 5000, since: NOW - 9000, model: { screen: 'thinking', heard: '' } }, NOW),
    { fetchLast: NOW - 9000, heard: '' })
  // a job without an id (or older than the relay keeps it) falls back to the last reply
  assert.deepStrictEqual(resumeFor({ at: NOW - 5000, since: NOW - 9000, model: { screen: 'working', heard: 'You said: x' } }, NOW),
    { fetchLast: NOW - 9000, heard: 'You said: x' })
  assert.deepStrictEqual(resumeFor({ at: NOW - 5000, since: NOW - JOB_RESUME_MS - 1, model: { screen: 'working', heard: 'x', job: 'j' } }, NOW),
    { fetchLast: NOW - JOB_RESUME_MS - 1, heard: 'x' })
})

test('resume: a running job is polled again, even hours of watch-off later (within the relay keep time)', () => {
  const model = { screen: 'working', heard: 'You said: x', text: 'Still working on it...', job: 'j' }
  assert.deepStrictEqual(resumeFor({ at: NOW - 5000, since: NOW - 9000, model }, NOW), { resumeJob: model, since: NOW - 9000 })
  assert.deepStrictEqual(resumeFor({ at: NOW - 20 * 60 * 1000, since: NOW - 25 * 60 * 1000, model }, NOW), { resumeJob: model, since: NOW - 25 * 60 * 1000 })
})

test('last reply only counts if it came after the question (in the watch clock)', () => {
  assert.strictEqual(lastIsNew({ ok: true, kind: 'answer', ago_ms: 1000 }, NOW - 5000, NOW), true)
  assert.strictEqual(lastIsNew({ ok: true, kind: 'answer', ago_ms: 60000 }, NOW - 5000, NOW), false)
  assert.strictEqual(lastIsNew({ ok: true, kind: 'none' }, NOW - 5000, NOW), false)
  assert.strictEqual(lastIsNew(null, NOW - 5000, NOW), false)
})

test('answer', () => {
  assert.deepStrictEqual(screenFor({ ok: true, heard: 'hi there', kind: 'answer', text: 'Hello Sam' }),
    { screen: 'answer', heard: 'You said: hi there', text: 'Hello Sam' })
})

test('answer without heard (after a confirm)', () => {
  assert.deepStrictEqual(screenFor({ ok: true, kind: 'answer', text: 'Sent to wife.' }),
    { screen: 'answer', heard: '', text: 'Sent to wife.' })
})

test('confirm keeps the id', () => {
  assert.deepStrictEqual(screenFor({ ok: true, heard: 'unlock the car', kind: 'confirm', text: 'Unlock the car?', id: 'abc' }),
    { screen: 'confirm', heard: 'You said: unlock the car', text: 'Unlock the car?', id: 'abc' })
})

test('working keeps the job', () => {
  assert.deepStrictEqual(screenFor({ ok: true, heard: 'slow one', kind: 'working', job: 'j1' }),
    { screen: 'working', heard: 'You said: slow one', text: 'Still working on it...', job: 'j1' })
})

test('ok:false is an error with its reason', () => {
  assert.deepStrictEqual(screenFor({ ok: false, error: "Can't reach the PC (is Tailscale on?)" }),
    { screen: 'error', heard: '', text: "Can't reach the PC (is Tailscale on?)" })
})

test('no reply is an error', () => {
  assert.deepStrictEqual(screenFor(undefined), { screen: 'error', heard: '', text: 'No answer from the phone. Is the Zepp app running?' })
})

test('poll: working keeps waiting and clears failures', () => {
  assert.deepStrictEqual(pollStep({ ok: true, kind: 'working' }, 2), { done: false, failures: 0 })
})

test('poll: a dropped connection is retried', () => {
  assert.deepStrictEqual(pollStep({ ok: false, error: "Can't reach the PC (is Tailscale on?)", retry: true }, 0), { done: false, failures: 1 })
  assert.deepStrictEqual(pollStep(undefined, 3), { done: false, failures: 4 })
})

test('poll: gives up after 5 dropped connections in a row', () => {
  const r = { ok: false, error: "Can't reach the PC (is Tailscale on?)", retry: true }
  assert.deepStrictEqual(pollStep(r, 4), { done: true, reply: r })
})

test('poll: an answer or a real error ends it', () => {
  const a = { ok: true, kind: 'answer', text: 'hi' }
  assert.deepStrictEqual(pollStep(a, 3), { done: true, reply: a })
  const e = { ok: false, error: 'The watch token was rejected by the PC.' }
  assert.deepStrictEqual(pollStep(e, 0), { done: true, reply: e })
})

test('a card keeps the relay\'s lifetime (Hermes questions: 5 min) for screens and reopening', () => {
  const m = screenFor({ ok: true, kind: 'confirm', text: 'Add it?', id: 'c1', ttlMs: 300000 })
  assert.strictEqual(m.ttlMs, 300000)
  assert.deepStrictEqual(resumeFor({ at: NOW - 120000, model: m }, NOW), { show: m })
  assert.strictEqual(resumeFor({ at: NOW - 300000, model: m }, NOW), null) // expired: back to listening
})

test('a transcript becomes a preview card (Send / Cancel); an empty one is an error', () => {
  assert.deepStrictEqual(screenFor({ ok: true, kind: 'transcript', heard: 'call mom', where: { gps: 'no fix yet' } }),
    { screen: 'preview', heard: '', text: 'call mom', where: { gps: 'no fix yet' } })
  assert.strictEqual(screenFor({ ok: true, kind: 'transcript', heard: '' }).screen, 'error')
})

test('the timing line splits the wait into watch>phone, phone>PC and Whisper', async () => {
  const { timingLine } = await import('../shared/debug.js')
  assert.strictEqual(timingLine(3400, { phone_ms: 2000, ms: { pc: 900, stt: 700 } }),
    'total 3.4s: watch>phone 1.4, phone>PC 1.1, Whisper 0.7')
  assert.strictEqual(timingLine(3000, {}), 'total 3.0s: ')
  assert.strictEqual(screenFor({ ok: true, kind: 'transcript', heard: 'hi', timing: 'total 1s' }).timing, 'total 1s')
})

test('a meeting screen saved by an older version is not resumed (recording moved to the Meeting Recorder app)', () => {
  for (const screen of ['meeting', 'meeting-stop', 'meeting-wait', 'meeting-black', 'meeting-cancel', 'meeting-notes']) {
    assert.strictEqual(resumeFor({ at: 1000, model: { screen, meeting: 'm-abc123' } }, 2000), null)
  }
})
