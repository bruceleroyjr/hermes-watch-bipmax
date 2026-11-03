// Where the watch's phone side talks to: the user's own relay (relay.js on their PC or cloud machine,
// reached over Tailscale) and the token it shares with that relay. Both are typed into the Zepp app
// (Hermes > Settings) and stored there; nothing is baked into the build. Plain JS, shared with Node tests.

export const RELAY_URL_KEY = 'relayUrl'
export const TOKEN_KEY = 'relayToken'

// A stored value, maybe JSON-quoted by the settings storage -> a plain trimmed string.
function plain(raw) {
  let v = raw
  try {
    if (typeof v === 'string' && /^["[]/.test(v.trim())) v = JSON.parse(v)
  } catch (e) {}
  if (Array.isArray(v)) v = v[0]
  return typeof v === 'string' ? v.trim() : ''
}

// What was typed -> "https://host:port" with no trailing slash, or '' when it is not a usable URL.
// A missing scheme gets https:// (what `tailscale serve --https` gives); a pasted path like /watch/ask is dropped.
export function normalizeRelayUrl(raw) {
  let s = plain(raw)
  if (!s || /\s/.test(s)) return ''
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`
  const m = /^(https?):\/\/([^\s/?#]+)/i.exec(s)
  if (!m) return ''
  const host = m[2]
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) && !/^\[[0-9a-f:]+\](:\d{1,5})?$/i.test(host)) return ''
  return `${m[1].toLowerCase()}://${host.toLowerCase()}`
}

export function cleanToken(raw) {
  return plain(raw).replace(/^bearer\s+/i, '')
}

// Settings storage -> {relay, token, error}. error is a sentence for the watch screen when something is missing.
export function readConnection(store) {
  const relay = normalizeRelayUrl(store && store.getItem(RELAY_URL_KEY))
  const token = cleanToken(store && store.getItem(TOKEN_KEY))
  if (!relay && !token) return { relay, token, error: 'Hermes is not set up yet. In the Zepp app on your phone open Hermes > Settings and enter your relay URL and token.' }
  if (!relay) return { relay, token, error: 'The relay URL is missing or not valid. Check Hermes > Settings in the Zepp app.' }
  if (!token) return { relay, token, error: 'The token is missing. Enter it in Hermes > Settings in the Zepp app.' }
  return { relay, token, error: '' }
}
