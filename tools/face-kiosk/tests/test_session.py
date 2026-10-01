from datetime import datetime, timedelta, timezone

import numpy as np

from app.matcher import Gallery, Match, normalise
from app.session import Face, KioskSession, Punch, Settings
from tests.test_liveness import head

AN = normalise(np.array([1.0, 0.0, 0.0, 0.0]))
BINH = normalise(np.array([0.0, 1.0, 0.0, 0.0]))
STRANGER = normalise(np.array([0.0, 0.0, 1.0, 0.0]))
T0 = datetime(2026, 10, 1, 1, 30, tzinfo=timezone.utc)


def face(embedding, yaw=0.0, width=200.0):
    return Face(bbox=(0.0, 0.0, width, width * 1.3), kps=head(yaw).tolist(), embedding=embedding, det_score=0.9)


class FakeHooks:
    def __init__(self):
        self.gallery = Gallery(["an", "an", "binh"], np.stack([AN, AN, BINH]))
        self.punches: list[tuple[str, datetime]] = []

    def identify(self, embedding):
        return self.gallery.identify(embedding, 0.45, 0.08)

    def score_for(self, user_id, embedding):
        return self.gallery.score_for(user_id, embedding)

    def name_of(self, user_id):
        return {"an": "Nguyễn An", "binh": "Trần Bình"}.get(user_id, user_id)

    def recent_punch(self, user_id, wall):
        for index, (who, at) in reversed(list(enumerate(self.punches))):
            if who == user_id and at >= wall - timedelta(seconds=60):
                return Punch(id=index + 1, at=at, repeat=True)
        return None

    def punch(self, user_id, wall):
        self.punches.append((user_id, wall))
        return Punch(id=len(self.punches), at=wall, repeat=False)


def make(**overrides):
    hooks = FakeHooks()
    return hooks, KioskSession(hooks=hooks, settings=Settings(**overrides))


def run_to_challenge(session):
    assert session.step(face(AN), 0.0, T0)["state"] == "looking"
    view = session.step(face(AN), 0.2, T0)
    assert view["state"] == "challenge" and view["name"] == "Nguyễn An"
    return view


def test_check_in_after_turning_the_asked_way():
    hooks, session = make()
    view = run_to_challenge(session)
    yaw = 25 if view["direction"] == "left" else -25
    assert session.step(face(AN, yaw / 3), 0.5, T0)["state"] == "challenge"
    done = session.step(face(AN, yaw), 0.8, T0 + timedelta(seconds=1))
    assert done["state"] == "done" and done["repeat"] is False and done["name"] == "Nguyễn An"
    assert hooks.punches == [("an", T0 + timedelta(seconds=1))]
    # Held on screen, whatever the camera sees.
    assert session.step(None, 2.0, T0)["state"] == "done"
    assert session.step(None, 5.0, T0) == {"state": "idle"}


def test_turning_the_wrong_way_fails_without_a_punch():
    hooks, session = make()
    view = run_to_challenge(session)
    yaw = -25 if view["direction"] == "left" else 25
    assert session.step(face(AN, yaw), 0.6, T0) == {"state": "failed", "reason": "wrong_way"}
    assert hooks.punches == []


def test_a_photo_cannot_turn_and_times_out():
    hooks, session = make()
    run_to_challenge(session)
    views = [session.step(face(AN, 0), 0.2 + step * 0.2, T0) for step in range(1, 40)]
    # Six seconds of a face that never turns, then the challenge gives up.
    assert all(view["state"] == "challenge" for view in views[:29])
    assert views[30] == {"state": "failed", "reason": "timeout"}
    assert hooks.punches == []


def test_someone_else_stepping_in_fails_the_challenge():
    hooks, session = make()
    run_to_challenge(session)
    assert session.step(face(BINH), 0.4, T0) == {"state": "failed", "reason": "changed"}
    assert hooks.punches == []


def test_unknown_face_is_named_unknown_after_a_moment():
    _, session = make()
    assert session.step(face(STRANGER), 0.0, T0)["state"] == "looking"
    assert session.step(face(STRANGER), 1.0, T0)["state"] == "looking"
    assert session.step(face(STRANGER), 1.6, T0)["state"] == "unknown"


def test_too_small_a_face_asks_to_come_closer():
    _, session = make()
    assert session.step(face(AN, width=60), 0.0, T0) == {"state": "closer"}


def test_one_frame_is_not_enough_to_name_someone():
    _, session = make()
    assert session.step(face(AN), 0.0, T0)["state"] == "looking"
    assert session.step(face(BINH), 0.2, T0)["state"] == "looking"


def test_cool_down_shows_the_earlier_punch_without_a_new_one():
    hooks, session = make(liveness=False)
    session.step(face(AN), 0.0, T0)
    first = session.step(face(AN), 0.2, T0)
    assert first["state"] == "done" and first["repeat"] is False
    session.step(face(AN), 10.0, T0 + timedelta(seconds=10))
    again = session.step(face(AN), 10.2, T0 + timedelta(seconds=10))
    assert again["state"] == "done" and again["repeat"] is True and again["at"] == T0.isoformat()
    assert len(hooks.punches) == 1


def test_gallery_refuses_a_close_call():
    gallery = Gallery(["an", "binh"], np.stack([AN, normalise(np.array([0.98, 0.2, 0.0, 0.0]))]))
    assert gallery.identify(AN, 0.45, 0.08) is None
    assert gallery.identify(AN, 0.45, 0.0) == Match("an", 1.0)
