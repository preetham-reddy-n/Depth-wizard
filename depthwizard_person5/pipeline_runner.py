"""Thin adapters that run Persons 1-3 in order; no ML algorithms live here."""

from __future__ import annotations

import json
import logging
import math
import os
import re
import shutil
import struct
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import config
from file_manager import update_status

logger = logging.getLogger("depthwizard")

STAGE_LABELS = {
    "person1": "Person 1 preprocessing",
    "person2": "Person 2 depth estimation",
    "person3": "Person 3 elevation calibration",
    "person6_heightmap": "3D heightmap conversion",
}


@dataclass
class PipelineStageError(Exception):
    stage: str
    message: str
    return_code: int | None = None
    stdout: str = ""
    stderr: str = ""

    def __str__(self) -> str:
        return self.message


def _run(stage: str, command: list[str]) -> None:
    label = STAGE_LABELS.get(stage, stage.replace("_", " ").title())
    logger.info("[%s] Started", label)
    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=config.PIPELINE_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as exc:
        raise PipelineStageError(
            stage,
            f"{label} timed out after {config.PIPELINE_TIMEOUT_SECONDS} seconds.",
            stdout=exc.stdout or "",
            stderr=exc.stderr or "",
        ) from exc
    except OSError as exc:
        raise PipelineStageError(stage, f"Could not start {stage}: {exc}") from exc
    if completed.returncode != 0:
        message = _failure_message(label, completed.stderr, completed.returncode)
        raise PipelineStageError(
            stage, message, completed.returncode, completed.stdout, completed.stderr
        )
    logger.info("[%s] Completed", label)


def _failure_message(label: str, stderr: str, return_code: int) -> str:
    """Turn a subprocess traceback into a short, actionable browser message."""
    missing = re.search(r"ModuleNotFoundError:\s+No module named ['\"]([^'\"]+)", stderr)
    if missing:
        return (
            f"{label} cannot start because Python module '{missing.group(1)}' is missing. "
            "Install requirements-pipeline.txt in the backend .venv, then restart Uvicorn."
        )
    for line in reversed(stderr.splitlines()):
        detail = line.strip()
        if detail.lower().startswith("error:"):
            return f"{label} failed: {detail[6:].strip()}"
    if return_code in {-9, -1073740791}:
        return f"{label} was stopped, usually because the image exhausted available memory."
    if "depth estimation" in label.lower():
        return (f"{label} failed (exit code {return_code}). Run diagnose.cmd --model "
                "from the project folder to check dependencies, model download and device setup. "
                "Share the final error lines from .local-archive/diagnostics/person2-check.log.")
    return f"{label} failed (exit code {return_code}). Check this job's private status.json for details."


def _require_outputs(stage: str, paths: tuple[Path, ...]) -> None:
    missing = [path.name for path in paths if not path.is_file()]
    if missing:
        raise PipelineStageError(
            stage,
            f"{STAGE_LABELS.get(stage, stage)} completed without required output(s): {', '.join(missing)}.",
        )


def _link_or_copy(source: Path, destination: Path) -> None:
    """Avoid duplicating multi-gigabyte arrays when the filesystem supports links."""
    # A completed relative-only job may be regenerated after changing depth
    # models. If both names already reference the same hard link, it is already
    # current; otherwise remove the stale destination before replacing it.
    if destination.exists():
        try:
            if source.samefile(destination):
                return
        except OSError:
            pass
        destination.unlink()
    try:
        os.link(source, destination)
    except OSError:
        shutil.copy2(source, destination)


def run_person1(input_path: Path, output_dir: Path) -> None:
    _run(
        "person1",
        [
            sys.executable,
            str(config.PERSON1_SCRIPT),
            "--input",
            str(input_path),
            "--output",
            str(output_dir),
            "--skip-original-array",
            "--max-model-size",
            str(config.MODEL_MAX_SIZE),
        ],
    )
    _require_outputs(
        "person1",
        (output_dir / config.PERSON1_RGB_FILENAME, output_dir / "metadata.json"),
    )


