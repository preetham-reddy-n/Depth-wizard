"""Command-line entry point for DepthWizard Person 1."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from config import HIGH_PERCENTILE, LOW_PERCENTILE, PREVIEW_MAX_SIZE, validate_input_path
from src.pipeline import prepare_image
from src.output import write_outputs


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Load an RGB image, preserve GeoTIFF metadata, and prepare model input."
    )
    parser.add_argument("--input", required=True, type=Path, help="Path to a TIFF, PNG, or JPEG")
    parser.add_argument("--output", required=True, type=Path, help="Directory for Person 1 outputs")
    parser.add_argument(
        "--skip-original-array",
        action="store_true",
        help="Do not save the large rgb_original.npy copy when downstream stages do not need it",
    )
    parser.add_argument(
        "--max-model-size",
        type=int,
        help="Downsample only the model/preview grid so very large imagery remains tractable",
    )
    return parser.parse_args()


def print_summary(metadata: dict, output_dir: Path) -> None:
    print("DepthWizard – Person 1\n")
    print(f"Input: {metadata['input_file']}")
    print(f"Dimensions: {metadata['width']} × {metadata['height']}")
    print(f"Bands: {metadata['bands']}")
    print(f"Georeferenced: {'Yes' if metadata['is_georeferenced'] else 'No'}")
    print(f"CRS: {metadata['crs'] or 'None'}")
    if metadata["is_georeferenced"]:
        print(
            "Pixel resolution: "
            f"{metadata['pixel_size_x']:.2f} × {metadata['pixel_size_y']:.2f}"
        )
    print(f"Output written to: {output_dir.resolve()}")


def main() -> int:
    args = parse_arguments()
    try:
        validate_input_path(args.input)
        if args.max_model_size is not None and args.max_model_size < 256:
            raise ValueError("--max-model-size must be at least 256 pixels.")
        loaded, model_rgb = prepare_image(
            args.input, max_model_size=args.max_model_size,
            low_percentile=LOW_PERCENTILE,
            high_percentile=HIGH_PERCENTILE,
        )
        write_outputs(
            args.output,
            loaded.original_rgb,
            model_rgb,
            loaded.valid_mask,
            loaded.metadata,
            PREVIEW_MAX_SIZE,
            save_original_array=not args.skip_original_array,
        )
        print_summary(loaded.metadata, args.output)
        return 0
    except (FileNotFoundError, ValueError, OSError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
