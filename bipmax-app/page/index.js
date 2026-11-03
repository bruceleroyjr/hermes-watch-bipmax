/*
 * Hermes on the Amazfit Bip Max (432 x 514, square with rounded corners). It talks to the relay
 * (relay.js) through the phone side service (app-side/index.js).
 *
 * Hermes on the watch: tap TALK, speak, tap STOP (stops by itself at 90 s). The recording
 * goes through the Zepp app on the phone to the PC (relay.js), which answers
 * with Hermes's reply, a Yes/No card for texts, emails and car commands, or a job id when
 * Hermes is slow (polled every 3 s for up to 10 min). Long answers scroll.
 * The watch closes the app when the screen times out; the current screen is saved and comes
 * back on reopen, and a reply that arrived meanwhile is fetched from the relay (/watch/last).
 * GPS is on the whole time the app is open; each question carries the
 * latest fix (shared/location.js) so Hermes knows where you are.
 */
import * as hmUI from '@zos/ui'
import { getDeviceInfo } from '@zos/device'
import { create, id, codec } from '@zos/media'
import { statSync, openSync, readSync, closeSync, rmSync, O_RDONLY } from '@zos/fs'
import { queryPermission, requestPermission } from '@zos/app'
import { connectStatus } from '@zos/ble'
import { scrollTo } from '@zos/page'
import { onGesture, offGesture, GESTURE_RIGHT } from '@zos/interaction'
import { localStorage } from '@zos/storage'
import { setPageBrightTime, resetPageBrightTime, pauseDropWristScreenOff, resetDropWristScreenOff, getBrightness, setBrightness, setScreenOff } from '@zos/display'
import { Vibrator, Geolocation, Battery } from '@zos/sensor'
import { BasePage } from '@zeppos/zml/base-page'
import { buildEnvelope } from '../shared/envelope'
import { dimSeconds } from '../shared/dimsetting'
import { textSizePercent } from '../shared/textsize'
import { autoListenOn } from '../shared/autolisten'
import { untilPhoneWakes, phoneError as phoneErrorFor, ZEPP_NOTE, STUCK_NOTE, STUCK_AFTER_MS, BLE_FIX, resendUntil, newRid, uploadAllowanceMs, ASK_ATTEMPT_MS, confirmAttemptMs } from '../shared/retry'
import { screenFor, pollStep, resumeFor, lastIsNew } from '../shared/screens'
import { sessionRows } from '../shared/sessions'
import { paginate, PAGE_CHARS } from '../shared/pager'
import { ringDotsRect, dotColors, elapsedText, dotsText, statusWord, THINKING_WORDS, WORKING_WORDS } from '../shared/spinner'
import { DIAG, TIMING, timingLine, RECON_SELFTEST, AUTO_RECONNECT } from '../shared/debug'
import { shouldReconnect, RECON_SETTLE_MS, RECON_RETRY_MS } from '../shared/reconnect'
import { linkRecord, linkPending, linkAck, linkOutcome } from '../shared/linklog'
import { speechQueue } from '../shared/speechqueue'
import { pieceRanges } from '../shared/pieces'
import { makeFix, locationFor } from '../shared/location'

const FILE = 'clip.opus'
const TRACE = 'close-trace'
const BUZZ_MS = 600 // the start buzz finishes before the microphone opens, so it is not recorded
const MAX_REC_MS = 90000 // long questions are fine; the upload gets extra time (uploadAllowanceMs)
const POLL_MS = 3000
// A poll with no reply or error after this is abandoned and sent again: one once never ended (no
// timeout fired), and every later tick was skipped - the watch sat on Still working for 6 min while
// the answer waited on the PC.
const POLL_STUCK_MS = 25000
const WAKE_MS = 15000 // keep retrying while iOS wakes the Zepp app ("shake timeout")
const OPEN_ZEPP = ZEPP_NOTE

// Is the watch's Bluetooth link to the phone up right now? undefined when the watch can't say.
function bleUp() {
  try {
    return !!connectStatus()
  } catch (e) {
    return undefined
  }
}

// Why a request to the phone failed, with the fix that matches (shared/retry.js).
const phoneError = (e) => phoneErrorFor(e, { bleUp: bleUp() })
// A request with no reply after ASK_ATTEMPT_MS / confirmAttemptMs (shared/retry.js) was lost between
// the PC and the iPhone: the watch sends it again with the same request id.
const PIECE_TRIES = 4 // a piece of a long recording that failed or got no reply is sent again
const REQUEST_BUDGET_MS = 150000
const POLL_LIMIT_MS = 32 * 60 * 1000 // the relay gives up on a job after 30 min
const WAIT_BRIGHT_MS = 10 * 60 * 1000 // screen stays on while recording and waiting
const READ_BRIGHT_MS = 60 * 1000 // then a minute to read the answer
const TEXT_PCT_KEY = 'text-pct' // the phone slider's answer text size, remembered for the next open
const AUTO_LISTEN_STORE = 'auto-listen' // the phone toggle "Listen when Hermes opens", remembered for the next open (default off)
const DIM_SECONDS_KEY = 'dim-seconds' // the phone slider's value, remembered for the next open
const DIM_GRACE_MS = 15 * 1000 // the watch's own screen timeout waits this long past the black-out
const MIC = 'device:os.mic'
const GEO = 'device:os.geolocation'
const LAST_FIX = 'last-fix' // survives closing the app, for a question asked before GPS has a fix
const GEO_ASKED = 'geo-asked' // the location permission is asked once, on open, never while recording
const SAVED = 'last-screen'
const VOICE_KEY = 'voice' // 'off' when the Voice button is switched off; on by default
const REVIEW_KEY = 'review' // 'on' when Review is switched on: after STOP the words wait for Send; off by default (STOP sends at once)
const LAST_TRIES = 6 // x 3 s: the relay answers or hands out a job within 12 s
const GRANTED = 2

const { width: W, height: H } = getDeviceInfo()
const MARGIN = Math.round(W * 0.08) // a square screen has no side curve to keep clear of
const TEXT_W = W - 2 * MARGIN
const GREEN = 0x1e8449
const GREY = 0x5d6d7e
const BLUE = 0x2471a3
const SESSIONS_W = Math.round(TEXT_W * 0.55) - 4 // fills the bottom row with New; the purple "Sessions" text button in the bottom row (was an icon)
const NEW_W = TEXT_W - SESSIONS_W - 8 // (8 = ICON_GAP); the grey "New" text button (was the New chat icon)
const PURPLE = 0x8e44ad
const ICON_W = 92 // the icon-row images' width: four plus gaps fit the screen (tools/voice-icons.py)
const ICON_GAP = 8
const CARD = 0x252b33 // a past-session card (the News app's article card colour)
const CARD_PAD = 14
const CARD_GAP = 14
const EDIT_ICON_W = 90 // edit.png / cancel.png (the same pencil and X as another Zepp app)
const RATE_W = 132 // thumbs up / down images (tools/rate-icons.py)
const RATE_H = 72

// Waiting animation: a ring of dots round the screen edge with a chasing head (shared/spinner.js).
// The screen's corners have a radius of about 106 px, so the ring follows them.
const CORNER = 106
const RING_N = 20
const RING = ringDotsRect(RING_N, W, H, 18, CORNER)
const DOT_R = 7
const SPIN = {
  thinking: { head: 0x7fd4ff, dim: 0x13222c, tickMs: 70, label: 'Thinking', words: THINKING_WORDS },
  working: { head: 0xf5b041, dim: 0x2a1f0e, tickMs: 130, label: 'Still working', words: WORKING_WORDS },
}
const RED = 0xc0392b

const errText = (e) => (e && e.message ? e.message : String(e))

function vibrate() {
  try {
    new Vibrator().start()
  } catch (e) {}
}

function withMic(onGranted, onDenied) {
  let status
  try {
    status = queryPermission({ permissions: [MIC] })[0]
  } catch (e) {
    return onGranted() // no permission API on this firmware: the recorder reports instead
  }
  if (status === GRANTED) return onGranted()
  const result = requestPermission({
    permissions: [MIC],
    callback: () => {
      let now = null
      try {
        now = queryPermission({ permissions: [MIC] })[0]
      } catch (e) {}
      if (now === GRANTED) onGranted()
      else onDenied('The microphone is not allowed. Answer Allow on the watch.')
    },
  })
  if (result === GRANTED) onGranted()
  else if (result === 1) onDenied('The microphone is blocked. Allow it for Hermes in the watch settings.')
}

