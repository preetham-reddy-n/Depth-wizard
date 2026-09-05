"""Command-line entry point for DepthWizard Person 2."""

import argparse
import traceback
import sys
from pathlib import Path

import numpy as np

from config import MODEL_CONFIGS, MODEL_NAME
from src.depth_model import load_depth_model
from src.image_loader import load_rgb_image, load_valid_mask
from src.inference import predict_relative_depth
from src.output import save_outputs
from src.postprocessing import resize_depth, validate_and_mask_depth


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Estimate an image-aligned relative depth map from one RGB image."
    )
    parser.add_argument("--input", required=True, help="PNG/JPEG/TIFF/NPY RGB input")
    parser.add_argument("--output", default="person2_output", help="Output directory")
    parser.add_argument("--mask", help="Optional H x W valid_mask.npy")
    parser.add_argument(
        "--skip-input-preview",
        action="store_true",
        help="Do not duplicate the full input image in the output directory",
    )
    parser.add_argument(
        "--model", default=MODEL_NAME, choices=MODEL_CONFIGS.keys(), help="Pretrained model"
    )
    return parser.parse_args()


def run(args: argparse.Namespace) -> dict[str, Path]:
    print("DepthWizard - Person 2\n")
    rgb = load_rgb_image(args.input)
    original_height, original_width = rgb.shape[:2]
    mask = load_valid_mask(args.mask, (original_height, original_width)) if args.mask else None

    loaded = load_depth_model(args.model)
    print(f"Model: {loaded.info['display_name']}")
    print(f"Device: {str(loaded.device).upper()}")
    print(f"Input dimensions: {original_width} x {original_height}")
    print("Running depth inference...")

    raw_prediction, model_input_hw, inference_info = predict_relative_depth(rgb, loaded, mask)
    depth = resize_depth(raw_prediction, (original_height, original_width))
    depth, stats = validate_and_mask_depth(depth, mask)
    print("Model output resized to original grid.")

    metadata = {
        "model": loaded.info["display_name"],
        "model_key": loaded.key,
        "checkpoint": loaded.info["checkpoint"],
        "device": str(loaded.device),
        "original_width": original_width,
        "original_height": original_height,
        "model_input_width": model_input_hw[1],
        "model_input_height": model_input_hw[0],
        "model_output_width": int(raw_prediction.shape[1]),
        "model_output_height": int(raw_prediction.shape[0]),
        "output_width": int(depth.shape[1]),
        "output_height": int(depth.shape[0]),
        "dtype": str(depth.dtype),
        "depth_representation": loaded.info["depth_representation"],
        "larger_value_means": loaded.info["larger_value_means"],
        "units": "none (uncalibrated relative values)",
        "mathematical_transform": (
            "overlapping local predictions aligned to a global relative-depth pass, high-pass merged, and seam blended"
            if inference_info["inference_mode"] != "single_pass"
            else "none; only bilinear spatial resizing"
        ),
        "resized_back_to_original": bool(raw_prediction.shape != depth.shape),
        "mask_applied": mask is not None,
        "invalid_mask_value": "NaN" if mask is not None else None,
        **inference_info,
        **stats,
    }
    paths = save_outputs(args.output, rgb, depth, metadata, save_input_preview=not args.skip_input_preview)

    loaded_again = np.load(paths["depth"], allow_pickle=False)
    if loaded_again.shape != (original_height, original_width):
        raise RuntimeError("Saved depth shape changed unexpectedly during the save/load check.")

    print(f"\nDepth shape: {depth.shape}")
    print(f"Depth dtype: {depth.dtype}")
    print(f"Depth min: {stats['min_depth']:.6g}")
    print(f"Depth max: {stats['max_depth']:.6g}")
    print(f"Depth mean: {stats['mean_depth']:.6g}")
    print(f"Depth std: {stats['std_depth']:.6g}")
    print("\nSaved:")
    for path in paths.values():
        print(path)
    return paths


def main() -> int:
    try:
        run(parse_args())
        return 0
    except Exception as exc:
        # The backend retains this traceback privately while extracting the
        # final Error line as the short browser message.
        traceback.print_exc(file=sys.stderr)
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
