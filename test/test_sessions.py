"""Run: python -m unittest test/test_sessions.py   (reads a throwaway state.db, never your real one)"""
import importlib.util
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load(db_path):
    os.environ["HERMES_STATE_DB"] = str(db_path)
    spec = importlib.util.spec_from_file_location("sessions", HERE.parent / "lib" / "sessions.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class SessionsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.db = Path(self.dir.name) / "state.db"
        c = sqlite3.connect(self.db)
        c.executescript("""
            create table sessions (id text, title text, source text, started_at real, last_activity_at real);
            create table messages (id integer primary key, session_id text, role text, content text, tool_calls text, timestamp real);
        """)
        c.execute("insert into sessions values ('watch-20260101-aaaaaa', 'Roth IRA', 'api_server', 1, 5)")
        c.execute("insert into sessions values ('watch-20260101-bbbbbb', '', 'api_server', 1, 6)")  # empty: "New chat" tap
        c.execute("insert into sessions values ('other-1', 'Telegram chat', 'telegram', 1, 7)")
        for role, text in [("user", "what is a roth ira\n\n(Rule for this answer: be short)"), ("assistant", "A retirement account.\nCONFIRM: x")]:
            c.execute("insert into messages (session_id, role, content, timestamp) values ('watch-20260101-aaaaaa', ?, ?, 2)", (role, text))
        c.commit()
        c.close()
        self.mod = load(self.db)

    def tearDown(self):
        self.dir.cleanup()

    def test_list_only_watch_sessions_with_messages(self):
        r = self.mod.list_sessions("default", 10)
        self.assertEqual([s["id"] for s in r["sessions"]], ["watch-20260101-aaaaaa"])
        self.assertEqual(r["sessions"][0]["title"], "Roth IRA")
        self.assertEqual(r["sessions"][0]["answer"], "A retirement account.")

    def test_show_strips_watch_rules_and_confirm_lines(self):
        r = self.mod.show("watch-20260101-aaaaaa")
        self.assertEqual(r, {"ok": True, "heard": "what is a roth ira", "text": "A retirement account."})


if __name__ == "__main__":
    unittest.main()