// Location is optional: anything but a clear "allowed" just means questions go without it.
function geoAllowed() {
  try {
    return queryPermission({ permissions: [GEO] })[0] === GRANTED
  } catch (e) {
    return true // no permission API on this firmware: try the sensor
  }
}

function askGeoOnce() {
  try {
    if (geoAllowed() || localStorage.getItem(GEO_ASKED, '')) return
    localStorage.setItem(GEO_ASKED, '1')
    requestPermission({ permissions: [GEO], callback: () => {} })
  } catch (e) {}
}

function clipSize() {
  const st = statSync({ path: FILE })
  return (st && st.size) || 0
}

function fileSize(path) {
  try {
    const st = statSync({ path })
    return (st && st.size) || 0
  } catch (e) {
    return 0
  }
}

function battery() {
  try {
    return new Battery().getCurrent()
  } catch (e) {
    return -1
  }
}

// One piece of the recording, read when it is sent: only ~24 KB of the clip is in memory at a time.
function readPiece(range, path = FILE) {
  const { start, length } = range
  const fd = openSync({ path, flag: O_RDONLY })
  try {
    const buf = new ArrayBuffer(length)
    const got = readSync({ fd, buffer: buf, options: { position: start } })
    if (got !== length) throw new Error(`read ${got} of ${length} bytes`)
    return buf
  } finally {
    closeSync(fd)
  }
}

// A text size scaled by the watch's Text size setting; the size as given on firmware
// without getSysFontSize.
function sp(size) {
  try {
    const s = typeof hmUI.getSysFontSize === 'function' ? hmUI.getSysFontSize(size) : size
    return s > 0 ? Math.round(s) : size
  } catch (e) {
    return size
  }
}

function textHeight(text, size) {
  if (!text) return 0
  try {
    return hmUI.getTextLayout(text, { text_size: size, text_width: TEXT_W, wrapped: 1 }).height + 8
  } catch (e) {
    return Math.ceil(text.length / 22) * (size + 8)
  }
}

