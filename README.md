# Hermes for the Amazfit Bip Max

Talk to your own [Hermes Agent](https://github.com/NousResearch/hermes-agent) from an **Amazfit Bip Max**
(Zepp OS). Tap **TALK**, speak, and read (or hear) the answer on your wrist.

You run two small pieces yourself: a **relay** next to your Hermes Agent (on your PC or a cloud machine) and
this **watch app**. They are joined over [Tailscale](https://tailscale.com), and you tell the app where your
relay is, and its token, in the phone settings. Nothing about your setup is built into the app.

## What it does

- **Voice in, text and voice out.** The watch records; your machine transcribes with Whisper and asks Hermes.
  The answer shows as text first, then is read out (the speaker button turns voice on and off).
- **Keyboard and review.** Type a question on the watch, or review what the mic heard (fix it with the
  keyboard) before Hermes gets it.
- **Past sessions.** A list of your recent watch conversations; pick one to carry on with its context.
  **New** starts a fresh one.
- **Approve / Deny on the watch** when Hermes asks for approval, **Yes / No** cards for proposed actions.
- **Thumbs up / down** under answers, saved to `ratings.jsonl` on your machine.
- **Knows where you are** (GPS while the app is open; see the privacy note below).
- Long answers are paged, text size and "go black after" are phone settings, and the app survives the
  screen timing out.

## How it works

```
watch app (Zepp OS)
  -> Zepp app on your phone (side service)
  -> https://<your-machine>.<tailnet>.ts.net:8453        (Tailscale; your relay URL)
  -> relay.js (127.0.0.1:8796)
       -> stt/stt_worker.py (127.0.0.1:8797, faster-whisper + edge-tts)
       -> your Hermes Agent API server (127.0.0.1:8642)
```

## Requirements

- Amazfit Bip Max and the Zepp app on your phone
- A machine running Hermes Agent with its API server on (Windows, Linux or macOS), Node.js 20+, Python 3.10+
- Tailscale on that machine and on the phone
- The [Zeus CLI](https://docs.zepp.com/docs/guides/tools/cli/) (`npm i -g @zeppos/zeus-cli`) and a Zepp
  developer account

## Setup

### 1. Relay machine

1. Copy `config.example.json` to `config.json`. `token` is any long random string (for example
   `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`). Fill in the rest; never
   commit `config.json`.
2. Give the relay your Hermes API key. It looks in this order: the `API_SERVER_KEY` environment variable,
   `"hermesKey"` in `config.json`, then `API_SERVER_KEY=` in Hermes' `.env`
   (`HERMES_ENV_FILE`, `%LOCALAPPDATA%\hermes\.env` or `~/.hermes/.env`).
3. Start speech-to-text, then the relay:
   ```
   python -m venv stt/.venv
   stt/.venv/bin/pip install -r stt/requirements.txt        # Windows: stt\.venv\Scripts\pip
   stt/.venv/bin/python stt/stt_worker.py
   node relay.js
   ```
   Set `WATCH_PYTHON=python3` if your Python is called that (used to read past sessions); `HERMES_STATE_DB`
   points at Hermes' `state.db` if it is not in the default place.
4. Put it on your tailnet (Tailscale `serve`, not `funnel`, keeps it private):
   ```
   tailscale serve --bg --https=8453 http://127.0.0.1:8796
   ```
   The address it prints, `https://<machine>.<tailnet>.ts.net:8453`, is your **relay URL**.

### 2. Watch app

1. Register an app in the Zepp developer console and put its id and your name in `bipmax-app/app.json`.
2. Build and install:
   ```
   cd bipmax-app
   npm ci
   zeus preview        # choose Amazfit Bip Max, scan the QR code in the Zepp app
   ```
3. On your phone, with Tailscale on, open **Zepp app > Hermes > Settings** and fill in
   **Relay URL (Tailscale)** and **Token** (the same string as in the relay's `config.json`). Changes apply
   immediately; the app tells you on the watch if either is missing or wrong.

## Relay API

All but `/health` need `Authorization: Bearer <token>`.

- `POST /watch/ask` `{audio_b64}` or `{text}`, plus `loc` / `gps`, `speak`, `rid`; `preview: true` with audio
  only transcribes -> `{kind: transcript, heard}`
- `POST /watch/confirm` `{id, yes}`; `POST /watch/result` / `GET /watch/result?job=`; `GET /watch/last`
- `GET /watch/sessions` -> recent sessions; `POST /watch/session` `{id}` -> resume one
- `GET /watch/speech?id=&part=N` -> a spoken clip (`audio/mpeg`)
- `POST /watch/rate`, `POST /watch/diag`, `GET /health`

## Security and privacy

- The relay listens on `127.0.0.1` only; Tailscale keeps it inside your tailnet. Every request needs the
  token, which is stored in the Zepp app's settings on your phone and sent only to your relay.
- Hermes is told never to run texts or car tools itself; those run only through the relay after a **Yes**.
- **Location:** each question's coordinates go to your Hermes model provider and to OpenStreetMap's public
  Nominatim service (for a place name). The relay log records them too. To turn location off, remove
  `device:os.geolocation` from `bipmax-app/app.json`.
- **Voice:** spoken answers are made with Microsoft's edge-tts; the answer text is sent there. Voice off
  sends nothing.

## Troubleshooting

- **"Hermes is not set up yet"**: fill in Hermes > Settings in the Zepp app.
- **"Can't reach the PC"**: is Tailscale on for the phone? Does the URL open `.../health` in the phone's browser?
- **"The watch token was rejected"**: the token differs from the relay's `config.json`.
- **Logs**: `relay.log`, `stt/stt.log`.

## Tests

```
node --test "test/*.test.js"
cd bipmax-app && npm ci && node --test test/*.test.mjs
python -m unittest test/test_sessions.py
stt/.venv/bin/python -m unittest stt/test_stt_worker.py
```

## License

MIT
