// The "past sessions" list: up to 20 earlier conversations, newest first, from the
// relay's GET /watch/sessions. Plain JS, so it runs on the watch and in Node tests.

export const SESSION_TITLE_CHARS = 46 // two wrapped lines on a card
export const ANSWER_CHARS = 56 // about two wrapped lines of the card's reply text
export const SESSION_LIMIT = 10 // only the last 10 sessions
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function clock(d) {
  const h = d.getHours()
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`
}

// "3:42 PM" today, "Yesterday 3:42 PM", else "Oct 26 3:42 PM".
export function whenText(ts, now = new Date()) {
  const d = new Date(ts * 1000)
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const apart = Math.round((day(now) - day(d)) / 86400000)
  if (apart === 0) return clock(d)
  if (apart === 1) return `Yesterday ${clock(d)}`
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${clock(d)}`
}

export function cleanText(t) {
  return String(t || '').replace(/\s+/g, ' ').trim()
}

export function shortTitle(title) {
  const t = String(title || 'Untitled').replace(/\s+/g, ' ').trim() || 'Untitled'
  return t.length > SESSION_TITLE_CHARS ? `${t.slice(0, SESSION_TITLE_CHARS - 1).trimEnd()}…` : t
}

// Hermes' last reply, cut to about two card lines (the card does no measuring, so the length is decided here)
export function shortAnswer(t) {
  const a = cleanText(t)
  return a.length > ANSWER_CHARS ? `${a.slice(0, ANSWER_CHARS - 1).trimEnd()}…` : a
}

// reply from the relay -> rows for the list ([] when the reply is bad or empty)
export function sessionRows(reply, now = new Date()) {
  if (!reply || !reply.ok || !Array.isArray(reply.sessions)) return []
  return reply.sessions.slice(0, SESSION_LIMIT).map((s) => ({
    id: s.id,
    title: shortTitle(s.title),
    // the card's top text: the whole title; the card wraps it onto at most 2 lines
    lines: cleanText(s.title) || 'Untitled',
    full: String(s.title || ''),
    // Hermes' last reply in that session, so you can tell which ones still need you
    answer: shortAnswer(s.answer),
    sub: `${whenText(s.last, now)} · ${s.turns} ${s.turns === 1 ? 'question' : 'questions'}`,
    current: !!reply.current && s.id === reply.current,
  }))
}