def run_person2(person1_dir: Path, output_dir: Path) -> None:
    rgb = person1_dir / config.PERSON1_RGB_FILENAME
    mask = person1_dir / config.PERSON1_MASK_FILENAME
    args = [
        sys.executable, str(config.PERSON2_SCRIPT), "--input", str(rgb),
        "--model", config.DEPTH_MODEL,
    ]
    if mask.exists():
        args.extend(["--mask", str(mask)])
    args.extend(["--output", str(output_dir), "--skip-input-preview"])
    _run("person2", args)
    _require_outputs(
        "person2",
        (
            output_dir / config.PERSON2_DEPTH_FILENAME,
            output_dir / "relative_depth_preview.png",
            output_dir / "heightmap.json",
        ),
    )


def run_person3(input_path: Path, person1_dir: Path, person2_dir: Path, output_dir: Path,
                srtm_path: Path | None = None, gcp_path: Path | None = None,
                fallback_reason: str | None = None) -> None:
    # Absolute calibration is optional at the website boundary. When no SRTM or
    # GCPs are configured, expose Person 2's aligned relative surface to the 3D
    # viewer instead of invoking Person 3, whose CLI correctly requires an
    # absolute-height reference.
    srtm_value = str(srtm_path) if srtm_path else config.PERSON3_SRTM
    gcp_value = str(gcp_path) if gcp_path else config.PERSON3_GCPS
    if fallback_reason or (not srtm_value and not gcp_value):
        depth = person2_dir / config.PERSON2_DEPTH_FILENAME
        preview = person2_dir / "relative_depth_preview.png"
        if not depth.is_file():
            raise PipelineStageError("person3", f"Relative depth input not found: {depth.name}")
        _link_or_copy(depth, output_dir / "fused_dsm.npy")
        heightmap = person2_dir / "heightmap.json"
        if heightmap.is_file():
            shutil.copy2(heightmap, output_dir / "heightmap.json")
        if preview.is_file():
            shutil.copy2(preview, output_dir / "dsm_preview.png")
        source_metadata = _read_json_object(person1_dir / "metadata.json")
        heightmap_metadata = _read_json_object(heightmap)
        depth_metadata = _read_json_object(person2_dir / "depth_metadata.json")
        pixel_size_x = source_metadata.get("pixel_size_x")
        pixel_size_y = source_metadata.get("pixel_size_y")
        report = {
            "calibration_method": "relative_depth_fallback",
            "calibration_source": "Absolute elevation unavailable",
            "elevation_units": "relative",
            "is_absolute_elevation": False,
            "minimum_elevation": depth_metadata.get("min_depth", heightmap_metadata.get("elevation_min")),
            "maximum_elevation": depth_metadata.get("max_depth", heightmap_metadata.get("elevation_max")),
            "mean_elevation": depth_metadata.get("mean_depth"),
            "warning": fallback_reason or "No SRTM or GCP calibration source was configured.",
            "target": {
                "crs": source_metadata.get("crs"),
                "width": source_metadata.get("width"),
                "height": source_metadata.get("height"),
                "source_width": source_metadata.get("width"),
                "source_height": source_metadata.get("height"),
                "transform": source_metadata.get("transform"),
                "horizontal_units": source_metadata.get("horizontal_units"),
                "horizontal_unit_to_metre": source_metadata.get("horizontal_unit_to_metre"),
                "pixel_resolution": [pixel_size_x, pixel_size_y]
                if pixel_size_x is not None and pixel_size_y is not None
                else None,
            },
        }
        (output_dir / "calibration_report.json").write_text(
            json.dumps(report, indent=2), encoding="utf-8"
        )
        logger.info("[Person3] No calibration source configured; emitted relative-depth fallback")
        return

    args = [
        sys.executable,
        str(config.PERSON3_SCRIPT),
        "--geotiff",
        str(input_path),
        "--depth",
        str(person2_dir / config.PERSON2_DEPTH_FILENAME),
    ]
    depth_metadata = person2_dir / "depth_metadata.json"
    if depth_metadata.exists():
        args.extend(["--depth-metadata", str(depth_metadata)])
    if srtm_value:
        args.extend(["--srtm", srtm_value])
    if gcp_value:
        args.extend(["--gcps", gcp_value])
    if config.PERSON3_REFERENCE:
        args.extend(["--reference", config.PERSON3_REFERENCE])
    source_metadata = _read_json_object(person1_dir / "metadata.json")
    if source_metadata.get("is_georeferenced") is not True:
        warning = source_metadata.get("georeference_warning") or "The source has no valid CRS/transform."
        raise PipelineStageError(
            "person3",
            f"Absolute calibration requires trustworthy GeoTIFF georeferencing. {warning}",
        )
    if (
        source_metadata.get("model_width") != source_metadata.get("width")
        or source_metadata.get("model_height") != source_metadata.get("height")
    ):
        args.append("--use-depth-grid")
    args.extend(["--output-dir", str(output_dir)])
    _run("person3", args)
    dsm_array = output_dir / "absolute_dsm.npy"
    if not dsm_array.is_file():
        raise PipelineStageError("person3", "Person 3 did not produce absolute_dsm.npy for the 3D viewer.")
    if not config.PERSON6_HEIGHTMAP_SCRIPT.is_file():
        raise PipelineStageError("person6_heightmap", "Person 6 heightmap converter was not found.")
    _run("person6_heightmap", [sys.executable, str(config.PERSON6_HEIGHTMAP_SCRIPT), str(dsm_array), str(output_dir / "heightmap.json"), "--max-size", str(config.VIEWER_GRID_SIZE)])
    _require_outputs("person6_heightmap", (output_dir / "heightmap.json",))


