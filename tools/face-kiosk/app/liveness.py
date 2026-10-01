"""Is the face in front of the kiosk a real head? A turn-your-head challenge. Pure: no I/O.

The detector gives five points per face: the two eyes, the nose and the two mouth corners, in that
order, left to right as the camera sees them. We express the nose in the face's own frame: how far
it sits from the camera-left eye towards the camera-right eye (`a`), with the line from between the
eyes to the mouth as the second axis. That number is affine invariant: a printed photo or a phone
screen, however it is tilted, turned or moved, keeps the same `a`, because all five points lie on
one flat surface. Only a real head turning moves the nose across the face. The kiosk asks for a turn in a random direction, so a
recorded video of someone turning cannot answer it on cue either.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Literal, Sequence

import numpy as np

Direction = Literal["left", "right"]
Verdict = Literal["pass", "wrong_way", "wait"]

# The person's own left: they face the camera, so their left is the camera's right, and turning
# that way carries the nose towards the camera-right eye, i.e. `a` grows.
_SIGN: dict[Direction, int] = {"left": 1, "right": -1}


def nose_position(kps: Sequence[Sequence[float]]) -> float | None:
    """The nose between the eyes in the face's own frame: 0 at the camera-left eye, 1 at the other.

    About 0.5 for a face looking straight at the camera. None when the points are degenerate.
    """
    points = np.asarray(kps, dtype=float)
    if points.shape != (5, 2):
        return None
    left_eye, right_eye, nose, mouth_left, mouth_right = points
    eyes = (left_eye + right_eye) / 2
    mouth = (mouth_left + mouth_right) / 2
    # Axes: across the eyes, and down from between the eyes to the mouth. Midpoints are affine
    # combinations too, so the coordinates stay invariant.
    basis = np.column_stack([right_eye - left_eye, mouth - eyes])
    if abs(np.linalg.det(basis)) < 1e-6:
        return None
    a, _ = np.linalg.solve(basis, nose - eyes)
    return float(a) + 0.5


@dataclass
class Challenge:
    direction: Direction
    baseline: float
    min_turn: float = 0.12

    def check(self, position: float) -> Verdict:
        moved = _SIGN[self.direction] * (position - self.baseline)
        if moved >= self.min_turn:
            return "pass"
        if moved <= -self.min_turn:
            return "wrong_way"
        return "wait"


def new_challenge(baseline: float, min_turn: float, rng: random.Random | None = None) -> Challenge:
    direction: Direction = (rng or random).choice(["left", "right"])
    return Challenge(direction=direction, baseline=baseline, min_turn=min_turn)
