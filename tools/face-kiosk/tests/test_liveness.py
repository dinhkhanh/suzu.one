import math
import random

import numpy as np

from app.liveness import Challenge, new_challenge, nose_position

# A frontal face as the detector reports it: eyes, nose, mouth corners, camera-left to right.
FRONTAL = np.array([[100.0, 100.0], [160.0, 100.0], [130.0, 135.0], [108.0, 165.0], [152.0, 165.0]])


def head(yaw_degrees: float) -> np.ndarray:
    """A crude 3D head turned by `yaw` (positive: towards the person's left), projected orthographically."""
    # x across the face, y down, z towards the camera; the nose tip stands out of the face plane.
    points3d = np.array([[-30.0, 0, 0], [30.0, 0, 0], [0, 35.0, 28.0], [-22.0, 65.0, 5.0], [22.0, 65.0, 5.0]])
    yaw = math.radians(yaw_degrees)
    # Turning to their left carries the nose towards the camera's right (+x).
    rotation = np.array([[math.cos(yaw), 0, math.sin(yaw)], [0, 1, 0], [-math.sin(yaw), 0, math.cos(yaw)]])
    turned = points3d @ rotation.T
    return turned[:, :2] + np.array([130.0, 100.0])


def flat_photo(points: np.ndarray, matrix: np.ndarray, shift: np.ndarray) -> np.ndarray:
    """The same face printed on paper and held at an angle: an affine image of the points."""
    return points @ matrix.T + shift


def test_frontal_face_has_the_nose_in_the_middle():
    assert abs(nose_position(FRONTAL) - 0.5) < 1e-9
    assert abs(nose_position(head(0)) - 0.5) < 1e-9


def test_turning_left_moves_the_nose_towards_the_camera_right_eye():
    assert nose_position(head(25)) > nose_position(head(0)) + 0.15
    assert nose_position(head(-25)) < nose_position(head(0)) - 0.15


def test_a_tilted_or_turned_photo_keeps_its_position():
    rng = np.random.default_rng(7)
    base = nose_position(FRONTAL)
    for _ in range(200):
        angle = rng.uniform(-1.2, 1.2)
        squash = rng.uniform(0.4, 1.0)  # paper turned away from the camera
        shear = rng.uniform(-0.3, 0.3)
        matrix = np.array([[math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]]) @ np.array([[squash, shear], [0, 1]])
        assert abs(nose_position(flat_photo(FRONTAL, matrix, rng.uniform(-50, 50, 2))) - base) < 1e-6


def test_degenerate_points_give_no_answer():
    assert nose_position(np.zeros((5, 2))) is None
    assert nose_position([[1, 2]]) is None


def test_challenge_verdicts():
    challenge = Challenge(direction="left", baseline=0.5, min_turn=0.12)
    assert challenge.check(0.55) == "wait"
    assert challenge.check(0.63) == "pass"
    assert challenge.check(0.37) == "wrong_way"
    right = Challenge(direction="right", baseline=0.5, min_turn=0.12)
    assert right.check(0.37) == "pass"
    assert right.check(0.63) == "wrong_way"


def test_real_head_passes_the_challenge_it_is_asked():
    for direction, yaw in (("left", 25), ("right", -25)):
        challenge = Challenge(direction=direction, baseline=nose_position(head(0)), min_turn=0.12)
        assert challenge.check(nose_position(head(yaw))) == "pass"
        assert challenge.check(nose_position(head(-yaw))) == "wrong_way"


def test_new_challenge_picks_both_directions():
    rng = random.Random(1)
    assert {new_challenge(0.5, 0.12, rng).direction for _ in range(20)} == {"left", "right"}
