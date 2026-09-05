```python
"""Configuration for the DepthWizard integration backend.

Every value can be overridden with an environment variable of the same name.
"""

from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent

RUNTIME_DIR = Path(
    os.getenv("RUNTIME_DIR", str(BASE_DIR / "runtime"))
).resolve()

PERSON1_SCRIPT = Path(
    os.getenv(
        "PERSON1_SCRIPT",
        str(PROJECT_DIR / "depthwizard_person1" / "main.py"),
    )
).resolve()

PERSON2_SCRIPT = Path(
    os.getenv(
        "PERSON2_SCRIPT",
        str(PROJECT_DIR / "depthwizard_person2" / "main.py"),
    )
).resolve()

PERSON3_SCRIPT = Path(
    os.getenv(
        "PERSON3_SCRIPT",
        str(PROJECT_DIR / "depthwizard_person3" / "main.py"),
    )
).resolve()

PERSON6_HEIGHTMAP_SCRIPT = Path(
    os.getenv(
        "PERSON6_HEIGHTMAP_SCRIPT",
        str(
            PROJECT_DIR
            / "depthwizard_person6"
            / "tools"
            / "prepare_heightmap.py"
        ),
    )
).resolve()

MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "500"))

MOCK_PIPELINE = (
    os.getenv("MOCK_PIPELINE", "false").strip().lower()
    in {"1", "true", "yes", "on"}
)

PIPELINE_TIMEOUT_SECONDS = int(
    os.getenv("PIPELINE_TIMEOUT_SECONDS", "1800")
)

MODEL_MAX_SIZE = int(os.getenv("MODEL_MAX_SIZE", "3072"))

VIEWER_GRID_SIZE = int(os.getenv("VIEWER_GRID_SIZE", "512"))

DEPTH_MODEL = os.getenv(
    "DEPTH_MODEL",
    "depth_anything_v2_base",
).strip()


# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
# These required origins are ALWAYS allowed.
#
# Additional origins can be supplied through the CORS_ORIGINS environment
# variable without replacing the required defaults.
#
# This is important because an environment variable should not accidentally
# remove the deployed Vercel frontend from the allowed origins.

_default_cors_origins = {
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "https://depthwizard-frontend.vercel.app",
}

_extra_cors_origins = {
    item.strip()
    for item in os.getenv("CORS_ORIGINS", "").split(",")
    if item.strip()
}

CORS_ORIGINS = sorted(
    _default_cors_origins | _extra_cors_origins
)


# ---------------------------------------------------------------------------
# Adapter filenames/arguments
# ---------------------------------------------------------------------------
# Change these when Persons 1-3 finalize their CLIs.

PERSON1_RGB_FILENAME = os.getenv(
    "PERSON1_RGB_FILENAME",
    "rgb_model.png",
)

PERSON1_MASK_FILENAME = os.getenv(
    "PERSON1_MASK_FILENAME",
    "valid_mask.npy",
)

PERSON2_DEPTH_FILENAME = os.getenv(
    "PERSON2_DEPTH_FILENAME",
    "relative_depth.npy",
)


# ---------------------------------------------------------------------------
# Person 3 calibration configuration
# ---------------------------------------------------------------------------
# Person 3 needs at least one calibration source in the current team CLI.
# Leave these empty if a later Person 3 adapter obtains calibration another
# way.

PERSON3_SRTM = os.getenv("PERSON3_SRTM", "").strip()

PERSON3_GCPS = os.getenv("PERSON3_GCPS", "").strip()

PERSON3_REFERENCE = os.getenv("PERSON3_REFERENCE", "").strip()
```
