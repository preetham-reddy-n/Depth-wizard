"""Small integration tests for the backend contract (no ML models required)."""

from __future__ import annotations

import importlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

PROJECT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_DIR))


PNG_1X1 = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDAT\x08\xd7c\xf8\xcf\xc0\x00\x00"
    b"\x03\x01\x01\x00\xc9\xfe\x92\xef\x00\x00\x00\x00IEND\xaeB`\x82"
)


def make_client(tmp_path: Path) -> TestClient:
    for module in ("config", "file_manager", "pipeline_runner", "api.routes", "main"):
        sys.modules.pop(module, None)
    with patch.dict("os.environ", {"RUNTIME_DIR": str(tmp_path / "runtime"), "MOCK_PIPELINE": "true"}):
        return TestClient(importlib.import_module("main").app)


class BackendTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.client = make_client(Path(self.temporary.name))

    def tearDown(self) -> None:
        self.client.close()
        self.temporary.cleanup()

    def test_health_and_mock_pipeline(self):
        self.assertEqual(self.client.get("/health").json(), {"status": "ok", "service": "DepthWizard Backend"})
        response = self.client.post("/api/process", files={"image": ("scene.png", PNG_1X1, "image/png")})
        self.assertEqual(response.status_code, 200)
        accepted = response.json()
        self.assertEqual(accepted["status"], "queued")
        result = self.client.get(f"/api/results/{accepted['job_id']}").json()
        self.assertEqual(result["status"], "completed")
        self.assertTrue(result["heightmap_url"].endswith("/heightmap.json"))
        self.assertTrue(result["texture_url"].endswith("/rgb_model.png"))
        self.assertFalse(result["is_absolute_elevation"])
        self.assertEqual(self.client.get(f"/api/status/{result['job_id']}").json()["progress"], 100)
        heightmap = self.client.get(result["heightmap_url"])
        self.assertEqual(heightmap.status_code, 200)
        heightmap_body = heightmap.json()
        self.assertEqual((heightmap_body["width"], heightmap_body["height"]), (33, 33))
        self.assertEqual(len(heightmap_body["heights"]), 33 * 33)

    def test_rejects_bad_extension_and_signature(self):
        self.assertEqual(self.client.post("/api/process", files={"image": ("notes.txt", b"hello", "text/plain")}).status_code, 400)
        self.assertEqual(self.client.post("/api/process", files={"image": ("fake.png", b"not a png", "image/png")}).status_code, 400)

    def test_unique_jobs_and_path_traversal_blocked(self):
        first = self.client.post("/api/process", files={"image": ("a.png", PNG_1X1, "image/png")}).json()
        second = self.client.post("/api/process", files={"image": ("b.png", PNG_1X1, "image/png")}).json()
        self.assertNotEqual(first["job_id"], second["job_id"])
        self.assertEqual(self.client.get(f"/api/files/{first['job_id']}/../status.json").status_code, 404)

    def test_accepts_optional_srtm_and_gcp_uploads(self):
        response = self.client.post(
            "/api/process",
            files={
                "image": ("scene.png", PNG_1X1, "image/png"),
                "srtm": ("N28E077.hgt", b"mock-srtm", "application/octet-stream"),
                "gcp": ("controls.csv", b"name,row,col,elevation_m\np1,0,0,100\n", "text/csv"),
            },
        )
        self.assertEqual(response.status_code, 200)
        job_dir = Path(self.temporary.name) / "runtime" / "jobs" / response.json()["job_id"] / "input"
        self.assertTrue((job_dir / "N28E077.hgt").is_file())
        self.assertTrue((job_dir / "gcps.csv").is_file())

    def test_hgt_tile_name_is_preserved_and_validated(self):
        response = self.client.post(
            "/api/process",
            files={
                "image": ("scene.png", PNG_1X1, "image/png"),
                "srtm": ("terrain.hgt", b"not-a-geolocated-tile", "application/octet-stream"),
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("N28E077.hgt", response.json()["detail"])

    def test_pipeline_failure_message_identifies_missing_dependency(self):
        from pipeline_runner import _failure_message

        message = _failure_message(
            "Person 1 preprocessing",
            "Traceback...\nModuleNotFoundError: No module named 'affine'\n",
            1,
        )
        self.assertIn("'affine' is missing", message)
        self.assertIn("requirements-pipeline.txt", message)

    def test_relative_output_link_can_be_regenerated(self):
        from pipeline_runner import _link_or_copy

        root = Path(self.temporary.name) / "rerun"
        root.mkdir()
        first, second, destination = root / "first.npy", root / "second.npy", root / "fused.npy"
        first.write_bytes(b"first-model")
        second.write_bytes(b"second-model")

        _link_or_copy(first, destination)
        _link_or_copy(first, destination)  # Repeating the same completed job is a no-op.
        self.assertEqual(destination.read_bytes(), b"first-model")

        _link_or_copy(second, destination)  # A new model replaces the stale output.
        self.assertEqual(destination.read_bytes(), b"second-model")

    def test_unknown_depth_failure_points_to_diagnostic(self):
        from pipeline_runner import _failure_message
        message = _failure_message('Person 2 depth estimation', 'unclassified failure', 1)
        self.assertIn('diagnose.cmd --model', message)

    def test_calibration_failure_preserves_relative_results_and_merged_metadata(self):
        import pipeline_runner as runner
        from file_manager import create_job, read_status

        job_id, root = create_job()
        runner._write_mock_npy(root / "person2" / "relative_depth.npy")
        runner._write_mock_heightmap(root / "person2" / "heightmap.json")
        (root / "person2" / "depth_metadata.json").write_text('{"min_depth": -2, "max_depth": 12, "mean_depth": 4}')
        (root / "person1" / "metadata.json").write_text('{"is_georeferenced": false, "width": 100, "height": 50}')
        with patch.object(runner.config, "MOCK_PIPELINE", False), \
             patch.object(runner, "run_person1"), patch.object(runner, "run_person2"):
            runner.run_pipeline(root / "input" / "scene.png", root, job_id, srtm_path=root / "missing.tif")
        self.assertEqual(read_status(root)["status"], "completed")
        metadata = json.loads((root / "results" / "metadata.json").read_text())
        self.assertFalse(metadata["is_absolute_elevation"])
        self.assertEqual(metadata["elevation_units"], "relative")
        self.assertEqual(metadata["width"], 100)
        self.assertEqual(metadata["minimum_elevation"], -2)
        self.assertEqual(metadata["maximum_elevation"], 12)
        self.assertEqual(metadata["mean_elevation"], 4)
        self.assertIn("calibration failed", metadata["warning"])
        result = self.client.get(f"/api/results/{job_id}").json()
        self.assertTrue(result["dsm_download_url"].endswith("fused_dsm.npy"))
        self.assertEqual(self.client.get(result["metadata_url"]).json(), metadata)

    def test_absolute_calibration_rejects_untrusted_georeferencing(self):
        from pipeline_runner import PipelineStageError, run_person3

        root = Path(self.temporary.name) / "invalid_georef"
        person1, person2, person3 = root / "person1", root / "person2", root / "person3"
        for directory in (person1, person2, person3):
            directory.mkdir(parents=True)
        (person1 / "metadata.json").write_text(
            '{"is_georeferenced": false, "georeference_warning": "CRS location is inconsistent."}',
            encoding="utf-8",
        )

        with self.assertRaisesRegex(PipelineStageError, "trustworthy GeoTIFF georeferencing"):
            run_person3(
                root / "scene.tif", person1, person2, person3,
                srtm_path=root / "N28E077.hgt",
            )


if __name__ == "__main__":
    unittest.main()
