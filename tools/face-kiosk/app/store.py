"""The kiosk's own records, in one SQLite file on the NAS volume.

  people  who the kiosk may recognise: SuZu One's roster for this device, plus any added by hand
  faces   one embedding per enrolment photo (512 floats). Never the photo itself.
  outbox  every punch until SuZu One has taken it; kept afterwards as the kiosk's own log
  kv      small status values (last roster sync, last push, last error)

Times are stored as UTC ISO strings, which sort as they compare.
"""

from __future__ import annotations

import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np

from .matcher import Gallery, normalise

SCHEMA = """
create table if not exists people (
  user_id text primary key,
  full_name text not null,
  employee_code text,
  source text not null check (source in ('roster', 'manual')),
  active integer not null default 1,
  inactive_since text,
  consent_at text,
  updated_at text not null
);
create table if not exists faces (
  id integer primary key,
  user_id text not null references people(user_id) on delete cascade,
  embedding blob not null,
  created_at text not null
);
create index if not exists faces_user on faces(user_id);
create table if not exists outbox (
  id integer primary key,
  user_id text not null,
  at text not null,
  created_at text not null,
  send_after text not null,
  sent_at text,
  cancelled integer not null default 0,
  failed_at text,
  error text,
  attempts integer not null default 0
);
create index if not exists outbox_pending on outbox(sent_at, cancelled, failed_at, send_after);
create index if not exists outbox_user_at on outbox(user_id, at);
create table if not exists kv (key text primary key, value text not null);
"""


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="seconds")


@dataclass(frozen=True)
class OutboxRow:
    id: int
    user_id: str
    at: str


