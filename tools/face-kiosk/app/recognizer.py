"""Faces in a picture: InsightFace's detector (SCRFD) and ArcFace embeddings, on the CPU.

The model pack (buffalo_l by default) is baked into the image at build time, so the kiosk starts
without the internet. Only detection and recognition are loaded: no age, gender or landmarks 3D.
"""

from __future__ import annotations

import threading

import cv2
import numpy as np

from .session import Face


class Recognizer:
    def __init__(self, model_pack: str, model_root: str, det_size: int):
        from insightface.app import FaceAnalysis  # heavy import: only in the running service

        self._app = FaceAnalysis(name=model_pack, root=model_root, allowed_modules=["detection", "recognition"], providers=["CPUExecutionProvider"])
        self._app.prepare(ctx_id=-1, det_size=(det_size, det_size))
        self._lock = threading.Lock()

    def faces(self, image: np.ndarray) -> list[Face]:
        with self._lock:
            found = self._app.get(image)
        return [
            Face(bbox=tuple(float(v) for v in face.bbox), kps=face.kps.astype(float).tolist(), embedding=np.asarray(face.normed_embedding, dtype=np.float32), det_score=float(face.det_score))  # type: ignore[arg-type]
            for face in found
        ]

    def largest(self, image: np.ndarray) -> Face | None:
        faces = self.faces(image)
        return max(faces, key=lambda face: face.width) if faces else None


def decode(data: bytes) -> np.ndarray | None:
    """A JPEG or PNG from the browser, as the BGR array the models expect."""
    if not data:
        return None
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        return None
    # Phone photos can be huge; the detector works at a few hundred pixels anyway.
    height, width = image.shape[:2]
    longest = max(height, width)
    if longest > 1280:
        scale = 1280 / longest
        image = cv2.resize(image, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_AREA)
    return image
