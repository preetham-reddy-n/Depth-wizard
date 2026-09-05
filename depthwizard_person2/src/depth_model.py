"""Select the compute device and load a pretrained model."""

from dataclasses import dataclass
import os

from config import MODEL_CONFIGS


@dataclass
class LoadedDepthModel:
    model: object
    processor: object
    device: object
    key: str
    info: dict


def select_device():
    """Prefer an NVIDIA CUDA GPU, while keeping CPU fully supported."""
    try:
        import torch
    except ImportError as exc:
        raise RuntimeError("PyTorch is missing. Run: pip install -r requirements.txt") from exc
    requested = os.getenv("DEPTH_DEVICE", "auto").strip().lower()
    if requested not in {"auto", "cpu", "cuda"}:
        raise ValueError("DEPTH_DEVICE must be auto, cpu, or cuda.")
    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested but is unavailable. Set DEPTH_DEVICE=cpu in depthwizard_person5/.env and restart the backend.")
    return torch.device("cuda" if requested != "cpu" and torch.cuda.is_available() else "cpu")


def load_depth_model(model_key: str) -> LoadedDepthModel:
    """Download/cache and load the requested pretrained depth model."""
    if model_key not in MODEL_CONFIGS:
        raise ValueError(f"Unknown model '{model_key}'. Choices: {', '.join(MODEL_CONFIGS)}")
    try:
        import torch
        from transformers import AutoImageProcessor, AutoModelForDepthEstimation
    except (ImportError, OSError, RuntimeError) as exc:
        raise RuntimeError(
            "The PyTorch/Transformers image stack could not be imported. Run "
            "diagnose.cmd and install all pipeline requirements in the backend environment. "
            "Torch and torchvision must be a compatible pair."
        ) from exc

    device = select_device()
    if device.type == "cuda":
        # Ampere and newer NVIDIA hardware benefits from TF32 for the float32
        # operations that remain outside autocast.
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
    info = MODEL_CONFIGS[model_key]
    try:
        processor = AutoImageProcessor.from_pretrained(info["checkpoint"], use_fast=False)
        model = AutoModelForDepthEstimation.from_pretrained(info["checkpoint"])
    except Exception as exc:
        raise RuntimeError(
            f"Could not load pretrained weights '{info['checkpoint']}'. Check your internet "
            "connection/disk space and access to Hugging Face. Run diagnose.cmd --model "
            "to test the download before starting the website."
        ) from exc
    try:
        model.to(device)
    except (RuntimeError, OSError) as exc:
        raise RuntimeError("Could not place the depth model on the selected device. Set DEPTH_DEVICE=cpu and DEPTH_MODEL=depth_anything_v2_small in depthwizard_person5/.env, restart, and run diagnose.cmd --model.") from exc
    model.eval()
    return LoadedDepthModel(model, processor, device, model_key, info)
