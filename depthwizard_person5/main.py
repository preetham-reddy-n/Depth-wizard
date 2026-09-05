"""FastAPI application entry point."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router
from config import CORS_ORIGINS, MAX_UPLOAD_SIZE_MB, RUNTIME_DIR

logging.basicConfig(level=logging.INFO, format="%(message)s")
RUNTIME_DIR.joinpath("jobs").mkdir(parents=True, exist_ok=True)
logging.getLogger("depthwizard").info("[DepthWizard] Maximum image upload: %s MB", MAX_UPLOAD_SIZE_MB)

app = FastAPI(title="DepthWizard Backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "DepthWizard Backend"}


# Serve the compiled React app from the API server for the judge launcher.
# Registered after API routes so unknown API paths never become HTML responses.
FRONTEND_DIST = Path(__file__).resolve().parents[1] / 'depthwizard_person4' / 'dist'


@app.get('/{frontend_path:path}', include_in_schema=False)
def frontend(frontend_path: str):
    if frontend_path.split('/')[0] in {'api', 'health', 'docs', 'openapi.json'}:
        raise HTTPException(404, 'Not found.')
    root = FRONTEND_DIST.resolve()
    candidate = (root / frontend_path).resolve()
    if not candidate.is_relative_to(root):
        raise HTTPException(404, 'Not found.')
    if candidate.is_file():
        return FileResponse(candidate)
    if frontend_path not in {'', 'analyze'} and not frontend_path.startswith('results/'):
        raise HTTPException(404, 'Not found.')
    index = root / 'index.html'
    if not index.is_file():
        raise HTTPException(503, 'Frontend is not built yet. Run START_DEPTHWIZARD.cmd.')
    return FileResponse(index, headers={'Cache-Control': 'no-cache'})
