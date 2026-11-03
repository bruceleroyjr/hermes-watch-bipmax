"""Past watch conversations for the watch's session list (read-only on Hermes' state.db).

  python sessions.py list <device> [limit]   -> {"ok": true, "sessions": [{id, title, last, turns, answer}]}  (answer = Hermes' last reply)
  python sessions.py show <session id>       -> {"ok": true, "heard": ..., "text": ...}  (last question + answer)

<device> is 'default' (ids watch-<date>-...); the relay always passes that. Output is one JSON line on stdout.
"""
import json
import os
import re
import sqlite3
import sys
from pathlib import Path

def _default_db():
    # Hermes keeps state.db in its home folder: %LOCALAPPDATA%\hermes on Windows, ~/.hermes elsewhere.
    # Set HERMES_STATE_DB if yours lives somewhere else.
    local = os.environ.get("LOCALAPPDATA")
    if local and (Path(local) / "hermes" / "state.db").exists():
        return Path(local) / "hermes" / "state.db"
    return Path.home() / ".hermes" / "state.db"


STATE_DB = Path(os.environ.get("HERMES_STATE_DB") or _default_db())
INJECTED = re.compile(r"^\s*(\[ASYNC DELEGATION|\[System:|\[IMPORTANT:|Gateway message origin|\[SYSTEM)", re.I)
# The relay appends the GPS note and its action rules to every question; Hermes ends some answers with a CONFIRM: line.
WATCH_RULE = re.compile(r"\n\n\((Watch GPS|Rule for this answer):.*$", re.S)
CONFIRM = re.compile(r"\n*CONFIRM:.*$", re.S)
OUT_OF_BAND = re.compile(r"^\s*\[OUT-OF-BAND USER MESSAGE[^\]]*\]\s*", re.I)
NEW_CHAT = re.compile(r"^\s*(start|begin) (a )?new (session|chat)\W*$", re.I)


def clean_user(text):
    text = (text or "").strip()
    if not text or INJECTED.match(text):
        return None
    text = WATCH_RULE.sub("", OUT_OF_BAND.sub("", text)).strip()
    return None if not text or NEW_CHAT.match(text) else text


def pattern(device):
    # default watch: watch-20261025-ab12cd; another: watch-bipmax-20261025-ab12cd
    return "watch-[0-9]*" if device == "default" else f"watch-{device}-*"


def open_db():
    return sqlite3.connect(f"file:{STATE_DB.as_posix()}?mode=ro", uri=True)


def turns(db, sid):
    out = []
    for role, content, tool_calls, ts in db.execute(
            "select role, content, tool_calls, timestamp from messages where session_id = ? order by id", (sid,)):
        if role == "user":
            text = clean_user(content)
        elif role == "assistant" and not tool_calls:
            text = CONFIRM.sub("", content or "").strip() or None
        else:
            text = None
        if text:
            out.append({"who": role, "text": text, "ts": ts})
    return out


def list_sessions(device, limit):
    db = open_db()
    rows = db.execute(
        "select id, title, coalesce(last_activity_at, started_at) from sessions "
        "where id glob ? and source = 'api_server' order by coalesce(last_activity_at, started_at) desc limit 80",
        (pattern(device),)).fetchall()
    out = []
    for sid, title, last in rows:
        t = turns(db, sid)
        users = [x for x in t if x["who"] == "user"]
        if not users:
            continue  # "New chat" taps and other empty sessions
        answers = [x for x in t if x["who"] == "assistant"]
        answer = re.sub(r"\s+", " ", answers[-1]["text"]).strip()[:70] if answers else ""
        out.append({"id": sid, "title": (title or users[0]["text"])[:60].strip(), "last": t[-1]["ts"],
                    "turns": len(users), "answer": answer})
        if len(out) >= limit:
            break
    db.close()
    return {"ok": True, "sessions": out}


def show(sid):
    db = open_db()
    t = turns(db, sid)
    db.close()
    answers = [x for x in t if x["who"] == "assistant"]
    users = [x for x in t if x["who"] == "user"]
    if not users:
        return {"ok": False, "error": "That session has no messages."}
    return {"ok": True, "heard": users[-1]["text"], "text": answers[-1]["text"] if answers else ""}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        if sys.argv[1] == "list":
            res = list_sessions(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 20)
        elif sys.argv[1] == "show":
            res = show(sys.argv[2])
        else:
            res = {"ok": False, "error": "usage"}
    except Exception as e:  # noqa: BLE001 - the watch only needs the message
        res = {"ok": False, "error": f"Could not read sessions: {e}"}
    print(json.dumps(res))