class Store:
    def __init__(self, path: str | Path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        self._gallery: Gallery | None = None
        with self._lock:
            self._db.execute("pragma journal_mode = wal")
            self._db.execute("pragma foreign_keys = on")
            self._db.executescript(SCHEMA)

    def _rows(self, sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._db.execute(sql, tuple(params)).fetchall()

    def _run(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
        with self._lock:
            return self._db.execute(sql, tuple(params))

    # ── people and faces ────────────────────────────────────────────────────────────────────

    def sync_roster(self, roster: list[dict[str, Any]], now: datetime | None = None) -> dict[str, int]:
        """SuZu One's people for this device. Someone no longer on it stops being recognised at once;
        their faces are deleted after `purge_inactive` has waited its days (a roster mistake is undone
        by fixing the roster, without enrolling everyone again)."""
        stamp = iso(now or utcnow())
        ids = {str(person["userId"]) for person in roster}
        with self._lock:
            self._db.execute("begin")
            try:
                for person in roster:
                    self._db.execute(
                        """insert into people (user_id, full_name, employee_code, source, active, updated_at) values (?, ?, ?, 'roster', 1, ?)
                           on conflict(user_id) do update set full_name = excluded.full_name, employee_code = excluded.employee_code, source = 'roster', active = 1, inactive_since = null, updated_at = excluded.updated_at""",
                        (str(person["userId"]), person.get("fullName") or str(person["userId"]), person.get("employeeCode"), stamp),
                    )
                gone = [row["user_id"] for row in self._db.execute("select user_id from people where source = 'roster' and active = 1").fetchall() if row["user_id"] not in ids]
                for user_id in gone:
                    self._db.execute("update people set active = 0, inactive_since = ?, updated_at = ? where user_id = ?", (stamp, stamp, user_id))
                self._db.execute("commit")
            except Exception:
                self._db.execute("rollback")
                raise
        self._gallery = None
        return {"people": len(ids), "deactivated": len(gone)}

    def purge_inactive(self, days: int, now: datetime | None = None) -> int:
        cutoff = iso((now or utcnow()) - timedelta(days=days))
        doomed = [row["user_id"] for row in self._rows("select user_id from people where active = 0 and inactive_since <= ?", (cutoff,))]
        for user_id in doomed:
            self._run("delete from people where user_id = ?", (user_id,))
        if doomed:
            self._gallery = None
        return len(doomed)

    def add_manual(self, user_id: str, full_name: str, employee_code: str | None) -> None:
        stamp = iso(utcnow())
        self._run(
            """insert into people (user_id, full_name, employee_code, source, active, updated_at) values (?, ?, ?, 'manual', 1, ?)
               on conflict(user_id) do update set full_name = excluded.full_name, employee_code = excluded.employee_code, active = 1, inactive_since = null, updated_at = excluded.updated_at""",
            (user_id, full_name, employee_code, stamp),
        )

    def remove_person(self, user_id: str) -> None:
        self._run("delete from people where user_id = ?", (user_id,))
        self._gallery = None

    def person(self, user_id: str) -> sqlite3.Row | None:
        rows = self._rows("select * from people where user_id = ?", (user_id,))
        return rows[0] if rows else None

    def people(self) -> list[dict[str, Any]]:
        rows = self._rows(
            """select p.*, count(f.id) as faces from people p left join faces f on f.user_id = p.user_id
               group by p.user_id order by p.active desc, p.full_name collate nocase"""
        )
        return [dict(row) for row in rows]

    def add_faces(self, user_id: str, embeddings: list[np.ndarray], consent: bool) -> int:
        stamp = iso(utcnow())
        with self._lock:
            self._db.execute("begin")
            try:
                for embedding in embeddings:
                    self._db.execute("insert into faces (user_id, embedding, created_at) values (?, ?, ?)", (user_id, normalise(embedding).astype(np.float32).tobytes(), stamp))
                if consent:
                    self._db.execute("update people set consent_at = coalesce(consent_at, ?) where user_id = ?", (stamp, user_id))
                self._db.execute("commit")
            except Exception:
                self._db.execute("rollback")
                raise
        self._gallery = None
        return len(embeddings)

    def clear_faces(self, user_id: str) -> int:
        count = self._run("delete from faces where user_id = ?", (user_id,)).rowcount
        self._gallery = None
        return count

    def gallery(self) -> Gallery:
        """Faces of the people the kiosk may recognise now, held in memory until something changes."""
        if self._gallery is None:
            rows = self._rows("select f.user_id, f.embedding from faces f join people p on p.user_id = f.user_id where p.active = 1 order by f.id")
            owners = [row["user_id"] for row in rows]
            matrix = np.stack([np.frombuffer(row["embedding"], dtype=np.float32) for row in rows]) if rows else np.zeros((0, 0), dtype=np.float32)
            self._gallery = Gallery(owners, matrix)
        return self._gallery

    # ── punches ─────────────────────────────────────────────────────────────────────────────

    def add_punch(self, user_id: str, at: datetime, undo_seconds: float) -> int:
        cursor = self._run(
            "insert into outbox (user_id, at, created_at, send_after) values (?, ?, ?, ?)",
            (user_id, iso(at), iso(utcnow()), iso(at + timedelta(seconds=undo_seconds))),
        )
        return int(cursor.lastrowid or 0)

    def recent_punch(self, user_id: str, since: datetime) -> sqlite3.Row | None:
        rows = self._rows("select * from outbox where user_id = ? and cancelled = 0 and at >= ? order by at desc limit 1", (user_id, iso(since)))
        return rows[0] if rows else None

    def cancel_punch(self, punch_id: int) -> bool:
        """"Not me": only while the punch has not left for SuZu One."""
        return self._run("update outbox set cancelled = 1 where id = ? and sent_at is null and cancelled = 0", (punch_id,)).rowcount == 1

    def due(self, now: datetime, limit: int = 200) -> list[OutboxRow]:
        rows = self._rows(
            "select id, user_id, at from outbox where sent_at is null and cancelled = 0 and failed_at is null and send_after <= ? order by id limit ?",
            (iso(now), limit),
        )
        return [OutboxRow(row["id"], row["user_id"], row["at"]) for row in rows]

    def mark_sent(self, ids: list[int], now: datetime) -> None:
        with self._lock:
            self._db.executemany("update outbox set sent_at = ?, error = null, attempts = attempts + 1 where id = ?", [(iso(now), punch_id) for punch_id in ids])

    def mark_failed(self, ids: list[int], error: str, now: datetime) -> None:
        """For good: SuZu One refused these lines. They stay in the log, and can be retried by hand."""
        with self._lock:
            self._db.executemany("update outbox set failed_at = ?, error = ?, attempts = attempts + 1 where id = ?", [(iso(now), error, punch_id) for punch_id in ids])

    def mark_attempt(self, ids: list[int], error: str) -> None:
        with self._lock:
            self._db.executemany("update outbox set error = ?, attempts = attempts + 1 where id = ?", [(error, punch_id) for punch_id in ids])

    def retry(self, punch_id: int) -> bool:
        return self._run("update outbox set failed_at = null, error = null where id = ? and sent_at is null and cancelled = 0", (punch_id,)).rowcount == 1

    def events(self, limit: int = 100) -> list[dict[str, Any]]:
        rows = self._rows(
            """select o.*, coalesce(p.full_name, o.user_id) as full_name from outbox o left join people p on p.user_id = o.user_id
               order by o.id desc limit ?""",
            (limit,),
        )
        return [dict(row) for row in rows]

    def pending_count(self) -> int:
        return int(self._rows("select count(*) as n from outbox where sent_at is null and cancelled = 0 and failed_at is null")[0]["n"])

    # ── status ──────────────────────────────────────────────────────────────────────────────

    def set_status(self, key: str, value: str) -> None:
        self._run("insert into kv (key, value) values (?, ?) on conflict(key) do update set value = excluded.value", (key, value))

    def status(self) -> dict[str, str]:
        return {row["key"]: row["value"] for row in self._rows("select key, value from kv")}
