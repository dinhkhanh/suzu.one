from datetime import datetime, timedelta, timezone

import numpy as np

from app.store import Store

T0 = datetime(2026, 10, 1, 1, 30, tzinfo=timezone.utc)


def vec(*values):
    return np.array(values, dtype=np.float32)


def test_roster_sync_deactivates_and_later_purges(tmp_path):
    store = Store(tmp_path / "k.db")
    store.sync_roster([{"userId": "SZM-1", "fullName": "An"}, {"userId": "SZM-2", "fullName": "Bình"}], now=T0)
    store.add_faces("SZM-1", [vec(1, 0, 0)], consent=True)
    store.add_faces("SZM-2", [vec(0, 1, 0)], consent=True)
    assert len(store.gallery()) == 2

    result = store.sync_roster([{"userId": "SZM-2", "fullName": "Bình"}], now=T0)
    assert result == {"people": 1, "deactivated": 1}
    # Off the roster: not recognised any more, faces kept for now.
    assert store.gallery().owners == ["SZM-2"]
    assert store.purge_inactive(30, now=T0 + timedelta(days=29)) == 0
    assert store.purge_inactive(30, now=T0 + timedelta(days=31)) == 1
    assert [p["user_id"] for p in store.people()] == ["SZM-2"]


def test_back_on_the_roster_is_recognised_again(tmp_path):
    store = Store(tmp_path / "k.db")
    store.sync_roster([{"userId": "SZM-1", "fullName": "An"}], now=T0)
    store.add_faces("SZM-1", [vec(1, 0, 0)], consent=True)
    store.sync_roster([], now=T0)
    assert len(store.gallery()) == 0
    store.sync_roster([{"userId": "SZM-1", "fullName": "An"}], now=T0)
    assert len(store.gallery()) == 1


def test_manual_people_survive_a_roster_sync(tmp_path):
    store = Store(tmp_path / "k.db")
    store.add_manual("17", "Khách", None)
    store.sync_roster([], now=T0)
    assert store.people()[0]["active"] == 1


def test_outbox_waits_for_the_undo_window_then_sends(tmp_path):
    store = Store(tmp_path / "k.db")
    first = store.add_punch("SZM-1", T0, undo_seconds=8)
    second = store.add_punch("SZM-2", T0, undo_seconds=8)
    assert store.due(T0 + timedelta(seconds=5)) == []
    assert store.cancel_punch(second) is True
    due = store.due(T0 + timedelta(seconds=9))
    assert [row.id for row in due] == [first] and due[0].at == "2026-10-01T01:30:00+00:00"
    store.mark_sent([first], T0)
    assert store.cancel_punch(first) is False  # already gone to SuZu One
    assert store.pending_count() == 0


def test_failed_lines_stop_until_retried(tmp_path):
    store = Store(tmp_path / "k.db")
    punch = store.add_punch("SZM-1", T0, undo_seconds=0)
    store.mark_failed([punch], "refused", T0)
    assert store.due(T0 + timedelta(minutes=1)) == []
    assert store.retry(punch) is True
    assert [row.id for row in store.due(T0 + timedelta(minutes=1))] == [punch]


def test_recent_punch_ignores_cancelled_ones(tmp_path):
    store = Store(tmp_path / "k.db")
    punch = store.add_punch("SZM-1", T0, undo_seconds=8)
    assert store.recent_punch("SZM-1", T0 - timedelta(seconds=60))["id"] == punch
    store.cancel_punch(punch)
    assert store.recent_punch("SZM-1", T0 - timedelta(seconds=60)) is None
