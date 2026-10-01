# SuZu face kiosk. Build on the NAS from docker-compose.yml, or anywhere with:
#   docker build -t suzu-face-kiosk .            (the service)
#   docker build --target test .                 (runs the tests)

# ── Wheels: insightface compiles a small C extension ─────────────────────────────────────────
FROM python:3.11-slim AS wheels
RUN apt-get update && apt-get install -y --no-install-recommends build-essential && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /tmp/
RUN pip install --no-cache-dir numpy==1.26.4 cython \
 && pip wheel --no-cache-dir --no-build-isolation --wheel-dir /wheels -r /tmp/requirements.txt

# ── The service ──────────────────────────────────────────────────────────────────────────────
FROM python:3.11-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TZ=Asia/Ho_Chi_Minh
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 tzdata curl && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /tmp/
COPY --from=wheels /wheels /wheels
RUN pip install --no-cache-dir --no-index --find-links /wheels -r /tmp/requirements.txt && rm -rf /wheels
# The face models go into the image, so the kiosk starts without the internet. Only detection and
# recognition are kept; the pack's age/gender and landmark models are never loaded.
ARG MODEL_PACK=buffalo_l
RUN python -c "from insightface.app import FaceAnalysis; FaceAnalysis(name='${MODEL_PACK}', root='/models', allowed_modules=['detection', 'recognition'], providers=['CPUExecutionProvider'])" \
 && rm -f /models/models/*.zip /models/models/*/genderage.onnx /models/models/*/2d106det.onnx /models/models/*/1k3d68.onnx
WORKDIR /srv
COPY app ./app

FROM base AS test
COPY requirements-dev.txt /tmp/
RUN pip install --no-cache-dir -r /tmp/requirements-dev.txt
COPY tests ./tests
RUN python -m pytest -q tests

FROM base AS service
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1
# --proxy-headers: behind DSM's reverse proxy, links are built with https and the real host.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers", "--forwarded-allow-ips", "*"]
