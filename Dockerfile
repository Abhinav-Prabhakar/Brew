# syntax=docker/dockerfile:1.7
# brew: the live café (FastAPI + WebSocket + the hand-drawn frontend at /) in one container. uv does all the Python.
#
#   docker build -t brew .
#   docker run --rm -p 8000:8000 -v brew-data:/var/lib/brew brew        # → http://localhost:8000/
#
# Torch: pyproject.toml routes Linux torch to the CUDA 12.6 index (the training desktop). The server never imports
# torch (policy D runs on ONNX), so the image takes the CPU wheel of the same locked version instead of several GB of
# CUDA libraries, the same way CI does. brew-train / brew-eval still work inside the container, on CPU.

ARG PYTHON=3.12
ARG UV=0.12.23

FROM ghcr.io/astral-sh/uv:${UV} AS uv

# ------------------------------------------------------------------ build: the locked environment
FROM python:${PYTHON}-slim-bookworm AS build
COPY --from=uv /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app

# dependencies first (cached until uv.lock changes): everything locked except torch/triton/nvidia-*
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    skip="--no-install-package torch --no-install-package triton"; \
    for p in $(sed -n 's/^name = "\(nvidia-[a-z0-9-]*\)"/\1/p' uv.lock); do skip="$skip --no-install-package $p"; done; \
    uv sync --frozen --no-dev --no-install-project $skip

# then the project itself, and the CPU torch wheel of the locked version (after the last sync, so nothing prunes it)
# (only the PyTorch CPU index: uv gives --extra-index-url priority, and PyPI's Linux torch pulls the CUDA stack)
COPY . .
RUN --mount=type=cache,target=/root/.cache/uv \
    skip="--no-install-package torch --no-install-package triton"; \
    for p in $(sed -n 's/^name = "\(nvidia-[a-z0-9-]*\)"/\1/p' uv.lock); do skip="$skip --no-install-package $p"; done; \
    uv sync --frozen --no-dev $skip && \
    torch=$(grep -A1 '^name = "torch"' uv.lock | sed -n 's/^version = "\([0-9.]*\).*/\1/p' | head -1) && \
    uv pip install --python /app/.venv/bin/python --index-url https://download.pytorch.org/whl/cpu "torch==${torch}" && \
    /app/.venv/bin/python -c "import torch, brew; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())"

# ------------------------------------------------------------------ runtime
FROM python:${PYTHON}-slim-bookworm
ARG PYTHON
ARG GIT_SHA=unknown
# libgomp1: LightGBM's OpenMP runtime
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 1000 brew && mkdir -p /var/lib/brew && chown brew /var/lib/brew
COPY --from=uv /uv /uvx /bin/
COPY --from=build --chown=brew /app /app
WORKDIR /app
USER brew
ENV PATH=/app/.venv/bin:$PATH UV_PROJECT_ENVIRONMENT=/app/.venv UV_PYTHON_DOWNLOADS=never UV_NO_SYNC=1 \
    PYTHONUNBUFFERED=1 \
    BREW_DATABASE_URL=sqlite:////var/lib/brew/brew.db BREW_RUNS_DIR=/var/lib/brew/runs BREW_GIT_SHA=${GIT_SHA}
VOLUME /var/lib/brew
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=4 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=4).status == 200 else 1)"]
# uv runs the app from the locked environment; --no-sync: nothing is resolved or downloaded at start
CMD ["uv", "run", "--frozen", "--no-sync", "brew-api", "--host", "0.0.0.0", "--port", "8000"]
