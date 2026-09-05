# DepthWizard integration follow-up — 6 September 2026

The working tree already contained staged integration work and the 5 September
report. This pass preserved those edits, inspected the actual Person 1–6 code,
fixed additional defects and repeated real-model and browser verification.
No working module was replaced and no files were removed.

## Architecture and final flow

Person 4 React/Vite upload → Person 5 FastAPI multipart POST /api/process →
runtime/jobs/<job_id>/input/scene.* → Person 1 reusable preparation and metadata →
Person 2 pretrained monocular depth → Person 3 optional SRTM/GCP alignment,
calibration and fused DSM → bounded numeric heightmap → Person 6 Three.js terrain
with the aligned RGB texture, embedded in the React results page.

The browser polls /api/status/{job_id} and retrieves /api/results/{job_id};
/api/files/{job_id}/{filename} serves the products. There is no new API or second
application. Relative output remains available when calibration cannot run.
Only affirmative successful calibration is labelled in metres. SRTM is supplied
by upload or local configuration, not automatically downloaded.

## Files created

- docs/integration-followup-2026-09-06.md — this current review and verification record.

## Files modified in this pass

| File | Change and reason |
| --- | --- |
| depthwizard_person3/main.py | Export mean elevation from the actual calibrated DSM. |
| depthwizard_person5/pipeline_runner.py | Relative min/max/mean use processing-array statistics rather than reduced viewer statistics. |
| depthwizard_person5/tests/test_backend.py | Verify relative fallback retains processing statistics and merged metadata. |
| depthwizard_person4/src/pages/AnalyzePage.jsx | Invalidate pending polling callbacks on unmount/reset so they cannot navigate away from another page; remove revoked preview URLs from navigation state. |
| depthwizard_person4/src/pages/ResultsPage.jsx | Expose intermediate relative depth alongside calibrated DSM results. |
| depthwizard_person4/src/components/ImagePreview.jsx | Explain TIFF preprocessing instead of rendering an unsupported browser TIFF image. |
| depthwizard_person4/src/components/MetadataPanel.jsx | Show mean, pixel resolution, NoData, affine transform and bounds; missing measurements stay missing. |
| depthwizard_person6/src/dataLoader.js | Treat null numbers as missing; fail visibly on unreadable supplied metadata; exclude masked finite outliers from geometry filling; label procedural demos relative. |
| depthwizard_person6/src/terrain.js | Preserve metric extent during further mesh reduction; refresh picking/culling bounds after exaggeration. |
| depthwizard_person6/src/firstPerson.js | Add drag-to-look when pointer lock is unavailable and clean up drag listeners/state. |
| depthwizard_person6/src/main.js | Stop OrbitControls updates in Fly/Auto modes, which otherwise override camera look; explain mouse controls. |
| depthwizard_person6/tests/terrain.test.js | Add extent, bounds, null metadata, malformed metadata and masked outlier regressions. |
| depthwizard_person6/tests/firstPerson.test.js | Exercise focused camera translation, blur, drag look, pointer-lock look, pitch clamping and no roll. |
| test_all.ps1 | Invoke installed Node/Vite directly, eliminating a global pnpm prerequisite. |
| README.md | Document mouse fallback and synthetic fixture generation; link this review. |

Files removed: none. Dependencies added or changed: none.

## Kakshi features

The original DepthWizard-Kakshi folder could not be located in this repository
or the supplied attachment. Its path was requested. Therefore this pass does
not claim to have independently inspected or integrated additional Kakshi code.

- **Feature preserved:** reusable image preparation entry point.
- **Original location:** Kakshi's pipeline.py, according to the existing 5 September report.
- **Integration:** depthwizard_person1/src/pipeline.py composes the existing loader,
  validity mask handling and normalization, and Person 1's CLI uses it.
- **Files changed for that prior integration:** depthwizard_person1/src/pipeline.py
  and depthwizard_person1/main.py; neither was rewritten in this follow-up.
- **Benefit:** reusable preparation without losing aspect ratio or geospatial context.

The earlier report says Kakshi's program had no viewer/navigation features.
The camera fixes here are DepthWizard fixes, not attributed to unseen Kakshi code.

## Current verification

- 25 Python tests passed across Persons 1, 2, 3 and 5.
- 14 JavaScript tests passed, including a 512×512 nodata grid and camera events.
- React/Vite production build passed.
- Real pretrained inference through FastAPI TestClient passed for PNG
  (job_4de79e24354a), JPEG (job_8f21415a17b5) and SRTM/GCP-calibrated GeoTIFF
  (job_acf798c9ac30). Assets were successfully retrieved for all cases.
- Browser upload of the synthetic GeoTIFF plus GCP and DEM inputs completed
  through the running frontend/backend as job_f1008490c3a7. The results displayed
  RGB texture, DSM preview, intermediate depth option, CRS, pixel spacing,
  mean/min/max elevations, coordinates and CUDA compute. The viewer reported
  Intel WebGL rendering in the embedded browser.
- Browser Fly mode and drag look visibly changed the aimed terrain location.
  W/A/S/D and Escape were exercised; Overview restored its camera. No browser
  console errors were captured. Sustained physical pointer-lock motion was not
  established by browser automation; its event behavior is covered by unit tests.

Python execution required leaving the tool sandbox; tests then passed. Existing
services already occupied ports 8000/5173, so browser checks reused them.

## Limits and startup

This is an estimated/fused DSM, not survey-grade elevation or automatic building
height. The scientific processing grid is bounded (default 3072 longest side);
the separate viewer grid is bounded at 512. Original uploads are retained.
Geographic metric spacing is approximate, and skewed/large-area rasters require
reprojection for rigorous geometry. Multi-gigabyte browser uploads were not
tested. TIFF preview and metadata appear after backend processing.

From a clean terminal in the repository root, install once:

```powershell
py -3.11 -m venv depthwizard_person5/.venv
.\depthwizard_person5\.venv\Scripts\python.exe -m pip install -r depthwizard_person5/requirements.txt -r depthwizard_person5/requirements-pipeline.txt pytest httpx
npm --prefix depthwizard_person4 install
npm --prefix depthwizard_person6 install
```

Start the backend and frontend in separate terminals:

```powershell
.\start_backend.cmd
```

```powershell
.\start_frontend.cmd
```

Open http://127.0.0.1:5173. Alternatively, .\start_depthwizard.cmd starts both.
Use CORS_ORIGINS and VITE_API_BASE_URL for different development origins.
First inference needs the pretrained weights cached or downloadable.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\test_all.ps1
.\depthwizard_person5\.venv\Scripts\python.exe depthwizard_person3/examples/create_synthetic_demo.py
.\depthwizard_person5\.venv\Scripts\python.exe depthwizard_person5/tests/smoke_real_pipeline.py
```
