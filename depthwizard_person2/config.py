"""Simple configuration shared by the command-line program."""

# Small is the portable default. RTX users may explicitly select Base.
MODEL_NAME = "depth_anything_v2_small"

MODEL_CONFIGS = {
    "depth_anything_v2_small": {
        "display_name": "Depth Anything V2 Small",
        "checkpoint": "depth-anything/Depth-Anything-V2-Small-hf",
        "depth_representation": "relative_inverse_depth",
        "larger_value_means": "closer",
    },
    "depth_anything_v2_base": {
        "display_name": "Depth Anything V2 Base",
        "checkpoint": "depth-anything/Depth-Anything-V2-Base-hf",
        "depth_representation": "relative_inverse_depth",
        "larger_value_means": "closer",
    },
    "depth_anything_v2_large": {
        "display_name": "Depth Anything V2 Large",
        "checkpoint": "depth-anything/Depth-Anything-V2-Large-hf",
        "depth_representation": "relative_inverse_depth",
        "larger_value_means": "closer",
    },
    "midas": {
        "display_name": "MiDaS DPT Hybrid",
        "checkpoint": "Intel/dpt-hybrid-midas",
        "depth_representation": "relative_inverse_depth",
        "larger_value_means": "closer",
    },
}
