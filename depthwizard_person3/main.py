"""DepthWizard Person 3: calibrate, fuse, export, and validate a DSM estimate."""

import argparse
from pathlib import Path
import sys
import warnings

import numpy as np
from pyproj import CRS

from config import DEFAULT_ALPHA, DEFAULT_OUTPUT_NODATA, DEFAULT_SRTM_RESAMPLING, MAX_CALIBRATION_SAMPLES
from src.alignment import align_raster_to_target, check_alignment, estimate_source_scale_pixels
from src.calibration import coarse_srtm_pairs, extract_gcp_pairs, fit_candidate_models, load_gcps
from src.export import write_dsm, write_json, write_preview
from src.fusion import fuse_srtm_and_depth
from src.io_utils import (
    format_depth_summary,
    format_raster_summary,
    load_depth_metadata,
    load_relative_depth,
    match_depth_to_target,
    read_geotiff_metadata,
    derive_target_grid,
    validate_depth_metadata,
)
from src.srtm import format_srtm_summary, read_srtm
from src.validation import calculate_metrics


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create an estimated/fused absolute DSM.")
    parser.add_argument("--geotiff", required=True, help="Original georeferenced RGB GeoTIFF")
    parser.add_argument("--depth", required=True, help="2-D relative_depth.npy")
    parser.add_argument("--depth-metadata", help="Optional depth model metadata JSON")
    parser.add_argument("--srtm", help="Local SRTM tile or mosaic")
    parser.add_argument("--gcps", help="Optional GCP CSV or JSON")
    parser.add_argument("--reference", help="Optional independent reference DSM")
    parser.add_argument("--output-dir", default="outputs")
    parser.add_argument("--alpha", type=float, default=DEFAULT_ALPHA, help="Strength of monocular detail")
    parser.add_argument(
        "--calibration", choices=("auto", "linear", "inverse", "robust_linear"), default="auto"
    )
    parser.add_argument(
        "--allow-depth-resampling",
        action="store_true",
        help="Explicitly allow bilinear resizing when depth dimensions differ",
    )
    parser.add_argument(
        "--use-depth-grid",
        action="store_true",
        help="Calibrate on the depth grid with a CRS-preserving scaled target transform",
    )
    parser.add_argument(
        "--resampling", choices=("nearest", "bilinear"), default=DEFAULT_SRTM_RESAMPLING
    )
    return parser.parse_args()


def _result_to_dict(result) -> dict:
    return {
        "type": result.model_type,
        "coefficients": {"a": result.slope, "b": result.intercept},
        "sample_count": result.sample_count,
        "diagnostics": result.diagnostics,
        "warnings": list(result.warnings),
    }


def _json_number(value):
    """Convert a NaN nodata marker to JSON null."""
    if value is None:
        return None
    return float(value) if np.isfinite(value) else None


