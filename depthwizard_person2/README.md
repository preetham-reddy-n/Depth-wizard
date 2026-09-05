# DepthWizard - Person 2: Monocular Relative Depth

This module turns one RGB image into a floating-point **relative depth map** on
the exact same pixel grid. "Monocular" means the estimate comes from one camera
view, rather than stereo cameras or a laser scanner.

Relative depth tells us which pixels appear closer or farther. It does **not**
provide elevation above sea level and its values are **not metres**. Person 3
must calibrate the output with SRTM and/or ground control points.

## Model and depth direction

The default is the pretrained
`depth-anything/Depth-Anything-V2-Small-hf` checkpoint. Base and Large variants
are optional, plus MiDaS DPT Hybrid. Small is the portable CPU starting point.

These relative models produce an **inverse-depth/disparity-like** prediction:

```text
larger raw value = closer to the camera
smaller raw value = farther from the camera
```

The raw values have no physical unit. The program records this direction in
`depth_metadata.json`. It never converts the raw prediction to metres or to
0..1. Only the human preview is normalized.

## Install

Python 3.13 is the tested project runtime. For the integrated website, use root
`setup.cmd` so Persons 1–3 share the backend environment; do not create separate
module environments. Run `diagnose.cmd --model` to test real inference directly.

```bash
cd depthwizard_person2
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

PyTorch uses CUDA automatically when a compatible NVIDIA setup is available;
otherwise it runs on CPU. The first run downloads model weights from Hugging
Face and later runs use the local cache.

`DEPTH_DEVICE=cpu` forces CPU even if CUDA is detected; `auto` chooses available
CUDA and `cuda` requires it. The integrated backend loads these settings from
`depthwizard_person5/.env`. Restart the backend after editing that file.

## Run

```bash
python main.py --input ../depthwizard_person1/person1_output/rgb_model.png --output person2_output
```

With Person 1's validity mask:

```bash
python main.py --input rgb_model.png --mask valid_mask.npy --output person2_output
```

Choose a model:

```bash
python main.py --input rgb_model.png --model depth_anything_v2_base --output person2_output
python main.py --input rgb_model.png --model midas --output person2_output
```

Accepted inputs are PNG, JPG, JPEG, TIFF, and NPY. Images remain in RGB order.
No flip, rotation, or row/column transpose is performed. A band-first NPY array
(`3 x H x W`) is moved once to image layout (`H x W x 3`).

## What happens to dimensions?

An RGB NumPy image uses `height x width x channels`. Inputs above 1024 pixels on
either side receive one scene-wide pass plus overlapping 768-pixel local passes.
Local results are scale/shift aligned to the global baseline, reduced to their
high-frequency structural detail, cosine blended, and seam-smoothed. This keeps
roofs, roads, and canopy boundaries far better than shrinking a whole 16k scene
to one model input. The output remains aligned to Person 1's working grid; the
metadata maps that grid back to original source row/column coordinates.

## Outputs

```text
person2_output/
|-- relative_depth.npy          # float32 numeric result (main handoff)
|-- relative_depth_preview.png  # normalized grayscale view only
|-- depth_metadata.json         # model, dimensions, direction, statistics
`-- input_preview.png           # RGB image used by the model
```

If `valid_mask.npy` is supplied, pixels where the mask is false are stored as
`NaN` in `relative_depth.npy`. Those pixels do not affect preview normalization
or statistics. Unexpected NaN/infinity values from the model are reported and
replaced with the finite median before the external mask is applied.

## Person 3 handoff

Send Person 3 these two required files:

1. `relative_depth.npy`
2. `depth_metadata.json`

They can load the grid directly:

```python
import numpy as np
depth = np.load("relative_depth.npy")
```

`depth[row, col]` corresponds to Person 1's `image[row, col]`. Also send
`valid_mask.npy` and Person 1's original metadata separately when available;
Person 2 does not alter CRS or affine-transform information.

## Tests

The tests cover a `720 x 1280` shape restoration, RGB orientation, finite-value
checks, NPY save/load shape preservation, mask application, and mask mismatch
errors. They do not download model weights.

```bash
pytest -q
```

## Known limitations

Monocular depth estimation from aerial or satellite imagery is approximate.
The model may not correctly infer terrain or building height in every region.
Although Depth Anything V2 includes aerial scenes in its relative-depth
evaluation, its prediction remains scene-dependent and uncalibrated.

The model is geometric rather than semantic: it has no rule that “road = ground,”
“tree = canopy,” or “building = roof.” For a nadir image, a correctly inferred
closer surface usually corresponds to a higher surface, but class-specific
building/canopy height requires a remote-sensing nDSM model or semantic fusion.

The output is relative depth only and must be calibrated using external
elevation information such as SRTM or GCPs. This module intentionally does not
read CRS metadata, download SRTM, create absolute elevation, fuse a DSM, or
render a 3D scene.