def _write_mock_npy(path: Path) -> None:
    # A dependency-free, valid little-endian float32 NumPy 2x2 array.
    header = b"{'descr': '<f4', 'fortran_order': False, 'shape': (2, 2), }"
    header += b" " * ((64 - (10 + len(header) + 1) % 64) % 64) + b"\n"
    path.write_bytes(b"\x93NUMPY\x01\x00" + struct.pack("<H", len(header)) + header + struct.pack("<4f", 0.0, 0.33, 0.66, 1.0))


def _read_json_object(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _write_mock_heightmap(path: Path) -> None:
    size = 33
    raw_heights = []
    for row in range(size):
        z = row / (size - 1) * 4.0 - 2.0
        for column in range(size):
            x = column / (size - 1) * 4.0 - 2.0
            value = (
                0.9 * math.exp(-(x * x + z * z) * 0.7)
                + 0.32 * math.sin(x * 2.2) * math.cos(z * 1.8)
                + 0.45 * math.exp(-((x - 1.0) ** 2 + (z + 0.7) ** 2) * 2.0)
            )
            raw_heights.append(value)
    low, high = min(raw_heights), max(raw_heights)
    heights = [round((value - low) / (high - low), 4) for value in raw_heights]
    path.write_text(
        json.dumps(
            {
                "width": size,
                "height": size,
                "heights": heights,
                "elevation_min": 0.0,
                "elevation_max": 1.0,
                "nodata": None,
                "units": "relative",
            },
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )


def _write_mock_png(path: Path) -> None:
    # Dependency-free valid 1x1 RGB PNG, so mock mode works with only the web
    # requirements installed and browsers never receive an unsupported TIFF.
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDAT\x08\xd7c\xf8\xcf\xc0\x00\x00"
        b"\x03\x01\x01\x00\xc9\xfe\x92\xef\x00\x00\x00\x00IEND\xaeB`\x82"
    )


def _run_mock(input_path: Path, job_dir: Path) -> None:
    p1, p2, p3 = (job_dir / "person1", job_dir / "person2", job_dir / "person3")
    # These are contract placeholders, not image/depth algorithm outputs.
    _write_mock_png(p1 / "rgb_model.png")
    (p1 / "metadata.json").write_text(json.dumps({"input_type": "geotiff" if input_path.suffix.lower() in {".tif", ".tiff"} else "image", "is_georeferenced": input_path.suffix.lower() in {".tif", ".tiff"}, "width": 2, "height": 2}, indent=2), encoding="utf-8")
    _write_mock_npy(p2 / "relative_depth.npy")
    _write_mock_png(p2 / "relative_depth_preview.png")
    _write_mock_npy(p3 / "fused_dsm.npy")
    _write_mock_heightmap(p3 / "heightmap.json")
    _write_mock_png(p3 / "dsm_preview.png")
    (p3 / "calibration_report.json").write_text(
        json.dumps(
            {
                "calibration_method": "mock",
                "minimum_elevation": 0.0,
                "maximum_elevation": 1.0,
                "elevation_units": "relative",
                "is_absolute_elevation": False,
                "target": {"width": 33, "height": 33, "pixel_resolution": None},
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def run_pipeline(input_path: Path, job_dir: Path, job_id: str,
                 srtm_path: Path | None = None, gcp_path: Path | None = None) -> None:
    try:
        if config.MOCK_PIPELINE:
            update_status(job_dir, status="preprocessing", progress=15)
            _run_mock(input_path, job_dir)
        else:
            required_scripts = [config.PERSON1_SCRIPT, config.PERSON2_SCRIPT]
            missing = [str(path) for path in required_scripts if not path.is_file()]
            if missing:
                raise PipelineStageError("configuration", "Pipeline script not found: " + ", ".join(missing))
            update_status(job_dir, status="preprocessing", progress=15)
            run_person1(input_path, job_dir / "person1")
            update_status(job_dir, status="depth_estimation", progress=45)
            run_person2(job_dir / "person1", job_dir / "person2")
            update_status(job_dir, status="calibration", progress=75)
            try:
                run_person3(input_path, job_dir / "person1", job_dir / "person2", job_dir / "person3", srtm_path, gcp_path)
            except PipelineStageError as exc:
                if exc.stage != "person3":
                    raise
                logger.warning("Calibration unavailable: %s; stderr=%s", exc.message, exc.stderr)
                # Partial absolute products must never be served as relative results.
                partial = job_dir / "person3" / "failed_calibration"
                partial.mkdir(exist_ok=True)
                for artifact in (job_dir / "person3").iterdir():
                    if artifact.is_file():
                        artifact.replace(partial / artifact.name)
                run_person3(input_path, job_dir / "person1", job_dir / "person2", job_dir / "person3",
                            fallback_reason="Absolute calibration failed or was unavailable. Relative elevation is shown; check the backend log for details.")
        update_status(job_dir, status="terrain_generation", progress=None)
        metadata = {}
        for folder, filename in (("person1", "metadata.json"), ("person2", "depth_metadata.json"),
                                 ("person3", "calibration_report.json"), ("person3", "metadata.json")):
            metadata.update(_read_json_object(job_dir / folder / filename))
        (job_dir / "results" / "metadata.json").write_text(
            json.dumps(metadata, indent=2), encoding="utf-8")
        update_status(job_dir, status="completed", progress=100)
        logger.info("[DepthWizard] Job %s completed successfully", job_id)
    except PipelineStageError as exc:
        logger.error("[%s] %s stderr=%s", exc.stage.title(), exc.message, exc.stderr.strip())
        update_status(job_dir, status="failed", progress=0, stage=exc.stage, message=exc.message,
                      return_code=exc.return_code, stdout=exc.stdout, stderr=exc.stderr)
        raise
    except Exception as exc:
        logger.exception("[DepthWizard] Unexpected pipeline error")
        update_status(job_dir, status="failed", progress=0, stage="backend",
                      message="Unexpected backend processing failure. Check the backend log.", stderr=str(exc))
        raise PipelineStageError("backend", "Unexpected backend processing failure.", stderr=str(exc)) from exc