def main() -> None:
    args = parse_args()
    if not args.srtm and not args.gcps:
        raise ValueError("Absolute calibration requires --gcps, --srtm, or both.")
    if args.alpha < 0:
        raise ValueError("--alpha must be non-negative.")

    source_target = read_geotiff_metadata(args.geotiff)
    print(format_raster_summary("Target GeoTIFF", source_target))

    depth_metadata = load_depth_metadata(args.depth_metadata)
    depth, depth_valid = load_relative_depth(args.depth)
    original_depth_shape = depth.shape
    validate_depth_metadata(depth_metadata, depth.shape)
    target = (
        derive_target_grid(source_target, depth.shape)
        if args.use_depth_grid and depth.shape != source_target.shape
        else source_target
    )
    depth, depth_valid = match_depth_to_target(depth, target.shape, args.allow_depth_resampling)
    if target.shape != source_target.shape:
        print("\nUsing CRS-preserving bounded calibration grid:\n" + format_raster_summary("Working target", target))
    print("\n" + format_depth_summary(depth, depth_valid))

    aligned_srtm = None
    sigma_pixels = 1.0
    if args.srtm:
        srtm, srtm_grid = read_srtm(args.srtm)
        print("\n" + format_srtm_summary(srtm, srtm_grid))
        aligned_srtm = align_raster_to_target(
            args.srtm, target.crs, target.transform, target.width, target.height, args.resampling
        )
        check_alignment(aligned_srtm, depth, target.crs, target.crs, target.transform, target.transform)
        raw_sigma = estimate_source_scale_pixels(args.srtm, target.crs, target.resolution) / 2.0
        # If an SRTM cell is larger than the entire scene, scene-scale averaging
        # is the most meaningful coarse comparison and avoids an enormous kernel.
        sigma_pixels = min(raw_sigma, max(1.0, min(depth.shape) / 4.0))
        print(f"  estimated coarse-scale Gaussian sigma: {sigma_pixels:.2f} target pixels")

    gcp_details = []
    if args.gcps:
        gcp_depth, gcp_height, gcp_details = extract_gcp_pairs(
            load_gcps(args.gcps), depth, target.crs, target.transform, source_shape=source_target.shape
        )
        if gcp_depth.size < 2:
            raise ValueError("Fewer than 2 valid GCPs: scale-plus-offset fitting is impossible.")
        selected, candidates = fit_candidate_models(gcp_depth, gcp_height, args.calibration)
        calibration_reference = "GCPs"
    else:
        coarse_depth, coarse_height, _ = coarse_srtm_pairs(
            depth, aligned_srtm, sigma_pixels, MAX_CALIBRATION_SAMPLES
        )
        selected, candidates = fit_candidate_models(coarse_depth, coarse_height, args.calibration)
        calibration_reference = "coarse SRTM heuristic"

    if args.gcps and args.srtm:
        calibration_source = "SRTM + GCP"
    elif args.gcps:
        calibration_source = "GCP"
    else:
        calibration_source = "SRTM"

    print("\nCandidate calibration diagnostics:")
    for candidate in candidates:
        print(f"  {_result_to_dict(candidate)}")
    print(f"Selected calibration reference: {calibration_reference}")
    print(f"Final calibration source: {calibration_source}")
    print(f"Selected calibration type: {selected.model_type}")
    for note in selected.warnings:
        warnings.warn(note, stacklevel=1)
    calibrated_depth = selected.predict(depth)

    if aligned_srtm is not None:
        final_dsm, _ = fuse_srtm_and_depth(calibrated_depth, aligned_srtm, sigma_pixels, args.alpha)
        fusion_method = "low-frequency SRTM baseline + alpha * calibrated monocular detail"
    else:
        final_dsm = calibrated_depth
        fusion_method = "GCP-calibrated monocular estimate; no SRTM baseline supplied"

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    dsm_array_path = output_dir / "absolute_dsm.npy"
    np.save(dsm_array_path, np.asarray(final_dsm, dtype=np.float32), allow_pickle=False)
    dsm_path = write_dsm(output_dir / "absolute_dsm.tif", final_dsm, target, DEFAULT_OUTPUT_NODATA)
    preview_path = write_preview(output_dir / "preview_dsm.png", final_dsm)

    if args.reference:
        reference = align_raster_to_target(
            args.reference, target.crs, target.transform, target.width, target.height, "bilinear"
        )
        metrics = calculate_metrics(final_dsm, reference)
    else:
        metrics = {"status": "not_calculated", "reason": "No independent --reference DSM was supplied."}
    metrics_path = write_json(output_dir / "metrics.json", metrics)

    target_crs_info = CRS.from_user_input(target.crs)
    target_axis = target_crs_info.axis_info[0] if target_crs_info.axis_info else None
    metadata = {
        "product_description": "Estimated/fused absolute DSM; not survey-grade elevation",
        "is_absolute_elevation": True,
        "elevation_units": "metres",
        "minimum_elevation": float(np.nanmin(final_dsm)),
        "maximum_elevation": float(np.nanmax(final_dsm)),
        "mean_elevation": float(np.nanmean(final_dsm)),
        "inputs": {
            "geotiff": Path(args.geotiff).name,
            "relative_depth": Path(args.depth).name,
            "depth_metadata": Path(args.depth_metadata).name if args.depth_metadata else None,
            "srtm": Path(args.srtm).name if args.srtm else None,
            "gcps": Path(args.gcps).name if args.gcps else None,
            "reference_dsm": Path(args.reference).name if args.reference else None,
        },
        "target": {
            "crs": str(target.crs),
            "width": target.width,
            "height": target.height,
            "source_width": source_target.width,
            "source_height": source_target.height,
            "working_grid_downsampled": target.shape != source_target.shape,
            "transform": list(target.transform)[:6],
            "bounds": list(target.bounds),
            "pixel_resolution": list(target.resolution),
            "horizontal_units": target_axis.unit_name if target_axis is not None else None,
            "horizontal_unit_to_metre": (
                target_axis.unit_conversion_factor
                if target_crs_info.is_projected and target_axis is not None
                else None
            ),
            "source_nodata": _json_number(target.nodata),
            "output_nodata": DEFAULT_OUTPUT_NODATA,
        },
        "depth": {
            "min": float(np.nanmin(depth)),
            "max": float(np.nanmax(depth)),
            "representation": depth_metadata.get(
                "depth_representation", depth_metadata.get("representation", "unspecified")
            ),
            "larger_value_means": depth_metadata.get("larger_value_means", "unspecified"),
            "original_shape": list(original_depth_shape),
            "resampled": original_depth_shape != depth.shape,
        },
        "calibration_source": calibration_source,
        "calibration_reference": calibration_reference,
        "selected_calibration": _result_to_dict(selected),
        "candidate_calibrations": [_result_to_dict(item) for item in candidates],
        "accepted_gcps": gcp_details,
        "fusion_method": fusion_method,
        "coarse_sigma_pixels": sigma_pixels,
        "alpha": args.alpha,
        "validation": metrics,
        "limitations": [
            "SRTM is coarse and does not contain exact building heights.",
            "Upsampling SRTM creates no new terrain information.",
            "SRTM is not guaranteed to be a bare-earth DTM.",
            "Monocular depth detail may have scale, shape, and semantic errors.",
            "A global linear or inverse mapping is only a baseline heuristic.",
            "Vertical datum differences can create systematic offsets.",
            "nDSM/building height requires a reliable ground DEM: nDSM = DSM - DEM.",
        ],
    }
    metadata_path = write_json(output_dir / "metadata.json", metadata)
    print(f"\nWrote:\n  {dsm_array_path}\n  {dsm_path}\n  {preview_path}\n  {metrics_path}\n  {metadata_path}")


if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, ValueError, OSError, RuntimeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1) from error
