"""Talking to SuZu One: punches out, the roster in. A background thread; never blocks the camera.

Punches wait in the outbox for the "Not me" window, then go in batches. SuZu One ignores a punch it
already has, so anything that may or may not have arrived (a timeout, a dropped connection) is
simply sent again. A 400 is SuZu One saying the line itself is wrong: it is set aside for a person
to look at rather than retried forever.
"""

from __future__ import annotations

import logging
import threading
import time
import httpx

from .config import Config
from .store import Store, iso, utcnow

log = logging.getLogger("face-kiosk.sender")

PUSH_EVERY = 3.0
HEARTBEAT_EVERY = 300.0
ROSTER_EVERY = 600.0


class Sender:
    def __init__(self, config: Config, store: Store):
        self.config = config
        self.store = store
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._client = httpx.Client(base_url=config.suzu_url, timeout=20.0, headers={"authorization": f"Bearer {config.device_token}", "user-agent": "suzu-face-kiosk/1"})
        self._last_contact = 0.0
        self._last_roster = 0.0

    def start(self) -> None:
        if not self.config.suzu_configured:
            log.warning("SUZU_URL / SUZU_DEVICE_TOKEN not set: punches stay in the outbox")
            return
        threading.Thread(target=self._loop, name="sender", daemon=True).start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()

    def nudge(self) -> None:
        self._wake.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                if time.monotonic() - self._last_roster >= ROSTER_EVERY:
                    self.sync_roster()
                self.push_due()
            except Exception as error:  # the loop must outlive any one failure
                log.exception("sender loop")
                self.store.set_status("last_error", f"{iso(utcnow())} {error}")
            self._wake.wait(PUSH_EVERY)
            self._wake.clear()

    def _note_error(self, message: str) -> None:
        log.warning(message)
        self.store.set_status("last_error", f"{iso(utcnow())} {message}")

    def sync_roster(self) -> dict[str, int] | None:
        self._last_roster = time.monotonic()
        try:
            response = self._client.get("/api/attendance/device/roster")
        except httpx.HTTPError as error:
            self._note_error(f"roster: {error.__class__.__name__}")
            return None
        if response.status_code != 200:
            self._note_error(f"roster: HTTP {response.status_code}")
            return None
        body = response.json()
        result = self.store.sync_roster(body.get("people", []))
        self.store.purge_inactive(self.config.purge_inactive_days)
        self.store.set_status("device_name", str(body.get("device", "")))
        self.store.set_status("last_roster", f"{iso(utcnow())} {result['people']} people")
        return result

    def push_due(self) -> None:
        now = utcnow()
        due = self.store.due(now)
        if not due and time.monotonic() - self._last_contact < HEARTBEAT_EVERY:
            return
        payload = {"punches": [{"userId": row.user_id, "at": row.at} for row in due]}
        ids = [row.id for row in due]
        try:
            response = self._client.post("/api/attendance/device/punches", json=payload)
        except httpx.HTTPError as error:
            self.store.mark_attempt(ids, f"network: {error.__class__.__name__}")
            self._note_error(f"push: {error.__class__.__name__}")
            return
        if response.status_code == 200:
            self._last_contact = time.monotonic()
            body = response.json()
            refused = {ids[number - 1] for number in body.get("refused", []) if 0 < number <= len(ids)}
            if refused:
                self.store.mark_failed(sorted(refused), "SuZu One: time is in the future (check the NAS clock)", utcnow())
            self.store.mark_sent([punch_id for punch_id in ids if punch_id not in refused], utcnow())
            self.store.set_status("last_push", f"{iso(utcnow())} +{body.get('punches', 0)} punches, {body.get('unmapped', 0)} unmapped")
        elif response.status_code == 400:
            self.store.mark_failed(ids, f"SuZu One refused the batch: {response.text[:300]}", utcnow())
            self._note_error("push: HTTP 400")
        else:
            # 401 (token revoked or wrong), 5xx: keep everything and try again.
            self.store.mark_attempt(ids, f"HTTP {response.status_code}")
            self._note_error(f"push: HTTP {response.status_code}")
