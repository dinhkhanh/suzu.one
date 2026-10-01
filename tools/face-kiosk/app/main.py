"""SuZu face kiosk: the HTTP service on the NAS.

  /kiosk   the tablet at the door: camera, greeting, "Not me" (needs KIOSK_KEY once)
  /admin   enrolment, roster, the punch log, the connection to SuZu One (ADMIN_PASSWORD)
  /healthz for Container Manager

Pictures arrive, are turned into numbers and are dropped: nothing the camera sees is written to
disk except a person's embeddings at enrolment.
"""

from __future__ import annotations

import hmac
import logging
import secrets
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from . import config as config_module
from .matcher import Match
from .recognizer import Recognizer, decode
from .sender import Sender
from .session import KioskSession, Punch, Settings
from .store import Store, utcnow

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("face-kiosk")

config = config_module.load()
store = Store(Path(config.data_dir) / "kiosk.db")
recognizer = Recognizer(config.model_pack, config.model_root, config.det_size)
sender = Sender(config, store)
settings = Settings(threshold=config.threshold, margin=config.margin, keep_threshold=config.keep_threshold, min_face_px=config.min_face_px, liveness=config.liveness, min_turn=config.min_turn)
STATIC = Path(__file__).parent / "static"


class Hooks:
    """What a kiosk session needs from the rest of the service."""

    def identify(self, embedding: Any) -> Match | None:
        return store.gallery().identify(embedding, settings.threshold, settings.margin)

    def score_for(self, user_id: str, embedding: Any) -> float:
        return store.gallery().score_for(user_id, embedding)

    def name_of(self, user_id: str) -> str:
        person = store.person(user_id)
        return str(person["full_name"]) if person else user_id

    def recent_punch(self, user_id: str, wall: datetime) -> Punch | None:
        row = store.recent_punch(user_id, wall - timedelta(seconds=config.cooldown_seconds))
        return Punch(id=int(row["id"]), at=datetime.fromisoformat(row["at"]), repeat=True) if row else None

    def punch(self, user_id: str, wall: datetime) -> Punch:
        punch_id = store.add_punch(user_id, wall, config.undo_seconds)
        log.info("punch %s for %s", punch_id, user_id)
        return Punch(id=punch_id, at=wall, repeat=False)


sessions: dict[str, KioskSession] = {}

