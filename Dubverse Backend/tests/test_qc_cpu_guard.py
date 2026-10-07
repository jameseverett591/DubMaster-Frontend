"""QC CPU guard (PR 4).

Quality analysis loads heavy models. On a backend with no GPU it piles up on the
CPU and starves the API (this froze the editor). Without a GPU the manual trigger
must refuse (503, clear message) and the post-dub auto-trigger must not start.
With a GPU both must still start QC.

Run from the backend root (inside the backend container):

    python -m unittest tests.test_qc_cpu_guard -v
"""

import asyncio
import os
import shutil
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

JOB = "job_qcguard1"


class QcCpuGuardTests(unittest.TestCase):

    def setUp(self):
        from app.api import routes
        self.routes = routes
        self.tmp = tempfile.mkdtemp(prefix="qcguard_")
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        dubbed = os.path.join(self.tmp, "dubbed")
        os.makedirs(os.path.join(dubbed, JOB))
        with open(os.path.join(dubbed, JOB, "dubbed_en.mp4"), "wb") as f:
            f.write(b"x")
        job = SimpleNamespace(job_id=JOB, video_path="v.mp4", user_id="owner-1")
        for p in (
            mock.patch.object(routes.settings, "DUBBED_DIR", dubbed),
            mock.patch.object(routes, "_get_or_rehydrate_job", mock.AsyncMock(return_value=job)),
        ):
            p.start()
            self.addCleanup(p.stop)
        app = FastAPI()
        app.include_router(routes.router, prefix="/api")
        app.dependency_overrides[routes._dep_job_access] = lambda: None
        self.client = TestClient(app)

    def test_manual_trigger_refused_without_gpu(self):
        with mock.patch.object(self.routes, "_qc_gpu_available", return_value=False), \
             mock.patch("app.pipeline.analyze_dub.analyze_dub") as qc:
            r = self.client.post(f"/api/analyze/{JOB}/en")
        self.assertEqual(r.status_code, 503)
        self.assertIn("GPU", r.json()["detail"])
        qc.assert_not_called()

    def test_manual_trigger_starts_with_gpu(self):
        with mock.patch.object(self.routes, "_qc_gpu_available", return_value=True), \
             mock.patch("app.pipeline.analyze_dub.analyze_dub") as qc:
            r = self.client.post(f"/api/analyze/{JOB}/en")
        self.assertEqual(r.status_code, 202)
        self.assertEqual(r.json()["status"], "started")
        qc.assert_called_once()

    def _auto(self, gpu):
        async def run():
            with mock.patch.object(self.routes, "_qc_gpu_available", return_value=gpu), \
                 mock.patch("app.pipeline.analyze_dub.analyze_dub") as qc:
                self.routes._auto_trigger_qc(JOB, "en", "v.mp4")
                await asyncio.sleep(0.2)
                return qc
        return asyncio.run(run())

    def test_auto_trigger_skipped_without_gpu(self):
        self._auto(False).assert_not_called()

    def test_auto_trigger_runs_with_gpu(self):
        self._auto(True).assert_called_once_with(JOB, "en", "v.mp4")

    def test_gpu_probe_false_when_torch_missing(self):
        # No CUDA and no RunPod/R2 configuration anywhere in the environment.
        keys = ("RUNPOD_API_KEY", "RUNPOD_ENDPOINT_ID", "R2_BUCKET_NAME",
                "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ACCOUNT_ID")
        env = {k: v for k, v in os.environ.items() if k not in keys}
        with mock.patch.dict("sys.modules", {"torch": None}), \
             mock.patch.dict(os.environ, env, clear=True):
            self.assertFalse(self.routes._qc_gpu_available())


if __name__ == "__main__":
    unittest.main()
