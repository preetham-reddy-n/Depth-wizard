"""Explicit real-model API smoke test; not collected by pytest.

Run from repository root with the backend environment. Requires cached model
weights or network access. Artifacts remain in runtime_verification for review.
"""
import io
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "depthwizard_person5"))
os.environ["MOCK_PIPELINE"] = "false"
os.environ["RUNTIME_DIR"] = str(ROOT / "depthwizard_person5" / "runtime_verification")
os.environ["MODEL_MAX_SIZE"] = "512"

from PIL import Image
from fastapi.testclient import TestClient
from main import app


def main():
    scene = ROOT / "depthwizard_person3" / "examples" / "demo_scene.tif"
    client = TestClient(app)
    for extension in ("png", "jpg", "tif"):
        files = {}
        if extension == "tif":
            payload = scene.read_bytes()
            files["srtm"] = ("reference.tif", (scene.parent / "demo_ground_dem.tif").read_bytes())
            files["gcp"] = ("gcps.csv", (scene.parent / "demo_gcps.csv").read_bytes())
        else:
            output = io.BytesIO()
            with Image.open(scene) as image:
                image.convert("RGB").save(output, format="JPEG" if extension == "jpg" else "PNG")
            payload = output.getvalue()
        files["image"] = (f"scene.{extension}", payload)
        response = client.post("/api/process", files=files)
        response.raise_for_status()
        job_id = response.json()["job_id"]
        status = client.get(f"/api/status/{job_id}").json()
        assert status["status"] == "completed", status
        result = client.get(f"/api/results/{job_id}").json()
        assert result["is_absolute_elevation"] == (extension == "tif"), result
        for key in ("heightmap_url", "texture_url", "metadata_url", "dsm_download_url"):
            asset = client.get(result[key])
            assert asset.status_code == 200, key
        grid = client.get(result["heightmap_url"]).json()
        assert len(grid["heights"]) == grid["width"] * grid["height"]
        print(f"PASS {extension}: {job_id}, {result['elevation_units']}, {grid['width']} x {grid['height']}", flush=True)


if __name__ == "__main__":
    main()
