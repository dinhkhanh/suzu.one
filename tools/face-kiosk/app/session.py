"""What the kiosk screen shows, frame by frame. Pure apart from the hooks it is given.

    idle ──face──▶ looking ──same person on 2 frames──▶ challenge ──turned the asked way──▶ done
                     │                                     │ timeout / wrong way / someone else
                     └──nobody we know, 1.5 s──▶ unknown   └──────────────▶ failed

Done and failed stay on screen for a few seconds, whatever the camera sees. A person who already
checked in during the cool-down sees their earlier time again and makes no new punch.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

import numpy as np

from .liveness import Challenge, new_challenge, nose_position
from .matcher import Match


@dataclass
class Face:
    bbox: tuple[float, float, float, float]
    kps: list[list[float]]
    embedding: np.ndarray
    det_score: float

    @property
    def width(self) -> float:
        return self.bbox[2] - self.bbox[0]


@dataclass
class Settings:
    threshold: float = 0.45
    margin: float = 0.08
    # While a challenge runs the face is only checked to still be the same person.
    keep_threshold: float = 0.35
    min_face_px: float = 110
    confirm_frames: int = 2
    liveness: bool = True
    min_turn: float = 0.12
    challenge_seconds: float = 6.0
    done_seconds: float = 4.0
    failed_seconds: float = 2.5
    unknown_after: float = 1.5


@dataclass(frozen=True)
class Punch:
    id: int
    at: datetime
    repeat: bool


class Hooks(Protocol):
    def identify(self, embedding: np.ndarray) -> Match | None: ...
    def score_for(self, user_id: str, embedding: np.ndarray) -> float: ...
    def name_of(self, user_id: str) -> str: ...
    def recent_punch(self, user_id: str, wall: datetime) -> Punch | None: ...
    def punch(self, user_id: str, wall: datetime) -> Punch: ...


@dataclass
class KioskSession:
    hooks: Hooks
    settings: Settings = field(default_factory=Settings)
    rng: random.Random = field(default_factory=random.Random)

    mode: str = "idle"
    until: float = 0.0
    held_view: dict[str, Any] = field(default_factory=dict)
    candidate: str | None = None
    candidate_frames: int = 0
    unknown_since: float | None = None
    user_id: str | None = None
    challenge: Challenge | None = None
    deadline: float = 0.0

    def _reset(self) -> None:
        self.mode = "idle"
        self.candidate = None
        self.candidate_frames = 0
        self.unknown_since = None
        self.user_id = None
        self.challenge = None

    def _hold(self, mode: str, seconds: float, now: float, view: dict[str, Any]) -> dict[str, Any]:
        self._reset()
        self.mode = mode
        self.until = now + seconds
        self.held_view = view
        return view

    def _done(self, user_id: str, punch: Punch, now: float) -> dict[str, Any]:
        view = {"state": "done", "userId": user_id, "name": self.hooks.name_of(user_id), "at": punch.at.isoformat(), "punchId": punch.id, "repeat": punch.repeat}
        return self._hold("done", self.settings.done_seconds, now, view)

    def _fail(self, reason: str, now: float) -> dict[str, Any]:
        return self._hold("failed", self.settings.failed_seconds, now, {"state": "failed", "reason": reason})

    def _challenge_view(self, now: float) -> dict[str, Any]:
        assert self.user_id is not None and self.challenge is not None
        return {"state": "challenge", "userId": self.user_id, "name": self.hooks.name_of(self.user_id), "direction": self.challenge.direction, "secondsLeft": max(0.0, round(self.deadline - now, 1))}

    def step(self, face: Face | None, now: float, wall: datetime) -> dict[str, Any]:
        """One camera frame. `now` is a monotonic clock in seconds, `wall` the time a punch carries."""
        if self.mode in ("done", "failed"):
            if now < self.until:
                return self.held_view
            self._reset()

        usable = face is not None and face.width >= self.settings.min_face_px

        if self.mode == "challenge":
            if now > self.deadline:
                return self._fail("timeout", now)
            if not usable:
                # Turning can take the face out of the detector's view for a frame or two.
                return self._challenge_view(now)
            assert face is not None and self.user_id is not None and self.challenge is not None
            if self.hooks.score_for(self.user_id, face.embedding) < self.settings.keep_threshold:
                return self._fail("changed", now)
            position = nose_position(face.kps)
            if position is None:
                return self._challenge_view(now)
            verdict = self.challenge.check(position)
            if verdict == "pass":
                return self._done(self.user_id, self.hooks.punch(self.user_id, wall), now)
            if verdict == "wrong_way":
                return self._fail("wrong_way", now)
            return self._challenge_view(now)

        if face is None:
            self._reset()
            return {"state": "idle"}
        if not usable:
            self.candidate, self.candidate_frames, self.unknown_since = None, 0, None
            return {"state": "closer"}

        match = self.hooks.identify(face.embedding)
        if match is None:
            self.candidate, self.candidate_frames = None, 0
            self.unknown_since = self.unknown_since if self.unknown_since is not None else now
            return {"state": "unknown" if now - self.unknown_since >= self.settings.unknown_after else "looking"}
        self.unknown_since = None
        if match.user_id == self.candidate:
            self.candidate_frames += 1
        else:
            self.candidate, self.candidate_frames = match.user_id, 1
        if self.candidate_frames < self.settings.confirm_frames:
            return {"state": "looking"}

        earlier = self.hooks.recent_punch(match.user_id, wall)
        if earlier is not None:
            return self._done(match.user_id, earlier, now)
        if not self.settings.liveness:
            return self._done(match.user_id, self.hooks.punch(match.user_id, wall), now)
        position = nose_position(face.kps)
        if position is None:
            return {"state": "looking"}
        self.mode = "challenge"
        self.user_id = match.user_id
        self.challenge = new_challenge(position, self.settings.min_turn, self.rng)
        self.deadline = now + self.settings.challenge_seconds
        return self._challenge_view(now)