app = FastAPI(title="SuZu face kiosk", docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.on_event("startup")
def _start() -> None:
    sender.start()


@app.on_event("shutdown")
def _stop() -> None:
    sender.stop()


@app.middleware("http")
async def _no_store(request: Request, call_next):  # type: ignore[no-untyped-def]
    response = await call_next(request)
    response.headers["cache-control"] = "no-store"
    response.headers["x-frame-options"] = "DENY"
    response.headers["referrer-policy"] = "no-referrer"
    return response


# ── Who may ask ─────────────────────────────────────────────────────────────────────────────

basic = HTTPBasic(realm="SuZu face kiosk")


def admin(credentials: Annotated[HTTPBasicCredentials, Depends(basic)]) -> None:
    if not hmac.compare_digest(credentials.password.encode(), config.admin_password.encode()):
        raise HTTPException(status_code=401, headers={"WWW-Authenticate": 'Basic realm="SuZu face kiosk"'})


def kiosk(x_kiosk_key: Annotated[str, Header()] = "") -> None:
    if not hmac.compare_digest(x_kiosk_key.encode(), config.kiosk_key.encode()):
        raise HTTPException(status_code=401)


# ── Pages ───────────────────────────────────────────────────────────────────────────────────


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    return RedirectResponse("/kiosk")


@app.get("/kiosk", include_in_schema=False)
def kiosk_page() -> FileResponse:
    return FileResponse(STATIC / "kiosk.html")


@app.get("/admin", include_in_schema=False, dependencies=[Depends(admin)])
def admin_page() -> FileResponse:
    return FileResponse(STATIC / "admin.html")


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    return {"ok": True, "enrolled": len(store.gallery())}


# ── The kiosk ───────────────────────────────────────────────────────────────────────────────


@app.get("/api/kiosk/info", dependencies=[Depends(kiosk)])
def kiosk_info() -> dict[str, Any]:
    return {"lang": config.kiosk_lang, "liveness": settings.liveness, "undoSeconds": config.undo_seconds, "enrolled": len(store.gallery())}


@app.post("/api/kiosk/frame", dependencies=[Depends(kiosk)])
async def kiosk_frame(request: Request, x_kiosk_id: Annotated[str, Header()] = "door") -> dict[str, Any]:
    image = decode(await request.body())
    if image is None:
        raise HTTPException(status_code=400, detail="not an image")
    session = sessions.setdefault(x_kiosk_id[:40], KioskSession(hooks=Hooks(), settings=settings))
    # The models run off the event loop, so the admin page stays responsive while the camera streams.
    face = await run_in_threadpool(recognizer.largest, image)
    view = session.step(face, time.monotonic(), utcnow())
    if view.get("state") == "done" and not view.get("repeat"):
        sender.nudge()
    return view


class Undo(BaseModel):
    punchId: int


@app.post("/api/kiosk/undo", dependencies=[Depends(kiosk)])
def kiosk_undo(body: Undo) -> dict[str, bool]:
    return {"cancelled": store.cancel_punch(body.punchId)}


# ── Administration ──────────────────────────────────────────────────────────────────────────


@app.get("/api/admin/status", dependencies=[Depends(admin)])
def admin_status() -> dict[str, Any]:
    return {
        "suzuConfigured": config.suzu_configured,
        "suzuUrl": config.suzu_url,
        "pending": store.pending_count(),
        "status": store.status(),
        "modelPack": config.model_pack,
        "liveness": settings.liveness,
        "threshold": settings.threshold,
        "enrolled": len(store.gallery()),
    }


@app.get("/api/admin/people", dependencies=[Depends(admin)])
def admin_people() -> list[dict[str, Any]]:
    return store.people()


class ManualPerson(BaseModel):
    userId: str = Field(min_length=1, max_length=40)
    fullName: str = Field(min_length=1, max_length=120)
    employeeCode: str | None = Field(default=None, max_length=40)


@app.post("/api/admin/people", dependencies=[Depends(admin)])
def admin_add_person(body: ManualPerson) -> dict[str, bool]:
    store.add_manual(body.userId.strip(), body.fullName.strip(), (body.employeeCode or "").strip() or None)
    return {"ok": True}


@app.delete("/api/admin/people/{user_id}", dependencies=[Depends(admin)])
def admin_remove_person(user_id: str) -> dict[str, bool]:
    store.remove_person(user_id)
    return {"ok": True}


@app.post("/api/admin/people/{user_id}/faces", dependencies=[Depends(admin)])
async def admin_enrol(user_id: str, photos: Annotated[list[UploadFile], File()], consent: Annotated[bool, Form()] = False) -> JSONResponse:
    person = store.person(user_id)
    if person is None:
        raise HTTPException(status_code=404, detail="unknown person")
    if not consent and not person["consent_at"]:
        return JSONResponse({"error": "consent_required"}, status_code=400)
    embeddings = []
    problems: list[dict[str, str]] = []
    for photo in photos[:20]:
        image = decode(await photo.read())
        faces = await run_in_threadpool(recognizer.faces, image) if image is not None else []
        name = photo.filename or "photo"
        if image is None:
            problems.append({"photo": name, "problem": "not_an_image"})
        elif len(faces) != 1:
            problems.append({"photo": name, "problem": "no_face" if not faces else "several_faces"})
        elif faces[0].det_score < 0.6 or faces[0].width < 80:
            problems.append({"photo": name, "problem": "face_unclear"})
        else:
            # Someone else's face under this name would let them punch for this person.
            other = store.gallery().identify(faces[0].embedding, settings.threshold, 0.0)
            if other is not None and other.user_id != user_id:
                problems.append({"photo": name, "problem": "looks_like_someone_else", "who": other.user_id})
            else:
                embeddings.append(faces[0].embedding)
    added = store.add_faces(user_id, embeddings, consent) if embeddings else 0
    return JSONResponse({"added": added, "problems": problems})


@app.delete("/api/admin/people/{user_id}/faces", dependencies=[Depends(admin)])
def admin_clear_faces(user_id: str) -> dict[str, int]:
    return {"deleted": store.clear_faces(user_id)}


@app.post("/api/admin/sync", dependencies=[Depends(admin)])
def admin_sync() -> JSONResponse:
    if not config.suzu_configured:
        return JSONResponse({"error": "not_configured"}, status_code=400)
    result = sender.sync_roster()
    if result is None:
        return JSONResponse({"error": "failed", "status": store.status()}, status_code=502)
    sender.nudge()
    return JSONResponse(result)


@app.get("/api/admin/events", dependencies=[Depends(admin)])
def admin_events() -> list[dict[str, Any]]:
    return store.events(150)


@app.post("/api/admin/events/{punch_id}/retry", dependencies=[Depends(admin)])
def admin_retry(punch_id: int) -> dict[str, bool]:
    done = store.retry(punch_id)
    sender.nudge()
    return {"ok": done}


@app.post("/api/admin/kiosk-link", dependencies=[Depends(admin)])
def admin_kiosk_link(request: Request) -> dict[str, str]:
    """The address to open once on the tablet; it remembers the key afterwards."""
    base = str(request.base_url).rstrip("/")
    return {"url": f"{base}/kiosk#key={config.kiosk_key}&id=door-{secrets.token_hex(2)}"}
