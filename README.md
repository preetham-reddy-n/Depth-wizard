# DepthWizard integrated application

This was the project selected for the September 2026 Hackathon.

## First run on another Windows laptop

Install Python **3.13** (including the Python launcher) and Node.js **22.12+**
(including npm). Clone/download this repository and open a terminal in its root:

```powershell
.\setup.cmd
.\diagnose.cmd --model
.\start_depthwizard.cmd
```

Do not transfer `.venv`, `node_modules`, model caches or runtime folders from
another computer. Setup creates that computer's dependencies and copies the
example configuration only if no `.env` exists. The tested ML version pair is
recorded in `constraints-tested.txt`. GPU acceleration is optional.

New installations use the Small depth model with a 1024-pixel processing limit.
The backend `.env.example` selects CPU for a reliable starting point. The first
model check needs internet access to download weights from Hugging Face; later
runs reuse the local cache. CPU inference can take minutes.

If the website says **Person 2 / depth estimation failed**, run
`.\diagnose.cmd --model` and inspect `.local-archive/diagnostics/person2-check.log`.
That distinguishes broken imports, a download failure, an invalid model setting,
and a device/inference error. The last error lines are needed to diagnose a
specific laptop; a stage label alone does not identify the cause.

For an existing installation, set these in `depthwizard_person5/.env` and restart
the backend before trying again:

```dotenv
DEPTH_DEVICE=cpu
DEPTH_MODEL=depth_anything_v2_small
MODEL_MAX_SIZE=1024
```

On a compatible NVIDIA setup, opt into `DEPTH_DEVICE=auto`,
`DEPTH_MODEL=depth_anything_v2_base` and `MODEL_MAX_SIZE=3072`. The optional
`enable_cuda.ps1` helper targets this project's specific CUDA 13 wheel pair;
it is not required and is not a universal driver installer.

DepthWizard converts a PNG, JPEG, or GeoTIFF into relative or calibrated elevation and displays it as interactive 3D terrain.

Large imagery is decoded to a bounded working grid (1024 pixels by default;
3072 for the optional GPU profile) and larger grids use overlapping model tiles.
Edge-connected black film/scanner borders are masked out of inference statistics
and 3D mesh geometry.

## Run

The simplest Windows start command is:

```powershell
.\start_depthwizard.cmd
```

This `.cmd` launcher works even when the machine's PowerShell execution policy
blocks `.ps1` files. It opens separate backend and frontend terminals, waits
until both HTTP services are genuinely ready, and then opens the site in the
high-performance GPU browser. The service terminals stay open if startup fails
so the underlying error remains visible.

To run the services separately without changing the execution policy, use
`.\start_backend.cmd`, `.\start_frontend.cmd`, and `.\open_gpu_viewer.cmd`.

Open two PowerShell terminals at this repository root:

```powershell
.\start_backend.ps1
```

```powershell
.\start_frontend.ps1
```

Then open `http://127.0.0.1:5173`. The normal uncalibrated path produces relative elevation. To produce elevations in metres, upload a genuinely georeferenced GeoTIFF together with GCP data, an SRTM/elevation raster, or both. SRTM `.hgt` uploads must keep their geographic tile name, such as `N28E077.hgt`.

On this workstation the backend environment has the official PyTorch CUDA 13.0
build and automatically selects the RTX 5060. If the environment is ever
recreated and startup reports CPU, run `./enable_cuda.ps1` once. The results
metadata shows `ML compute: CUDA`; the 3D viewport also displays the WebGL GPU
renderer in its lower-right corner.

On hybrid-GPU laptops, an embedded browser can ignore WebGL's
`powerPreference: high-performance` hint and remain on Intel graphics. With the
frontend already running, use `./open_gpu_viewer.ps1` to launch an isolated
Brave/Chrome session with Chromium's `--force_high_performance_gpu` preference.
The lower-right badge must say NVIDIA/RTX; if it says `INTEGRATED GPU · Intel`,
that browser process is still not using the discrete renderer.

The integrated flow is Person 4 (React) → Person 5 (FastAPI) → Persons 1–3 (image/depth/elevation pipeline) → Person 6 (Three.js viewer). The browser receives a bounded `heightmap.json`; NPY/GeoTIFF products retain the processing-grid resolution, which can be smaller than the original input. The original uploaded raster is retained unchanged. Increasing `MODEL_MAX_SIZE` increases processing resolution and memory use; upsampling does not recover missing detail.

Rendering uses the bounded processing-grid RGB texture, a 512-sample
terrain grid, GPU anisotropic texture filtering, soft self-shadowing, robust
relative-height clipping, and display-only surface smoothing. Numerical point
readings remain sampled from the unmodified elevation/depth field.

The 3D viewer opens in an orbiting Overview. Aim the centre reticle at the surface to read its elevation/relative height, slope, source row/column, calibration source, and map coordinate when a valid transform exists. Select Fly for keyboard navigation: `W`/`S` move along the camera heading, `A`/`D` strafe, `Q` or `Space` rises, and `E` or `Shift` descends. The toolbar includes movement-speed, mouse-look, and vertical-relief controls. PNG/JPEG and uncalibrated inputs are labelled `rel`; only a successfully calibrated GeoTIFF reports metres.

In Fly mode, click the canvas for pointer-lock mouse look and press Escape to
release it. If the browser blocks pointer lock, hold the left mouse button and
drag to look. Movement keys apply only while the canvas is focused. Overview
controls stop updating during Fly mode. Relief changes affect geometry only;
point elevations and downloaded arrays remain unchanged.