Page(
  BasePage({
    state: { widgets: [], recorder: null, recording: false, busy: false, startedAt: 0, timers: [], poll: null, renderTimer: null, anim: null, waitSince: 0, resumeToken: 0,
      voiceOn: true, reviewOn: false, player: null, playerReady: false, playing: false, speechId: null, speechFile: null, earlyFiles: [], queue: null,
      gps: null, gpsOnChange: null, fix: null, gpsNote: ''},

    build() {
      this.state.player = null // each page gets its own player
      this.state.playerReady = false
      this.state.playing = false
      this.state.gps = null
      this.state.fix = null
      askGeoOnce()
      this.loadDimSetting()
      // Swipe right on the Past sessions list goes back to the main screen, like its Back button, instead of closing
      // the app. Every other screen keeps the system's normal swipe.
      try {
        onGesture({ callback: (e) => e === GESTURE_RIGHT && this.goBack() })
      } catch (e) {}
      this.startGps() // stays on until the app closes
      try {
        this.state.voiceOn = localStorage.getItem(VOICE_KEY, 'on') !== 'off'
        this.state.reviewOn = false // Review is hidden now; a stored 'on' must not keep holding the words back
        localStorage.setItem(REVIEW_KEY, 'off')
      } catch (e) {}
      try {
        getApp()._options.globalData.onSpeechFile = (path, params) => this.playSpeech(path, params)
        getApp()._options.globalData.onSpeechNote = (note) => this.report(note)
      } catch (e) {}
      if (DIAG) {
        try {
          const last = localStorage.getItem(TRACE, 'none')
          this.state.timers.push(setTimeout(() => this.report(`last close: ${last}`), 2000)) // once the phone link is up
        } catch (e) {}
      }
      this.link('open', `v1.6.22 ble ${bleUp()} prev close: ${this.lastClose()}`)
      if (RECON_SELFTEST) this.scheduleSelftest(5000, 18) // waits up to ~3 min for a quiet moment
      let saved = null
      try {
        saved = JSON.parse(localStorage.getItem(SAVED, '') || 'null')
      } catch (e) {}
      const r = resumeFor(saved, Date.now())
      if (!r) {
        this.show({ screen: 'idle' })
        // fresh open: listen straight away only when the phone toggle is on
        let auto = false
        try {
          auto = autoListenOn(localStorage.getItem(AUTO_LISTEN_STORE, ''))
        } catch (e) {}
        return auto ? this.onTalk() : undefined
      }
      if (r.show) {
        this.keepAwake(READ_BRIGHT_MS)
        return this.show(r.show)
      }
      if (r.resumeJob) { // the job kept running on the PC: pick it up again (no screen-on needed, it may black out)
        this.state.waitSince = r.since
        return this.startPoll(r.resumeJob)
      }
      this.fetchLast(r.fetchLast, r.heard)
    },

    // Reopened while a question was out: collect the reply the relay kept for us.
    fetchLast(since, heard) {
      this.state.busy = true
      this.state.waitSince = since
      this.keepAwake(WAIT_BRIGHT_MS)
      this.show({ screen: 'thinking', heard, resume: true }) // has a Cancel button: a dead phone can't trap the app
      const token = ++this.state.resumeToken
      let tries = 0
      const attempt = () => {
        this.request({ method: 'last' }, { timeout: 20000 }) // one try each: no 30 s phone wake-up wait here
          .catch(() => null)
          .then((last) => {
            if (token !== this.state.resumeToken) return // cancelled

            if (lastIsNew(last, since, Date.now())) {
              const reply = !last.heard && heard ? { ...last, heard: heard.replace(/^You said: /, '') } : last
              return this.finish(reply)
            }
            if (++tries < LAST_TRIES) return this.state.timers.push(setTimeout(attempt, POLL_MS))
            this.finish(last && !last.ok ? last : { ok: false, error: "That question didn't reach Hermes. Tap TALK to ask again." })
          })
      }
      attempt()
    },

    // -> true when there was a screen to go back to (the swipe is then used up), false to let the system close the app
    goBack() {
      if (!this.model || this.model.screen !== 'sessions') return false
      this.show({ screen: 'idle' })
      return true
    },

    onDestroy() {
      if (this.state.selftestTimer) clearTimeout(this.state.selftestTimer)
      this.link('close', `ble ${bleUp()}`)
      this.trace('closing')
      try {
        offGesture()
      } catch (e) {}
      this.stopVoice() // normally already released when the last clip finished
      this.trace('player closed')
      this.stopGps() // never leave the app holding a sensor (the speaker rebooted the watch that way)
      this.trace('gps closed')
      try {
        getApp()._options.globalData.onSpeechFile = null
        getApp()._options.globalData.onSpeechNote = null
      } catch (e) {}
      this.stopAnim()
      this.clearTimers()
      try {
        if (this.state.recording) this.state.recorder.stop()
      } catch (e) {}
      if (this.state.dimTimer) clearTimeout(this.state.dimTimer)
      if (this.state.offTimer) clearTimeout(this.state.offTimer)
      if (this.state.dimmed) {
        try {
          setBrightness(this.state.brightness)
        } catch (e) {}
      }
      resetPageBrightTime()
      resetDropWristScreenOff()
      this.trace('closed')
    },

    // Reboot hunt (DIAG only): the last step of the previous close survives a reboot in
    // localStorage, and the next open reports it to the PC log.
    trace(step) {
      try {
        localStorage.setItem(TRACE, `${new Date().toISOString()} ${step}`)
      } catch (e) {}
    },

    // ------------------------------------------------------------------ location
    startGps() {
      if (this.state.gps) return
      if (!geoAllowed()) {
        this.state.gpsNote = 'location not allowed'
        return
      }
      try {
        const geo = new Geolocation()
        try {
          if (geo.getEnabled && geo.getEnabled() === false) {
            this.state.gpsNote = 'location is off in the watch settings'
            return
          }
        } catch (e) {}
        const onChange = () => {
          try {
            if (geo.getStatus() !== 'A') return
            const fix = makeFix(geo.getLatitude({ format: 'DD' }), geo.getLongitude({ format: 'DD' }), Date.now())
            if (!fix) return
            this.state.fix = fix
            localStorage.setItem(LAST_FIX, JSON.stringify(fix))
          } catch (e) {}
        }
        geo.onChange(onChange)
        geo.start()
        this.state.gps = geo
        this.state.gpsOnChange = onChange
        this.state.gpsNote = ''
        onChange() // already fixed if another app had GPS on
      } catch (e) {
        this.state.gpsNote = `GPS error: ${errText(e)}`
      }
    },

    stopGps() {
      const geo = this.state.gps
      if (!geo) return
      if (this.state.gpsOnChange) this.state.gpsOnChange() // the latest fix, before it goes off
      this.state.gps = null
      try {
        geo.offChange(this.state.gpsOnChange)
      } catch (e) {}
      try {
        geo.stop()
      } catch (e) {}
      this.state.gpsOnChange = null
    },

    // {loc} for the question's header, or {gps: why not} so the PC log says why there was none.
    whereAmI() {
      if (this.state.gpsOnChange) this.state.gpsOnChange() // the very latest fix, in case no change event came
      let fix = this.state.fix
      if (!fix) {
        try {
          fix = JSON.parse(localStorage.getItem(LAST_FIX, '') || 'null')
        } catch (e) {}
      }
      const loc = locationFor(fix, Date.now())
      if (loc) return { loc }
      return { gps: this.state.gpsNote || (fix ? 'last fix too old' : 'no fix yet') }
    },

    // ------------------------------------------------------------------ screens
    // Rebuilt after the current click handler returns: deleting the pressed button inside
    // its own callback would crash the page.
    show(model) {
      if (this.state.dimmed) this.wake()
      this.model = model
      this.save(model)
      this.armDim()
      if (this.state.renderTimer) return
      this.state.renderTimer = setTimeout(() => {
        this.state.renderTimer = null
        this.render(this.model)
      }, 10)
    },

    // Remembered for the next time the app opens; recording is never resumed (the screen it
    // started from stays saved), and the start screen clears it.
    save(model) {
      if (model.screen === 'listening') return
      try {
        if (model.screen === 'idle' || model.screen === 'sessions' || model.screen === 'newchat') return localStorage.removeItem(SAVED) // the list is fetched fresh
        localStorage.setItem(SAVED, JSON.stringify({ at: Date.now(), since: this.state.waitSince, model }))
      } catch (e) {}
    },

    add(type, props) {
      const w = hmUI.createWidget(type, props)
      this.state.widgets.push(w)
      return w
    },

    text(y, text, baseSize, color) {
      const size = sp(baseSize)
      const h = textHeight(text, size)
      this.add(hmUI.widget.TEXT, {
        x: MARGIN, y, w: TEXT_W, h, text, text_size: size, color,
        align_h: hmUI.align.CENTER_H, text_style: hmUI.text_style.WRAP,
      })
      return y + h
    },

    button(y, text, color, onClick, w = Math.round(W * 0.5), x = Math.round((W - w) / 2)) {
      this.add(hmUI.widget.BUTTON, {
        x, y, w, h: 80, radius: 40, text, text_size: Math.min(sp(30), 44), normal_color: color, press_color: 0x333333,
        click_func: onClick,
      })
      return y + 80
    },

    render(m) {
      this.stopAnim()
      for (const w of this.state.widgets) hmUI.deleteWidget(w)
      this.state.widgets = []
      this.state.rateRow = null
      const talk = () => this.onTalk()
      let y = Math.round(H * 0.1)
      if (m.screen === 'idle') {
        this.add(hmUI.widget.IMG, { x: Math.round((W - 124) / 2), y: Math.round(H * 0.08), src: 'icon.png' })
        y = this.text(Math.round(H * 0.36), m.note || 'Tap TALK and ask Hermes', 26, 0xffffff)
        y = this.talkRow(y + 20, talk)
        y = this.iconRows(y + 14)
        this.add(hmUI.widget.TEXT, { x: 0, y: y + 60, w: W, h: 2, text: '' }) // scroll room
      } else if (m.screen === 'sessions') {
        y = this.text(Math.round(H * 0.08), 'Past sessions', 30, 0xffffff)
        y = this.text(y + 2, m.rows.length ? 'Tap one to continue it' : 'No earlier sessions yet', 22, 0x999999)
        y += 16
        for (const row of m.rows) y = this.card(y, row, () => this.pickSession(row), row.current ? BLUE : CARD)
        y = this.button(y + 2, 'Back', GREY, () => this.show({ screen: 'idle' }))
        this.add(hmUI.widget.TEXT, { x: 0, y: y + Math.round(H * 0.2), w: W, h: 2, text: '' }) // scroll room
      } else if (m.screen === 'newchat') {
        // New chat asks first: one stray tap must not wipe the conversation.
        y = this.text(Math.round(H * 0.2), 'Start a new chat?', 34, 0xffffff)
        y = this.text(y + 6, 'Hermes will forget this conversation.', 24, 0x999999)
        const bw = Math.round(W * 0.38)
        const gap = 16
        const left = Math.round((W - 2 * bw - gap) / 2)
        this.button(y + 30, 'Yes', RED, () => this.newChat(), bw, left)
        this.button(y + 30, 'Keep', GREY, () => this.show(this.state.beforeNewChat || { screen: 'idle' }), bw, left + bw + gap)
      } else if (m.screen === 'listening') {
        this.add(hmUI.widget.IMG, { x: Math.round((W - 124) / 2), y: Math.round(H * 0.08), src: 'icon.png' })
        y = this.text(Math.round(H * 0.36), `Listening... ${m.seconds || 0}s`, 34, 0x7fd4ff)
        y = this.button(y + 30, 'STOP', 0xc0392b, talk)
        this.button(y + 14, 'Cancel', GREY, () => this.cancelRecording())  // throw the recording away
      } else if (m.screen === 'thinking' || m.screen === 'working') {
        this.renderWaiting(m)
      } else if (m.screen === 'preview') {
        // What the mic heard, before Hermes gets it: Send it or throw it away.
        y = this.text(y, 'You said:', 22, 0x999999)
        y = this.text(y + 8, m.text, 32, 0xffffff)
        // One row like another Zepp app: pencil (fix the words) | Send | X (throw away).
        // Short text: the row sits at the bottom of the screen; long text: it follows the words.
        const gap = 16
        const sendW = TEXT_W - 2 * EDIT_ICON_W - 2 * gap
        const rowY = Math.max(H - 80 - 24, y + 24)
        this.add(hmUI.widget.BUTTON, { x: MARGIN, y: rowY, w: EDIT_ICON_W, h: 80,
          normal_src: 'edit.png', press_src: 'edit-press.png', click_func: () => this.editPreview(m) })
        this.button(rowY, 'Send', GREEN, () => this.sendTyped(m.text, m.where), sendW, MARGIN + EDIT_ICON_W + gap)
        this.add(hmUI.widget.BUTTON, { x: MARGIN + EDIT_ICON_W + gap + sendW + gap, y: rowY, w: EDIT_ICON_W, h: 80,
          normal_src: 'cancel.png', press_src: 'cancel-press.png', click_func: () => this.show({ screen: 'idle' }) })
        y = rowY + 80
        if (m.timing) y = this.text(y + 10, m.timing, 18, 0x777777)
        this.add(hmUI.widget.TEXT, { x: 0, y: y + 60, w: W, h: 2, text: '' }) // scroll room
      } else if (m.screen === 'confirm') {
        y = this.text(y + 20, m.heard, 24, 0x999999)
        y = this.text(y + 10, m.text, this.answerSize(), 0xffffff)
        if (m.voiceNote) y = this.text(y + 6, m.voiceNote, 20, 0xf5b041)
        const bw = Math.round(W * 0.32)
        const gap = 16
        const left = Math.round((W - 2 * bw - gap) / 2)
        // Approve cards are Hermes asking for approval (Claude Code changes); Approve = this one time.
        const [yes, no] = m.approve ? ['Approve', 'Deny'] : ['Yes', 'No']
        this.button(y + 24, yes, GREEN, () => this.confirm(m.id, true, yes, m), bw, left)
        this.button(y + 24, no, GREY, () => this.confirm(m.id, false, no, m), bw, left + bw + gap)
        y += 24 + 80
        // Any other answer is spoken: it goes to Hermes as the next message and the card lapses.
        y = this.button(y + 16, 'Reply', BLUE, talk, 2 * bw + gap, left)
        this.add(hmUI.widget.TEXT, { x: 0, y: y + 60, w: W, h: 2, text: '' }) // scroll room
      } else {
        // answer / error
        y = this.text(y + 20, m.heard, 24, 0x999999)
        // Long answers go a page at a time with < Back / More >; short ones are unchanged.
        const pages = paginate(m.text, Math.round(PAGE_CHARS / (this.state.textScale || 1) ** 2)) // bigger text, fewer characters a page
        if (this.state.pagedFor !== m.text) { this.state.pagedFor = m.text; this.state.page = 1 }
        const pageNo = Math.min(this.state.page || 1, pages.length)
        y = this.text(y + 10, pages[pageNo - 1], this.answerSize(), m.screen === 'error' ? 0xff7b6b : 0xffffff)
        if (pages.length > 1) {
          y = this.text(y + 6, `${pageNo} / ${pages.length}`, 22, 0x999999)
          y = this.pager(y + 14, pageNo, pages.length)
        }
        if (m.voiceNote) y = this.text(y + 6, m.voiceNote, 20, 0xf5b041)
        y = this.talkRow(y + 30, talk)
        // TALK continues the conversation; New chat drops it (Hermes forgets the earlier turns).
        y = this.iconRows(y + 16)
        // The thumbs sit at the very bottom, under New chat / Sessions.
        if (m.rate) y = this.rateButtons(y + 16, m)
        if (m.rateNote) y = this.text(y + 6, m.rateNote, 20, 0xf5b041)
        this.add(hmUI.widget.TEXT, { x: 0, y: y + Math.round(H * 0.2), w: W, h: 2, text: '' }) // scroll room
      }
      try {
        scrollTo({ y: 0 })
      } catch (e) {}
    },

    // A past session as a card, drawn  like article cards: a rounded panel,
    // the title left-aligned on top, the date/time line under it. The open session's card is blue. Tapping the
    // card or its text picks it.
    card(y, row, onClick, fill) {
      // No text measuring here: every row has a fixed
      // height and the text is already cut to size by sessionRows(). Rows: Hermes' last reply on 2 lines, then the
      // date/count line. A session with no reply yet shows its title on the 2 lines instead.
      const innerW = TEXT_W - 2 * CARD_PAD
      const bodySize = sp(24)
      const subSize = sp(20)
      const bodyH = 2 * (bodySize + 8) + 6
      const subH = row.sub ? subSize + 14 : 0
      const h = CARD_PAD + bodyH + subH + CARD_PAD
      const parts = [
        this.add(hmUI.widget.FILL_RECT, { x: MARGIN, y, w: TEXT_W, h, radius: 22, color: fill }),
        this.add(hmUI.widget.TEXT, { x: MARGIN + CARD_PAD, y: y + CARD_PAD, w: innerW, h: bodyH, text: row.answer || row.title, text_size: bodySize,
          color: 0xffffff, align_h: hmUI.align.LEFT, text_style: hmUI.text_style.WRAP }),
      ]
      if (row.sub) {
        parts.push(this.add(hmUI.widget.TEXT, { x: MARGIN + CARD_PAD, y: y + CARD_PAD + bodyH, w: innerW, h: subH, text: row.sub, text_size: subSize,
          color: row.current ? 0xd6e6f2 : 0x9aa5b1, align_h: hmUI.align.LEFT, text_style: hmUI.text_style.WRAP }))
      }
      for (const w of parts) {
        try {
          w.addEventListener(hmUI.event.CLICK_UP, onClick)
        } catch (e) {}
      }
      return y + h + CARD_GAP
    },

    // "< Back" and "More >" under a long answer; the one that has nowhere to go is greyed out and does nothing.
    pager(y, pageNo, total) {
      const gap = 16
      const bw = Math.round((TEXT_W - gap) / 2)
      const go = (n) => () => { this.state.page = n; this.show(this.model) }
      this.button(y, '< Back', pageNo > 1 ? GREY : 0x2a2f36, pageNo > 1 ? go(pageNo - 1) : () => {}, bw, MARGIN)
      return this.button(y, 'More >', pageNo < total ? BLUE : 0x2a2f36, pageNo < total ? go(pageNo + 1) : () => {}, bw, MARGIN + bw + gap)
    },

    // Thinking / Still working: spinning ring, Hermes icon, a playful word with cycling dots, time waited.
    renderWaiting(m) {
      const spin = SPIN[m.screen]
      const offset = Math.floor(Math.random() * spin.words.length) // a different first word each wait
      const word = () => statusWord(spin.words, Date.now() - shownAt, offset)
      const shownAt = Date.now()
      const dots = RING.map((p) => this.add(hmUI.widget.CIRCLE, { center_x: p.x, center_y: p.y, radius: DOT_R, color: spin.dim }))
      this.add(hmUI.widget.IMG, { x: Math.round((W - 124) / 2), y: 72, src: 'icon.png' })
      const labelSize = sp(32)
      const clockSize = sp(22)
      const label = this.add(hmUI.widget.TEXT, {
        x: MARGIN, y: 206, w: TEXT_W, h: labelSize + 12, text: `${word()}.`, text_size: labelSize, color: spin.head,
        align_h: hmUI.align.CENTER_H,
      })
      const since = this.state.waitSince || Date.now()
      const clockY = 206 + labelSize + 14
      const clock = this.add(hmUI.widget.TEXT, {
        x: MARGIN, y: clockY, w: TEXT_W, h: clockSize + 8, text: elapsedText(Date.now() - since), text_size: clockSize, color: 0x888888,
        align_h: hmUI.align.CENTER_H,
      })
      const heard = (m.heard || '').length > 70 ? `${m.heard.slice(0, 67)}...` : m.heard || ''
      let y = clockY + clockSize + 12
      if (heard) y = this.text(y, heard, 20, 0x999999)
      if (m.note) y = this.text(y, m.note, 20, SPIN.working.head) // "you can close the app" after an Approve
      if (m.screen === 'working' || m.resume) this.button(Math.max(y + 8, 326), 'Cancel', GREY, () => this.cancelPoll(), Math.round(W * 0.4))
      let step = 0
      let shown = ''
      this.state.anim = setInterval(() => {
        step++
        const colors = dotColors(step, RING_N, spin.head, spin.dim, 6)
        for (let i = 0; i < RING_N; i++) {
          dots[i].setProperty(hmUI.prop.MORE, { center_x: RING[i].x, center_y: RING[i].y, radius: DOT_R, color: colors[i] })
        }
        if (step % 6 === 0) label.setProperty(hmUI.prop.TEXT, `${this.state.waking ? 'Waking the phone' : word()}${dotsText(step / 6)}`)
        const t = elapsedText(Date.now() - since)
        if (t !== shown) clock.setProperty(hmUI.prop.TEXT, (shown = t))
      }, spin.tickMs)
    },

    stopAnim() {
      if (this.state.anim) clearInterval(this.state.anim)
      this.state.anim = null
    },

    // ------------------------------------------------------------------ recording
    clearTimers() {
      for (const t of this.state.timers) {
        clearTimeout(t)
        clearInterval(t)
      }
      this.state.timers = []
      if (this.state.poll) clearInterval(this.state.poll)
      this.state.poll = null
    },

    // ------------------------------------------------------------------ idle dim
    // untouched for the phone slider's time (1-5 min), the screen goes black; a tap brings it back.
    // Never while recording or sending; it does dim while a slow job runs on the PC. The value comes from the phone on open and is remembered.
    loadDimSetting() {
      try {
        this.state.dimMs = dimSeconds(localStorage.getItem(DIM_SECONDS_KEY, '')) * 1000
        this.state.textScale = textSizePercent(localStorage.getItem(TEXT_PCT_KEY, '')) / 100
      } catch (e) {}
      this.request({ method: 'settings' }, { timeout: 8000 })
        .then((r) => {
          if (!r || !r.ok) return
          this.state.dimMs = dimSeconds(r.dim_s) * 1000
          try {
            localStorage.setItem(DIM_SECONDS_KEY, String(dimSeconds(r.dim_s)))
            if (r.text_pct) localStorage.setItem(TEXT_PCT_KEY, String(textSizePercent(r.text_pct)))
            localStorage.setItem(AUTO_LISTEN_STORE, autoListenOn(r.auto_listen) ? 'true' : 'false')
          } catch (e) {}
        })
        .catch(() => {})
    },

    // Hermes' reply text: 32 at 100%, up to double from the phone slider.
    answerSize() {
      return Math.round(32 * (this.state.textScale || 1))
    },

    armDim() {
      if (this.state.dimTimer) clearTimeout(this.state.dimTimer)
      this.state.dimTimer = null
      if (this.state.recording || this.state.typing || (this.state.busy && !this.state.poll)) return // waiting on a PC job (poll) may black out
      this.keepAwake(READ_BRIGHT_MS) // lifted to cover the dim time
      this.state.dimTimer = setTimeout(() => this.goDark(), this.state.dimMs || 60000)
    },

    goDark() {
      this.state.dimTimer = null
      if (this.state.recording || this.state.typing || (this.state.busy && !this.state.poll) || this.state.dimmed) return
      try {
        this.state.brightness = getBrightness()
        setBrightness(0)
        setPageBrightTime({ brightTime: DIM_GRACE_MS }) // black now, the watch's own screen-off follows shortly after
        scrollTo({ y: 0 }) // the tap catcher below covers the top of the page
      } catch (e) {
        return
      }
      this.state.dimmed = true
      this.link('dark', `ble ${bleUp()} busy ${!!this.state.busy}`)
      // Turn the screen off for real DIM_GRACE_MS after the black-out (setPageBrightTime alone did not).
      // A tap before then wakes the app (wake clears this); the watch closes the app and saved state brings it back.
      if (this.state.offTimer) clearTimeout(this.state.offTimer)
      this.state.offTimer = setTimeout(() => {
        this.state.offTimer = null
        if (!this.state.dimmed || this.state.recording) return
        this.link('off', `ble ${bleUp()}`)
        try {
          setScreenOff()
        } catch (e) {}
      }, DIM_GRACE_MS)
      this.state.dimCover = hmUI.createWidget(hmUI.widget.BUTTON, { x: 0, y: 0, w: W, h: H * 3, text: '', normal_color: 0x000000, press_color: 0x000000,
        click_func: () => this.wake() })
      this.stopGps() // no sensor running while the screen is black (a slow job can keep the app alive for minutes); wake() restarts it
    },

    // The tap that wakes the screen is swallowed. The cover is deleted after its click handler returns.
    wake() {
      if (!this.state.dimmed) return
      this.state.dimmed = false
      this.link('wake', `ble ${bleUp()}`)
      this.startGps()
      if (this.state.offTimer) clearTimeout(this.state.offTimer)
      this.state.offTimer = null
      try {
        setBrightness(this.state.brightness)
      } catch (e) {}
      const cover = this.state.dimCover
      this.state.dimCover = null
      setTimeout(() => {
        try {
          hmUI.deleteWidget(cover)
        } catch (e) {}
      }, 10)
      this.armDim()
    },

    keepAwake(ms) {
      ms = Math.max(ms, (this.state.dimMs || 60000) + DIM_GRACE_MS) // never turn off before the black-out
      try {
        setPageBrightTime({ brightTime: ms })
        pauseDropWristScreenOff({ duration: 0 })
      } catch (e) {}
    },

    onTalk() {
      if (this.state.busy) return
      if (this.state.recording) return this.stopAndSend()
      if (bleUp() === false) return this.show({ screen: 'error', heard: '', text: BLE_FIX }) // no point recording first
      this.stopVoice() // don't record Hermes talking
      this.state.speechId = null
      withMic(() => this.startRecording(), (why) => this.show({ screen: 'error', heard: '', text: why }))
    },

    // The start buzz plays BEFORE the microphone opens: when the motor ran after
    // recorder.start() its sound was in the clip and Whisper heard it as speech. Taps are ignored (busy)
    // for the BUZZ_MS it takes to finish.
    startRecording() {
      this.state.busy = true
      this.clearTimers()
      this.keepAwake(WAIT_BRIGHT_MS)
      vibrate()
      this.state.timers.push(setTimeout(() => this.beginRecording(), BUZZ_MS))
    },

    beginRecording() {
      this.state.busy = false
      try {
        try {
          rmSync({ path: FILE })
        } catch (e) {}
        if (!this.state.recorder) this.state.recorder = create(id.RECORDER)
        this.state.recorder.setFormat(codec.OPUS, { target_file: `data://${FILE}` })
        this.state.recorder.start()
        this.startGps() // no-op unless it failed to start on open
      } catch (e) {
        return this.show({ screen: 'error', heard: '', text: `Could not start the microphone: ${errText(e)}` })
      }
      this.clearTimers()
      this.state.recording = true
      this.state.startedAt = Date.now()
      this.show({ screen: 'listening', seconds: 0 })
      this.state.timers.push(setInterval(() => {
        this.show({ screen: 'listening', seconds: Math.round((Date.now() - this.state.startedAt) / 1000) })
      }, 1000))
      this.state.timers.push(setTimeout(() => this.stopAndSend(), MAX_REC_MS))
    },

    stopAndSend() {
      if (!this.state.recording) return
      this.clearTimers()
      this.state.recording = false
      this.state.busy = true
      try {
        this.state.recorder.stop()
      } catch (e) {}
      vibrate()
      this.state.waitSince = Date.now()
      this.state.stoppedAt = Date.now() // the timing line on the preview card counts from the STOP tap
      this.show({ screen: 'thinking', heard: '' })
      // Give the recorder a moment to finish writing the file.
      this.state.timers.push(setTimeout(() => this.send(), 400))
    },

    // Cancel while listening: stop the microphone and delete the clip; nothing goes to the PC.
    cancelRecording() {
      if (!this.state.recording) return
      this.clearTimers()
      this.state.recording = false
      try {
        this.state.recorder.stop()
      } catch (e) {}
      try {
        rmSync({ path: FILE })
      } catch (e) {}
      this.show({ screen: 'idle' })
    },

    send() {
      let size
      try {
        size = clipSize()
      } catch (e) {
        return this.finish({ ok: false, error: `Could not read the recording: ${errText(e)}` })
      }
      if (!size) return this.finish({ ok: false, error: 'Nothing was recorded. Try again.' })
      // Long recordings go in pieces (shared/pieces.js); the last piece is the question itself.
      // Each piece is read from the file just before it is sent, and only while it is sent.
      const rid = newRid()
      const ranges = pieceRanges(size)
      const n = ranges.length
      const opts = { contentType: 'bin', dataType: 'json' }
      const where = this.whereAmI() // only the last piece (the question itself) needs it
      const envelope = (i) => buildEnvelope({ kind: 'ask', ...(this.state.reviewOn ? { preview: true } : {}), speak: this.state.voiceOn, rid, ...(n > 1 ? { part: i + 1, parts: n } : {}),
        ...(i === n - 1 ? where : {}) }, readPiece(ranges[i]))
      const piece = (i, tries = 1) => {
        this.show({ screen: 'thinking', heard: `Sending ${i + 1} of ${n}` })
        const extra = uploadAllowanceMs(ranges[i].length)
        return Promise.resolve().then(() => this.phoneRequest(envelope(i), { ...opts, timeout: ASK_ATTEMPT_MS + extra }))
          .then((r) => (r && r.ok ? r : Promise.reject(new Error((r && r.error) || 'no reply'))))
          .catch((e) => {
            if (tries >= PIECE_TRIES || /shake timeout/i.test(errText(e))) throw e // phoneRequest already waited 15 s
            return new Promise((resolve) => setTimeout(resolve, 1000)).then(() => piece(i, tries + 1))
          })
      }
      const ask = () => {
        if (n > 1) this.show({ screen: 'thinking', heard: `Sending ${n} of ${n}` })
        const extra = uploadAllowanceMs(ranges[n - 1].length)
        return this.resendRequest(envelope(n - 1), opts, ASK_ATTEMPT_MS + extra, REQUEST_BUDGET_MS + 2 * extra)
      }
      let chain = Promise.resolve()
      for (let i = 0; i < n - 1; i++) chain = chain.then(() => piece(i))
      chain.then(ask)
        .then((r) => this.finish(r && r.kind === 'transcript'
          ? { ...r, where, ...(TIMING ? { timing: timingLine(Date.now() - this.state.stoppedAt, r) } : {}) } : r))
        .catch((e) => this.finish({ ok: false, error: phoneError(e) }))
    },

    // ------------------------------------------------------------------ replies
    finish(reply) {
      const m = screenFor(reply)
      if (m.screen === 'working') return this.startPoll(m)
      this.state.busy = false
      this.keepAwake(READ_BRIGHT_MS)
      if (m.screen !== 'working') vibrate()
      this.show(m)
      if (m.screen === 'answer' || m.screen === 'confirm') this.report(`${m.screen}: speech ${m.speech || 'none'}, voice ${this.state.voiceOn ? 'on' : 'off'}`)
      if (m.speech && this.state.voiceOn) this.speak(m.speech, m.speechParts || 1) // text first; the voice follows
    },

    // A status line into the PC's relay log (via the phone), only with shared/debug.js DIAG on.
    report(...events) {
      if (!DIAG) return
      try {
        this.request({ method: 'diag', params: { events } }, { timeout: 10000 }).catch(() => {})
      } catch (e) {}
    },

    // Link black box (shared/linklog.js): one line per link event into the watch's own storage; flushLink
    // sends the oldest ones to the PC's relay log whenever a request gets through.
    link(kind, detail) {
      try {
        linkRecord(localStorage, kind, detail)
      } catch (e) {}
    },

    lastClose() {
      try {
        return localStorage.getItem(TRACE, 'none')
      } catch (e) {
        return '?'
      }
    },

    flushLink() {
      if (this.state.linkSending) return
      let p
      try {
        p = linkPending(localStorage)
      } catch (e) {
        return
      }
      if (!p.count) return
      this.state.linkSending = true
      this.request({ method: 'linklog', params: { events: p.lines } }, { timeout: 10000 })
        .then((r) => { if (r && r.ok === true) linkAck(localStorage, p.count) }, () => {}) // an {ok:false} reply (old phone service, relay down) keeps the lines
        .then(() => { this.state.linkSending = false })
    },

    // ------------------------------------------------------------------ rating
    // Thumbs up / down under an answer: the relay saves the tap for the nightly
    // coach (hermes-jobs/hermes_learning.py). The tapped thumb is coloured; tapping it again takes it back.
    rateButtons(y, m) {
      const gap = 20
      const left = Math.round((W - 2 * RATE_W - gap) / 2)
      const row = { y, widgets: [] }
      for (const [kind, x] of [['up', left], ['down', left + RATE_W + gap]]) {
        row.widgets.push(this.add(hmUI.widget.BUTTON, {
          x, y, w: RATE_W, h: RATE_H, normal_src: `rate-${kind}${m.rated === kind ? '-on' : ''}.png`, press_src: `rate-${kind}-press.png`,
          click_func: () => this.rateAnswer(kind),
        }))
      }
      this.state.rateRow = row
      return y + RATE_H
    },

    rateAnswer(kind) {
      const m = this.model
      if (!m || m.screen !== 'answer' || !m.rate) return
      const before = m.rated || ''
      const rated = before === kind ? '' : kind
      this.setRated(m, rated)
      const failed = (note) => {
        const now = this.model
        if (!now || now.rate !== m.rate || (now.rated || '') !== rated) return // moved on, or tapped again
        this.show({ ...now, rated: before, rateNote: `Rating not saved: ${note}` })
      }
      this.phoneRequest({ method: 'rate', params: { rate: m.rate, kind: rated || 'none' } }, { timeout: 20000 })
        .then((r) => { if (!r || !r.ok) failed((r && r.error) || 'no reply') })
        .catch((e) => failed(phoneError(e)))
    },

    // Only the two thumbs are redrawn (after this click returns: deleting the pressed button inside its
    // own callback would crash the page), so a long answer stays scrolled where you were.
    setRated(m, rated) {
      this.model = { ...m, rated, rateNote: '' }
      this.save(this.model)
      const row = this.state.rateRow
      if (m.rateNote || !row) return this.show(this.model) // the note goes: full redraw
      this.state.timers.push(setTimeout(() => {
        if (this.state.rateRow !== row) return // the page was redrawn meanwhile
        for (const w of row.widgets) hmUI.deleteWidget(w)
        this.state.widgets = this.state.widgets.filter((w) => !row.widgets.includes(w))
        this.rateButtons(row.y, this.model)
      }, 10))
    },

    // ------------------------------------------------------------------ voice
    // Icons instead of words (images drawn by tools/voice-icons.py): the Voice speaker shows
    // sound waves = on, an X = off.
    // New chat (speech bubble), Record (ring + dot) and Voice share one row of icons, no words.
    // New chat drops the conversation (Hermes forgets the earlier turns); TALK above continues it.
    // Top row: keyboard left of TALK, review (eye) right of it; then the four icons below.
    talkRow(y, talk) {
      const tw = Math.round(W * 0.5)
      const x = Math.round((W - tw) / 2)
      this.button(y, 'TALK', GREEN, talk, tw, x)
      this.iconAt(x - ICON_GAP - ICON_W, y, 'keyboard')
      this.iconAt(x + tw + ICON_GAP, y, 'voice') // swapped with review
      return y + 80
    },

    iconRows(y) {
      return this.iconRow(y, ['chat', 'sessions']) // the eye (Review) is hidden: it is rarely used
    },

    iconAt(x, y, name) {
      if (name === 'chat') {
        this.add(hmUI.widget.BUTTON, { x, y, w: NEW_W, h: 80, radius: 40, text: 'New', text_size: Math.min(sp(30), 42),
          normal_color: GREY, press_color: 0x333333, click_func: () => this.askNewChat() })
        return
      }
      if (name === 'sessions') {
        this.add(hmUI.widget.BUTTON, { x, y, w: SESSIONS_W, h: 80, radius: 40, text: 'Sessions', text_size: Math.min(sp(30), 42),
          normal_color: PURPLE, press_color: 0x333333, click_func: () => this.openSessions() })
        return
      }
      const icon = name === 'voice' ? (this.state.voiceOn ? 'voice-on' : 'voice-off')
        : name === 'review' ? (this.state.reviewOn ? 'review-on' : 'review-off') : name
      const click = name === 'chat' ? () => this.askNewChat()
        : name === 'sessions' ? () => this.openSessions() : name === 'keyboard' ? () => this.openKeyboard()
        : name === 'review' ? () => this.toggleReview() : () => this.toggleVoice()
      this.add(hmUI.widget.BUTTON, { x, y, w: ICON_W, h: 80, normal_src: `${icon}.png`, press_src: `${icon}-press.png`, click_func: click })
    },

    iconRow(y, names) {
      const widthOf = (name) => (name === 'sessions' ? SESSIONS_W : name === 'chat' ? NEW_W : ICON_W)
      const total = names.reduce((sum, name) => sum + widthOf(name), 0) + (names.length - 1) * ICON_GAP
      let x = Math.round((W - total) / 2)
      for (const name of names) {
        this.iconAt(x, y, name)
        x += widthOf(name) + ICON_GAP
      }
      return y + 80
    },

    toggleVoice() {
      this.state.voiceOn = !this.state.voiceOn
      try {
        localStorage.setItem(VOICE_KEY, this.state.voiceOn ? 'on' : 'off')
      } catch (e) {}
      if (!this.state.voiceOn) this.stopVoice()
      this.show({ ...this.model, voiceNote: '' }) // redraw the button
    },

    // Review: off = STOP sends the recording to Hermes at once (fast conversation, the default);
    // on = after STOP the words show with Send / Cancel / keyboard first (check or fix them; handy for coding by voice).
    // The note under the icons says which one is on, since a coloured icon alone doesn't.
    toggleReview() {
      this.state.reviewOn = !this.state.reviewOn
      try {
        localStorage.setItem(REVIEW_KEY, this.state.reviewOn ? 'on' : 'off')
      } catch (e) {}
      const note = this.state.reviewOn ? 'Review on: check your words before they go to Hermes' : 'Review off: STOP sends to Hermes at once'
      this.show({ ...this.model, voiceNote: note, ...(this.model.screen === 'idle' ? { note } : {}) }) // idle shows note, the other screens voiceNote
    },

    // Ask the phone to fetch the MP3 clip(s) and send them here; each plays when its file arrives
    // (app.js), in order: a long answer is the first sentence, then the rest (shared/speechqueue.js).
    speak(speechId, parts = 1) {
      this.state.speechId = speechId
      this.state.queue = speechQueue(parts)
      // The phone pushes the audio on its own, so it can arrive before this answer was shown.
      const early = this.state.earlyFiles.filter((f) => f.id === speechId)
      this.state.earlyFiles = this.state.earlyFiles.filter((f) => f.id !== speechId)
      for (const f of early) this.playSpeech(f.path, { id: speechId, part: f.part })
      this.phoneRequest({ method: 'speech', params: { id: speechId, parts } }, { timeout: 120000 })
        .then((r) => {
          this.report(`speech ${speechId}: watch request -> ${r && r.ok ? 'ok' : (r && r.error) || 'no reply'}`)
          if (r && !r.ok && this.state.speechId === speechId) this.voiceProblem(r.error)
        })
        .catch((e) => {
          this.report(`speech ${speechId}: watch request failed: ${errText(e)}`)
          this.voiceProblem(`Voice: ${phoneError(e)}`)
        })
    },

    playSpeech(path, params) {
      const pid = params && params.id
      const part = Number(params && params.part) || 1
      const skip = !this.state.voiceOn ? 'voice off' : this.state.recording ? 'recording'
        : pid !== this.state.speechId || !this.state.queue ? `waiting for ${this.state.speechId}` : ''
      this.report(`speech ${pid}.${part}: file arrived ${path}${skip ? ` - not now (${skip})` : ''}`)
      if (skip) {
        if (this.state.voiceOn && !this.state.recording && pid) {
          // Not shown yet: keep it (newest few) for speak(); drop the oldest.
          this.state.earlyFiles.push({ id: pid, part, path })
          while (this.state.earlyFiles.length > 4) this.deleteFile(this.state.earlyFiles.shift().path)
        } else {
          this.deleteFile(path)
        }
        return
      }
      const now = this.state.queue.add(part, path)
      if (now) this.startPlayer(now) // else it waits for the clip before it to finish
    },

    // One player for the page, released (stop + release) the moment each clip finishes and reused
    // for the next one, like Zepp's Easy Media. A player still held when the app exits rebooted the
    // watch every time; released while
    // the app was open, it didn't. A second create() after a release returns nothing.
    startPlayer(path) {
      try {
        this.endPlayer()
        this.removeSpeechFile() // the previous clip's audio
        if (!this.state.player) this.state.player = create(id.PLAYER)
        const player = this.state.player
        if (!player) throw new Error("the watch's speaker is busy - close Hermes and open it again")
        if (!this.state.playerReady) {
          player.addEventListener(player.event.PREPARE, (ok) => {
            this.trace(`player prepare ${ok}`)
            this.report(`player prepare ${ok ? 'ok' : 'FAILED'} ${this.state.speechFile}`)
            if (ok) return player.start()
            this.endPlayer()
            this.voiceProblem(`Voice: the watch couldn't play it (${this.state.speechFile}).`)
          })
          player.addEventListener(player.event.COMPLETE, () => {
            this.endPlayer()
            this.trace('player complete, released')
            this.report('player complete, released')
            const next = this.state.queue ? this.state.queue.done() : null
            if (next) this.startPlayer(next) // the rest of a long answer
          })
          this.state.playerReady = true
        }
        this.state.speechFile = path
        this.state.playing = true
        player.setSource(player.source.FILE, { file: path })
        player.prepare()
      } catch (e) {
        this.endPlayer()
        this.voiceProblem(`Voice: ${errText(e)} (${path})`)
      }
    },

    // Stop and release the speaker; the player object stays for the next clip.
    endPlayer() {
      const player = this.state.player
      if (!player || !this.state.playing) return
      this.state.playing = false
      try {
        player.stop()
      } catch (e) {}
      try {
        player.release()
      } catch (e) {}
    },

    // Stop talking and drop clips still on their way (TALK, New chat, Voice off, closing).
    stopVoice() {
      this.state.queue = null
      this.endPlayer()
    },

    removeSpeechFile() {
      const file = this.state.speechFile
      this.state.speechFile = null
      this.deleteFile(file)
    },

    // The phone reuses a few file names for voice files, so a stale copy here must not linger.
    deleteFile(file) {
      if (!file) return
      try {
        rmSync({ path: file.replace(/^data:\/\//, '') })
      } catch (e) {}
    },

    // Voice failures never hide the answer: a small line under it says what went wrong.
    voiceProblem(message) {
      const m = this.model
      if (!m || !['answer', 'confirm'].includes(m.screen)) return
      this.show({ ...m, voiceNote: message || 'Voice: something went wrong.' })
    },

    startPoll(m) {
      this.state.busy = true
      this.show(m)
      const started = Date.now()
      let inFlight = 0 // when the current poll was sent (0: none)
      let seq = 0
      let failures = 0
      this.state.poll = setInterval(() => {
        if (inFlight && Date.now() - inFlight < POLL_STUCK_MS) return
        if (inFlight) {
          seq++ // the stuck poll's late reply, if any, is ignored
          const next = pollStep(null, failures)
          if (next.done) {
            this.cancelPoll()
            return this.finish(null)
          }
          failures = next.failures
        }
        if (Date.now() - started > POLL_LIMIT_MS) {
          this.cancelPoll()
          return this.finish({ ok: false, error: 'Hermes took more than 30 minutes. The answer may still arrive; reopen Hermes to check.' })
        }
        inFlight = Date.now()
        const mine = ++seq
        const step = (r) => {
          if (mine !== seq || !this.state.poll) return
          inFlight = 0
          const next = pollStep(r, failures)
          if (!next.done) return (failures = next.failures)
          this.cancelPoll()
          const done = next.reply
          this.finish(done && done.ok && !done.heard && m.heard ? { ...done, heard: m.heard.replace(/^You said: /, '') } : done)
        }
        this.phoneRequest({ method: 'result', params: { job: m.job, speak: this.state.voiceOn } }, { timeout: 20000 })
          .then(step)
          .catch(() => step(null)) // a dropped poll is retried on the next tick
      }, POLL_MS)
      this.armDim() // show() ran before the poll existed: start the black-out timer now
    },

    cancelPoll() {
      this.state.resumeToken++ // stops a reopen check (fetchLast) too
      if (this.state.poll) clearInterval(this.state.poll)
      this.state.poll = null
      this.state.busy = false
      this.show({ screen: 'idle' })
    },

    // phoneRequest, sent again (same request id) when an attempt gets no reply in attemptMs or the
    // phone says it couldn't reach the PC ({retry: true}); the only place lost replies are retried.
    resendRequest(req, opts, attemptMs, budgetMs = REQUEST_BUDGET_MS) {
      return resendUntil(() => this.phoneRequest(req, { ...opts, timeout: attemptMs }), { attemptMs, budgetMs })
    },

    // request() to the phone, retried for up to 15 s while iOS wakes the Zepp app ("shake timeout");
    // the waiting screen says "Waking the phone" meanwhile, with a line telling you to open Zepp
    // (a closed Zepp app looks like this every time, and the label alone didn't say what to do).
    phoneRequest(req, opts) {
      const waitingScreen = () => this.model && SPIN[this.model.screen]
      const wakeNote = (n) => n === OPEN_ZEPP || n === STUCK_NOTE
      const done = (r) => {
        this.state.waking = false
        this.state.wakeSince = 0
        if (waitingScreen() && wakeNote(this.model.note)) this.show({ ...this.model, note: this.state.noteBeforeWake || '' })
        return r
      }
      const onWait = () => {
        this.state.waking = true
        if (!this.state.wakeSince) this.state.wakeSince = Date.now()
        // First: open Zepp. If that doesn't help within STUCK_AFTER_MS, Zepp is probably open and the link is stuck.
        const note = Date.now() - this.state.wakeSince >= STUCK_AFTER_MS ? STUCK_NOTE : OPEN_ZEPP
        if (waitingScreen() && this.model.note !== note) {
          if (!wakeNote(this.model.note)) this.state.noteBeforeWake = this.model.note
          this.show({ ...this.model, note })
        }
      }
      // No Bluetooth link to the phone: say so now instead of after the wake-up wait (nothing could answer).
      if (bleUp() === false) {
        this.state.linkFailing = true
        this.link('fail', `${(req && req.method) || 'ask'} ble disconnect (checked before sending)`)
        return Promise.reject(new Error('ble disconnect'))
      }
      const t0 = Date.now()
      const method = (req && req.method) || 'ask'
      const finish = (error) => {
        const o = linkOutcome(method, Date.now() - t0, error, this.state.linkFailing)
        this.state.linkFailing = !!error
        if (o) this.link(o.kind, `${o.detail}${error ? ` ble ${bleUp()}` : ''}`)
        if (!error) this.flushLink() // the link works right now: send what the black box holds
      }
      const send = (budgetMs) => untilPhoneWakes(() => this.request(req, opts), { budgetMs, onWait })
      return send(WAKE_MS)
        .catch((e) => {
          // PROTOTYPE: the phone never answered. Rebuild the app's link to it once, then try one last time.
          if (!AUTO_RECONNECT || !shouldReconnect(e, Date.now(), this.state.reconAt)) return Promise.reject(e)
          this.state.reconAt = Date.now()
          return this.reconnectLink(`after ${method}: ${(e && e.message) || e}`).then(() => send(RECON_RETRY_MS))
        })
        .then((r) => { finish(null); return done(r) }, (e) => { finish(e); return Promise.reject(done(e)) })
    },

    // Prototype self-test (shared/debug.js RECON_SELFTEST): once, a few seconds after the app opens, on its own
    // timer (clearTimers() runs when listening starts and would wipe one in state.timers). It waits for a
    // quiet moment - not recording, no request in flight - so it can't cut off a real question.
    scheduleSelftest(delayMs, triesLeft) {
      this.state.selftestTimer = setTimeout(() => {
        this.state.selftestTimer = null
        if (this.state.recording || this.state.busy || this.state.playing) {
          if (triesLeft > 1) this.scheduleSelftest(10000, triesLeft - 1)
          else this.link('recon', 'selftest skipped: app busy')
          return
        }
        const t0 = Date.now()
        this.reconnectLink('selftest on a healthy link')
          .then(() => this.request({ method: 'settings' }, { timeout: 10000 }))
          .then(() => this.link('recon', `selftest ok: request answered ${Date.now() - t0} ms after start`), (e) => this.link('recon', `selftest FAILED: ${(e && e.message) || e}`))
          .then(() => this.flushLink())
      }, delayMs)
    },

    // zml's stop() cancels waiting requests, drops its handlers and closes the BLE message link; connect()
    // (the same chain onCreate runs) sets it up again. Every step goes into the link log.
    reconnectLink(why) {
      const t0 = Date.now()
      this.link('recon', `start: ${why} ble ${bleUp()}`)
      try {
        this.messaging.stop()
      } catch (e) {
        this.link('recon', `stop threw: ${(e && e.message) || e}`)
      }
      return new Promise((resolve) => {
        setTimeout(() => {
          try {
            this.messaging.onCall(this._onCall).onRequest(this._onRequest).onBleChanged(this._onBleChanged).connect()
            this.link('recon', `connected again after ${Date.now() - t0} ms ble ${bleUp()}`)
          } catch (e) {
            this.link('recon', `connect threw: ${(e && e.message) || e}`)
          }
          resolve()
        }, RECON_SETTLE_MS)
      })
    },

    // Past sessions: the last 20 conversations from the PC, newest first. Picking one makes
    // it the current session, so TALK carries on with its context (a build included); New chat starts fresh.
    openSessions() {
      if (this.state.busy) return
      this.state.busy = true
      this.state.waitSince = Date.now()
      this.show({ screen: 'thinking', heard: 'Past sessions' })
      this.phoneRequest({ method: 'sessions', params: {} }, { timeout: 30000 })
        .catch((e) => ({ ok: false, error: phoneError(e) }))
        .then((r) => {
          this.state.busy = false
          if (!r || !r.ok) return this.finish(r)
          this.show({ screen: 'sessions', rows: sessionRows(r, new Date()) })
        })
    },

    pickSession(row) {
      if (this.state.busy) return
      this.state.busy = true
      this.state.waitSince = Date.now()
      this.show({ screen: 'thinking', heard: 'Opening session' })
      this.resendRequest({ method: 'pickSession', params: { id: row.id, rid: newRid() } }, {}, ASK_ATTEMPT_MS)
        .catch((e) => ({ ok: false, error: phoneError(e) }))
        .then((r) => {
          if (!r || !r.ok) return this.finish(r)
          this.state.busy = false
          vibrate()
          this.show({ ...screenFor(r), heard: `Continuing: ${row.full || row.title}`, note: '' })
        })
    },

    // QWERTY keyboard: the watch's own keyboard (letters), then the text goes to Hermes
    // like a spoken question (relay /watch/ask takes {text}); Cancel just returns to the screen it came from.
    openKeyboard() {
      if (this.state.busy) return
      const back = this.model
      const close = () => { this.typingEnd(); try { hmUI.deleteKeyboard() } catch (e) {} }
      this.typingStart()
      try {
        hmUI.createKeyboard({
          inputType: hmUI.inputType.CHAR,
          text: '',
          onComplete: (_, result) => {
            close()
            const text = String((result && result.data) || '').trim()
            if (!text) return back && this.show(back)
            this.sendTyped(text)
          },
          onCancel: () => { close(); if (back) this.show(back) },
        })
      } catch (e) {
        this.typingEnd()
        this.show({ screen: 'error', heard: '', text: `Could not open the keyboard: ${errText(e)}` })
      }
    },

    // While the keyboard is open the screen must not time out or black out. typing stops the app's own dim timer; the system bright time is lifted to 10 minutes.
    typingStart() {
      this.state.typing = true
      if (this.state.dimTimer) clearTimeout(this.state.dimTimer)
      this.state.dimTimer = null
      this.keepAwake(WAIT_BRIGHT_MS)
    },

    typingEnd() {
      this.state.typing = false
    },

    // Edit what the mic heard: the keyboard opens with that text; when done, the card comes back with the
    // corrected words and you tap Send (nothing goes to Hermes from the keyboard itself). Cancel keeps the old text.
    editPreview(m) {
      if (this.state.busy) return
      const close = () => { this.typingEnd(); try { hmUI.deleteKeyboard() } catch (e) {} }
      this.typingStart()
      try {
        hmUI.createKeyboard({
          inputType: hmUI.inputType.CHAR,
          text: m.text,
          onComplete: (_, result) => {
            close()
            const text = String((result && result.data) || '').trim()
            this.show(text ? { ...m, text } : m)
          },
          onCancel: () => { close(); this.show(m) },
        })
      } catch (e) {
        this.typingEnd()
        this.show({ screen: 'error', heard: '', text: `Could not open the keyboard: ${errText(e)}` })
      }
    },

    sendTyped(text, where = {}) {
      if (this.state.busy) return
      this.state.busy = true
      this.keepAwake(WAIT_BRIGHT_MS)
      this.state.waitSince = Date.now()
      this.show({ screen: 'thinking', heard: text })
      this.resendRequest({ method: 'typed', params: { text, speak: this.state.voiceOn, rid: newRid(), ...where } }, {}, ASK_ATTEMPT_MS)
        .then((r) => this.finish(r))
        .catch((e) => this.finish({ ok: false, error: phoneError(e) }))
    },

    askNewChat() {
      if (this.state.busy) return
      this.state.beforeNewChat = this.model // Keep comes back to this screen (an answer being read, say)
      this.show({ screen: 'newchat' })
    },

    newChat() {
      if (this.state.busy) return
      this.stopVoice()
      this.state.speechId = null
      this.state.busy = true
      this.state.waitSince = Date.now()
      this.show({ screen: 'thinking', heard: 'New chat' })
      this.resendRequest({ method: 'newChat', params: { rid: newRid() } }, {}, ASK_ATTEMPT_MS)
        .catch((e) => ({ ok: false, error: phoneError(e) }))
        .then((r) => {
          if (!r || !r.ok) return this.finish(r)
          this.state.busy = false
          vibrate()
          this.show({ screen: 'idle', note: 'New chat started. Tap TALK and ask Hermes' })
        })
    },

    confirm(confirmId, yes, label, card) {
      if (this.state.busy) return
      this.state.busy = true
      this.keepAwake(WAIT_BRIGHT_MS)
      this.state.waitSince = Date.now()
      this.show({ screen: 'thinking', heard: label || (yes ? 'Yes' : 'No') })
      this.resendRequest({ method: 'confirm', params: { id: confirmId, yes, speak: this.state.voiceOn, rid: newRid() } }, {}, confirmAttemptMs(card))
        .then((r) => this.finish(r))
        .catch((e) => this.finish({ ok: false, error: phoneError(e) }))
    },
  }),
)
