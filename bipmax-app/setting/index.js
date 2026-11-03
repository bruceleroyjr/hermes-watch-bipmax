/*
 * Settings App of Hermes: the phone-side screen in the Zepp app (Hermes > Settings).
 * Connection: the Tailscale URL of your relay and the token it shares with the watch (used by the side service at
 * once). Display: when the screen goes black, reply text size, listen-on-open (the watch asks the side service for
 * these when the app opens, so a change applies the next time Hermes is opened).
 */
import { TEXT_SIZE_KEY, TEXT_SIZE_MIN, TEXT_SIZE_MAX, TEXT_SIZE_STEP, textSizePercent } from '../shared/textsize.js'
import { AUTO_LISTEN_KEY, autoListenOn } from '../shared/autolisten.js'
import { RELAY_URL_KEY, TOKEN_KEY, normalizeRelayUrl, cleanToken } from '../shared/connection.js'
import { DIM_KEY, DIM_MIN, DIM_MAX, DIM_STEP, dimSeconds, dimLabel } from '../shared/dimsetting.js'

// A white box with a border, so the field reads as something to tap and type in.
const FIELD_STYLE = { background: '#ffffff', backgroundColor: '#ffffff', border: '1px solid #c8c8c8', borderRadius: '10px', padding: '12px 14px', fontSize: '16px', color: '#222222', minHeight: '24px' }

AppSettingsPage({
  build(props) {
    const store = props.settingsStorage
    const current = dimSeconds(store.getItem(DIM_KEY))
    const size = textSizePercent(store.getItem(TEXT_SIZE_KEY))
    const auto = autoListenOn(store.getItem(AUTO_LISTEN_KEY))
    const relayRaw = store.getItem(RELAY_URL_KEY) || ''
    const relay = normalizeRelayUrl(relayRaw)
    const hasToken = !!cleanToken(store.getItem(TOKEN_KEY))
    const status = !relayRaw ? 'No relay URL yet.' : relay ? `Will connect to ${relay}` : 'That does not look like a URL. Example: https://my-pc.tail1234.ts.net:8453'
    return View({ style: { padding: '12px 16px' } }, [
      Text({ bold: true, paragraph: true, style: { fontSize: '20px', marginBottom: '8px' } }, 'Your Hermes relay'),
      Text({ paragraph: true, style: { color: '#666', marginBottom: '12px' } },
        'The watch talks to the relay (relay.js) running next to your Hermes Agent on your PC or cloud machine, over Tailscale. Your phone needs Tailscale on. Paste the https address that `tailscale serve` gives you, and the token from your relay config.json.'),
      TextInput({
        label: 'Relay URL',
        settingsKey: RELAY_URL_KEY,
        placeholder: 'https://my-pc.tail1234.ts.net:8453',
        labelStyle: { fontSize: '14px', color: '#333', marginBottom: '4px' },
        subStyle: FIELD_STYLE,
      }),
      Text({ paragraph: true, style: { color: relay || !relayRaw ? '#666' : '#c0392b', marginTop: '4px', marginBottom: '12px' } }, status),
      TextInput({
        label: 'Token',
        settingsKey: TOKEN_KEY,
        placeholder: 'the token from your relay config.json',
        labelStyle: { fontSize: '14px', color: '#333', marginBottom: '4px' },
        subStyle: FIELD_STYLE,
      }),
      Text({ paragraph: true, style: { color: '#666', marginTop: '4px', marginBottom: '16px' } },
        hasToken ? 'A token is saved. It stays on your phone and goes only to your relay.' : 'No token yet. It stays on your phone and goes only to your relay.'),
      Text({ bold: true, paragraph: true, style: { fontSize: '20px', marginTop: '8px', marginBottom: '8px' } }, 'Listen when Hermes opens'),
      Text({ paragraph: true, style: { color: '#666', marginBottom: '12px' } },
        'Off: Hermes opens on the home screen and waits for TALK. On: it opens straight to the listening screen. It applies the next time you open Hermes.'),
      Toggle({
        label: 'Start listening on open',
        value: auto,
        onChange: (v) => store.setItem(AUTO_LISTEN_KEY, v ? 'true' : 'false'),
      }),
      Text({ bold: true, paragraph: true, style: { fontSize: '20px', marginTop: '20px', marginBottom: '8px' } }, 'Screen goes black after'),
      Text({ paragraph: true, style: { color: '#666', marginBottom: '12px' } },
        'If you do not touch Hermes for this long, the watch screen goes black. Tap the screen to bring it back. It applies the next time you open Hermes.'),
      Slider({
        label: `Go black after ${dimLabel(current)}`,
        min: DIM_MIN, max: DIM_MAX, step: DIM_STEP, value: current,
        onChange: (v) => store.setItem(DIM_KEY, String(v)),
      }),
      Text({ paragraph: true, style: { color: '#666', marginTop: '8px' } }, `${dimLabel(DIM_MIN)} to ${dimLabel(DIM_MAX)}.`),
      Text({ bold: true, paragraph: true, style: { fontSize: '20px', marginTop: '20px', marginBottom: '8px' } }, 'Reply text size'),
      Text({ paragraph: true, style: { color: '#666', marginBottom: '12px' } }, 'How big Hermes replies read on the watch. It applies the next time you open Hermes.'),
      Slider({
        label: `Reply text size: ${size}%`,
        min: TEXT_SIZE_MIN, max: TEXT_SIZE_MAX, step: TEXT_SIZE_STEP, value: size,
        onChange: (v) => store.setItem(TEXT_SIZE_KEY, String(v)),
      }),
      Text({ paragraph: true, style: { color: '#666', marginTop: '8px' } }, `${TEXT_SIZE_MIN}% is the normal size, ${TEXT_SIZE_MAX}% is double.`),
    ])
  },
})