A `.tif` extension does not guarantee trustworthy georeferencing. DepthWizard validates the declared CRS against the raster's transformed centre and treats inconsistent metadata as non-georeferenced, with a visible warning. A generic monocular model estimates visual relative structure; it does not semantically guarantee that every road is ground or distinguish building height from canopy height. Operational DSM accuracy requires a remote-sensing height model and independent LiDAR/DEM/GCP validation.

## Absolute-elevation inputs

Open **Advanced calibration (optional)** before processing. Upload a correctly georeferenced optical GeoTIFF plus either:

- an overlapping SRTM/elevation GeoTIFF, or a correctly named SRTM HGT tile such as `N28E077.hgt`;
- a GCP CSV/JSON using original source pixels (`name,row,col,elevation_m`) or WGS84 coordinates (`name,longitude,latitude,elevation_m`);
- both, so SRTM supplies the broad terrain baseline while GCPs anchor the monocular scale and offset.

Example GCP files are in `depthwizard_person3/examples`. Without one of these references, the output intentionally remains relative and the UI states that absolute elevation is unavailable.

## Verify

```powershell
.\test_all.ps1
```

This runs all four Python suites, the 3D data/geometry tests, and the production frontend build.

## Install from a clean terminal

Prerequisites: Python 3.13 (tested) and Node.js 22.12+. From the repository root:

```powershell
py -3.13 -m venv depthwizard_person5/.venv
.\depthwizard_person5\.venv\Scripts\python.exe -m pip install -c constraints-tested.txt -r depthwizard_person5/requirements.txt -r depthwizard_person5/requirements-pipeline.txt pytest httpx
npm --prefix depthwizard_person4 install
npm --prefix depthwizard_person6 install
```

Start each service in a separate terminal at the repository root:

```powershell
.\depthwizard_person5\.venv\Scripts\python.exe -m uvicorn main:app --app-dir depthwizard_person5 --host 127.0.0.1 --port 8000
```

```powershell
npm --prefix depthwizard_person4 run dev
```

The first inference downloads the configured pretrained model unless cached. CPU is supported but slower. Frontend configuration lives in `depthwizard_person4/.env.local`: set `VITE_API_BASE_URL` to the backend origin and leave `VITE_USE_MOCK_API=false`. Backend settings are environment variables: `CORS_ORIGINS` (comma-separated allowed frontend origins), `RUNTIME_DIR`, `DEPTH_MODEL`, `MODEL_MAX_SIZE`, `VIEWER_GRID_SIZE`, `PERSON3_SRTM`, and `PERSON3_GCPS`. Defaults use project-relative storage and local development origins.

## Module and API handoffs

- Person 1: `depthwizard_person1/src/pipeline.py` prepares RGB, masks and metadata. Its reusable `prepare_image` interface adapts Kakshi's `pipeline.py` idea without duplicating loaders or stretching images to a square.
- Person 2: `depthwizard_person2/main.py` performs pretrained monocular inference and exports relative depth.
- Person 3: `depthwizard_person3/main.py` aligns uploaded/local reference rasters, fits depth to SRTM/GCP elevations and exports an estimated DSM. Calibration failures preserve relative results with a visible warning; failed partial absolute outputs are excluded from downloads.
- Person 4: `depthwizard_person4` contains React upload, stage progress and results pages.
- Person 5: `depthwizard_person5` stores each upload under `runtime/jobs/<job_id>/input`, invokes the module CLIs with the same Python interpreter, and serves results.
- Person 6: `depthwizard_person6` converts numeric height fields to a bounded viewer grid and renders RGB-textured terrain. Geometry filling does not change the validity mask or scientific output.

`POST /api/process` accepts multipart `image`, optional `srtm` and `gcp`, and returns a queued job ID. Poll `GET /api/status/{job_id}` until completed or failed, then fetch `GET /api/results/{job_id}`. Result URLs under `/api/files/{job_id}/{filename}` provide previews, arrays, heightmap and merged metadata. Browser progress is stage-based; legacy numeric progress fields are not timing estimates. Missing model weights or inference failures are errors; only optional calibration has a relative fallback.

## Real-model verification

```powershell
.\depthwizard_person5\.venv\Scripts\python.exe depthwizard_person3/examples/create_synthetic_demo.py
.\depthwizard_person5\.venv\Scripts\python.exe depthwizard_person5/tests/smoke_real_pipeline.py
```

This explicitly runs real inference through the API for PNG, JPEG, and GeoTIFF with SRTM/GCP references. It keeps artifacts in `depthwizard_person5/runtime_verification`, uses a 512-pixel processing limit, and is separate from fast unit tests. The synthetic calibration fixture tests integration, not real-world accuracy.

See `docs/integration-report.md` for the inspected Kakshi features, changed files, verification evidence and remaining limitations.

The latest follow-up is `docs/integration-followup-2026-09-06.md`. It records
current tests and browser verification separately from the earlier integration
report. Kakshi's original source folder was not available in this follow-up;
the existing attributed adapter is preserved without claiming new source review.

## GitHub and source sharing

The repository includes source, small synthetic fixtures, tests, lockfiles,
example configuration and the final team guide. Generated document-build
intermediates were moved to `.local-archive/depthwizard-guide-build` locally.
Local environments, secrets/config overrides, models, logs and processed uploads
are ignored. GitHub Actions runs fast module tests and the frontend build; it
does not download or run the neural model.

Create a clean source ZIP from current files (including uncommitted changes):

```powershell
.\depthwizard_person5\.venv\Scripts\python.exe scripts/prepare_release.py
```

The ZIP is `.local-archive/release/DepthWizard-source.zip`. Unzip before running
setup. It contains no copied Python environment, model weights or user uploads.
Review `git status` before committing; no GitHub repository is created or pushed
by these scripts.
