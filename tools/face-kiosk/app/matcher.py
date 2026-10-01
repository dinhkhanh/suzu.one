"""Who is this face? One-to-many matching of an embedding against the enrolled ones. Pure: no I/O.

Embeddings are L2-normalised, so a dot product is the cosine similarity. A face is named only when
its best person clears the threshold *and* leads the runner-up person by a margin: two colleagues
who look alike are answered with "not sure", never with the wrong name.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np


@dataclass(frozen=True)
class Match:
    user_id: str
    score: float


def normalise(vector: np.ndarray) -> np.ndarray:
    vector = np.asarray(vector, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(vector))
    return vector / norm if norm > 0 else vector


class Gallery:
    """The enrolled faces, one row per photo; several rows may belong to one person."""

    def __init__(self, owners: Sequence[str], matrix: np.ndarray):
        self.owners = list(owners)
        self.matrix = np.asarray(matrix, dtype=np.float32).reshape(len(self.owners), -1) if self.owners else np.zeros((0, 0), dtype=np.float32)

    def __len__(self) -> int:
        return len(self.owners)

    def scores_by_person(self, embedding: np.ndarray) -> dict[str, float]:
        if not self.owners:
            return {}
        scores = self.matrix @ normalise(embedding)
        best: dict[str, float] = {}
        for owner, score in zip(self.owners, scores.tolist()):
            if score > best.get(owner, -1.0):
                best[owner] = score
        return best

    def identify(self, embedding: np.ndarray, threshold: float, margin: float) -> Match | None:
        ranked = sorted(self.scores_by_person(embedding).items(), key=lambda item: item[1], reverse=True)
        if not ranked:
            return None
        user_id, top = ranked[0]
        runner_up = ranked[1][1] if len(ranked) > 1 else -1.0
        if top < threshold or top - runner_up < margin:
            return None
        return Match(user_id=user_id, score=top)

    def score_for(self, user_id: str, embedding: np.ndarray) -> float:
        return self.scores_by_person(embedding).get(user_id, -1.0)
