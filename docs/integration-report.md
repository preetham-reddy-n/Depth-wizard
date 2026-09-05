# DepthWizard integration review — 5 September 2026

## Repository findings before changes

The existing application was already connected: React/Vite (Person 4) calls FastAPI (Person 5); its background pipeline runs the Person 1–3 CLIs and Person 6 heightmap converter. Job directories retain uploaded sources and module outputs. The React results page imports Person 6's Three.js implementation directly. Existing controls implement camera movement, not terrain rotation. Existing tests and the production build passed before changes.

Concrete gaps were optional-calibration failures aborting otherwise usable jobs, separate metadata downloads omitting part of the relative-mode context, hard-coded percentage progress in the UI, global keyboard capture, and an array-spread argument overflow during large nodata filling.

## Files created

- `depthwizard_person1/src/pipeline.py`: reusable preparation interface.
- `depthwizard_person5/tests/smoke_real_pipeline.py`: explicit real-model API verification.
- `docs/integration-report.md`: this report.

## Files modified

- `depthwizard_person1/main.py`: use the reusable preparation function.
- `depthwizard_person4/src/components/ProcessingStatus.jsx`: show actual stages with an indeterminate activity bar.
- `depthwizard_person4/src/pages/ResultsPage.jsx`: display fallback warnings and estimated-surface limitations.
- `depthwizard_person5/pipeline_runner.py`: preserve relative results after calibration failures, isolate partial absolute products, produce merged viewer metadata, and sanitize unexpected failure messages.
- `depthwizard_person5/tests/test_backend.py`: regression coverage for fallback and metadata API handoff.
- `depthwizard_person6/src/dataLoader.js`: linear-time nearest-valid nodata filling and require affirmative calibration metadata before using metre units.
- `depthwizard_person6/src/firstPerson.js`: scope movement keys to the focused/locked canvas and clear held keys on blur or pointer-lock release.
- `depthwizard_person6/tests/terrain.test.js`: 512×512 nodata regression test.
- `README.md`: installation, configuration, module/API flow, verification, and accurate resolution limitations.

Files removed: none. Dependency files unchanged: Kakshi's Pillow, NumPy and Rasterio requirements already exist in DepthWizard. No extra runtime framework was introduced.

## Kakshi feature assessment

Source inspected: the user-provided `DepthWizard-Kakshi` folder, including `image_reader.py`, `preprocessing.py`, `pipeline.py`, `test.py`, requirements and README.

Feature: reusable `prepare_image(filename)` orchestration.

Originally: Kakshi's `pipeline.py`, invoking its reader and preprocessor.

Integration: adapted the interface into `depthwizard_person1/src/pipeline.py` and made Person 1's existing CLI use it. The function returns the loaded source context (metadata and mask included) plus normalized RGB. It composes DepthWizard's existing algorithms; it does not copy Kakshi's simpler loader.

Files changed: the new preparation module and `depthwizard_person1/main.py`.

Benefit: one reusable preparation path for both programmatic callers and the backend CLI, while retaining the team's stronger geospatial implementation.

Kakshi's format checks, RGB conversion and CRS detection were already covered by DepthWizard. Its forced 512×512 resize would distort rectangular scenes and was not adopted. Its import-time script execution and duplicate image opening were also not adopted. This source contains no 3D viewer, camera controls, model selection or export UI to integrate or attribute to Kakshi.

## Final data flow

Upload → React multipart request → FastAPI per-job storage → Person 1 preparation (RGB, validity mask, original geospatial metadata) → Person 2 pretrained relative depth → Person 3 SRTM/GCP alignment and calibration when valid, otherwise explicit relative mode → numerical DSM/depth and preview → bounded heightmap plus merged metadata → RGB-textured Three.js terrain and camera navigation.

Calibration failures retain useful relative depth. Model/preprocessing failures still fail the job. A terrain-conversion error after successful calibration also remains an error rather than silently discarding a valid scientific product.

## Verification

- 25 Python tests passed across Persons 1, 2, 3 and 5.
- 9 JavaScript tests passed, including WASD directions, physical extent, geographic spacing, nodata masking, point readings, and unchanged numerical elevations under visual exaggeration.
- React production build passed.
- Real Depth Anything V2 Base inference through FastAPI passed for PNG (`job_ecb3c63aa2a1`) and JPEG (`job_0f0bb7dbfba6`) in relative mode.
- Real GeoTIFF inference plus SRTM/GCP calibration passed (`job_a9da3371480c`), with metre-labelled DSM and retrievable RGB, metadata and heightmap assets. All three used the synthetic 160×120 demo scene.
- Backend and frontend started on ports 8000 and 5173. Browser loaded the calibrated results from the backend, rendered textured terrain, reported CUDA model compute, displayed metre point inspection and coordinates, and entered Fly mode. WASD and Escape key presses were exercised.

The automated browser session did not establish sustained pointer-lock mouse-look behavior. Validate this interactively in the demo browser. The in-app browser reported Intel WebGL rendering, while model inference used CUDA. Existing GPU-browser launchers remain available.

## Limits retained intentionally

- The default scientific processing grid is bounded to 3072 pixels on its longest side; the interactive grid is separately bounded. Downloads are not guaranteed original-raster resolution. Original uploads remain intact. Raising the processing limit costs memory/time and does not improve the model's inherent accuracy.
- The SRTM reference is supplied by upload or configured local path, not automatically downloaded. No reference means relative mode.
- Calibration against synthetic fixtures verifies software integration, not accuracy on real terrain. SRTM is coarse; GCP/reference vertical datums must be compatible. This is an estimated/fused DSM, not survey-grade reconstruction or direct building height.
- Geographic horizontal spacing uses a local approximation; highly skewed/large-area rasters need reprojection for rigorous metric geometry.
- Large nodata handling is regression-tested at 512×512, but a multi-gigabyte upload was not exercised in the browser.
- UI metadata appears after processing; a separate preflight metadata endpoint was not added.

Exact clean-install and startup commands are in the root README.
