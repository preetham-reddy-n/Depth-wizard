"""Reusable image preparation, adapted from Kakshi's prepare_image entry point.

Keep DepthWizard's aspect-preserving loader, masks and geospatial metadata;
never force imagery into Kakshi's original fixed 512 x 512 square.
"""
from pathlib import Path

from .image_loader import load_image
from .preprocessing import normalize_rgb


def prepare_image(filename: str | Path, max_model_size: int | None = None,
                  low_percentile: float = 2, high_percentile: float = 98):
    loaded = load_image(Path(filename), max_model_size=max_model_size)
    rgb = normalize_rgb(loaded.original_rgb, loaded.valid_mask,
                        low_percentile=low_percentile, high_percentile=high_percentile)
    return loaded, rgb
