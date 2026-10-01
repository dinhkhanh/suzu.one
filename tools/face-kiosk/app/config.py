"""Settings, all from the environment (docker-compose.yml lists every one)."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _float(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


def _int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


def _bool(name: str, default: bool) -> bool:
    return os.environ.get(name, "1" if default else "0").strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Config:
    suzu_url: str
    device_token: str
    kiosk_key: str
    admin_password: str
    data_dir: str
    model_pack: str
    model_root: str
    det_size: int
    threshold: float
    margin: float
    keep_threshold: float
    min_face_px: int
    liveness: bool
    min_turn: float
    cooldown_seconds: int
    undo_seconds: int
    purge_inactive_days: int
    kiosk_lang: str

    @property
    def suzu_configured(self) -> bool:
        return bool(self.suzu_url and self.device_token)


def load() -> Config:
    config = Config(
        suzu_url=os.environ.get("SUZU_URL", "").rstrip("/"),
        device_token=os.environ.get("SUZU_DEVICE_TOKEN", "").strip(),
        kiosk_key=os.environ.get("KIOSK_KEY", "").strip(),
        admin_password=os.environ.get("ADMIN_PASSWORD", "").strip(),
        data_dir=os.environ.get("DATA_DIR", "/data"),
        model_pack=os.environ.get("MODEL_PACK", "buffalo_l"),
        model_root=os.environ.get("MODEL_ROOT", "/models"),
        det_size=_int("DET_SIZE", 320),
        threshold=_float("MATCH_THRESHOLD", 0.45),
        margin=_float("MATCH_MARGIN", 0.08),
        keep_threshold=_float("KEEP_THRESHOLD", 0.35),
        min_face_px=_int("MIN_FACE_PX", 110),
        liveness=_bool("LIVENESS", True),
        min_turn=_float("LIVENESS_MIN_TURN", 0.12),
        cooldown_seconds=_int("COOLDOWN_SECONDS", 60),
        undo_seconds=_int("UNDO_SECONDS", 8),
        purge_inactive_days=_int("PURGE_INACTIVE_DAYS", 30),
        kiosk_lang=os.environ.get("KIOSK_LANG", "vi"),
    )
    missing = [name for name, value in (("KIOSK_KEY", config.kiosk_key), ("ADMIN_PASSWORD", config.admin_password)) if len(value) < 12]
    if missing:
        raise SystemExit(f"Set {', '.join(missing)} to at least 12 characters (docker-compose.yml).")
    return config
