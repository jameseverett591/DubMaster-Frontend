"""Free-tier watermarked downloads.

The download route is the paywall's last line. Unpaid jobs must get a
watermarked copy of the film — never the clean file, for inline playback or
attachment downloads — and a failed watermark render must surface an error,
not silently fall back to clean bytes. Paid jobs get the original untouched.

Run from the backend root (inside the backend container):

    python -m unittest tests.test_watermarked_download -v
"""

import os
import shutil
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

JOB = "job_wmtest1"
CLEAN_BYTES = b"clean-video-bytes"
WM_BYTES = b"watermarked-video-bytes"


def _fake_watermark_build(dubbed_path: str, wm_path: str) -> None:
    with open(wm_path, "wb") as f:
        f.write(WM_BYTES)


class WatermarkedDownloadTests(unittest.TestCase):

    def setUp(self):
        from app.api import routes
        self.routes = routes
        self.tmp = tempfile.mkdtemp(prefix="wmtest_")
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.dubbed = os.path.join(self.tmp, "dubbed")
        os.makedirs(os.path.join(self.dubbed, JOB))
        self.clean_path = os.path.join(self.dubbed, JOB, "dubbed_en.mp4")
        with open(self.clean_path, "wb") as f:
            f.write(CLEAN_BYTES)
        self.job = SimpleNamespace(job_id=JOB, video_path="v.mp4", user_id="owner-1")
        for p in (
            mock.patch.object(routes.settings, "DUBBED_DIR", self.dubbed),
            mock.patch.object(routes, "_get_or_rehydrate_job",
                              mock.AsyncMock(return_value=self.job)),
            mock.patch.object(routes, "_caller", return_value="owner-1"),
            mock.patch.object(routes, "_watermark_locks", {}),
        ):
            p.start()
            self.addCleanup(p.stop)
        app = FastAPI()
        app.include_router(routes.router, prefix="/api")
        app.dependency_overrides[routes._dep_job_access] = lambda: None
        self.client = TestClient(app)

    def _unlocked(self, value):
        return mock.patch.object(
            self.routes, "_job_share_unlocked", mock.AsyncMock(return_value=value))

    def test_paid_gets_clean_file(self):
        with self._unlocked(True), \
             mock.patch.object(self.routes, "_build_watermarked_dub") as build:
            r = self.client.get(f"/api/download/{JOB}/en")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.content, CLEAN_BYTES)
        build.assert_not_called()
        self.assertFalse(os.path.exists(self.clean_path + ".tmp.mp4"))
        self.assertFalse(os.path.exists(
            os.path.join(self.dubbed, JOB, "wm_dubbed_en.mp4")))

    def test_unpaid_inline_gets_watermarked_not_clean(self):
        with self._unlocked(False), \
             mock.patch.object(self.routes, "_build_watermarked_dub",
                               side_effect=_fake_watermark_build) as build:
            r = self.client.get(f"/api/download/{JOB}/en")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.content, WM_BYTES)
        self.assertNotEqual(r.content, CLEAN_BYTES)
        build.assert_called_once()

    def test_unpaid_attachment_gets_watermarked_not_clean(self):
        with self._unlocked(False), \
             mock.patch.object(self.routes, "_build_watermarked_dub",
                               side_effect=_fake_watermark_build):
            r = self.client.get(f"/api/download/{JOB}/en?attachment=1")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.content, WM_BYTES)
        self.assertIn("attachment", r.headers.get("content-disposition", ""))

    def test_stale_watermark_rebuilds_after_rerender(self):
        with self._unlocked(False), \
             mock.patch.object(self.routes, "_build_watermarked_dub",
                               side_effect=_fake_watermark_build) as build:
            self.client.get(f"/api/download/{JOB}/en")
            # Simulate a re-render: clean file rewritten later than the wm copy
            import time
            time.sleep(0.05)
            with open(self.clean_path, "wb") as f:
                f.write(CLEAN_BYTES + b"v2")
            r = self.client.get(f"/api/download/{JOB}/en")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(build.call_count, 2)

    def test_watermark_cached_across_requests(self):
        with self._unlocked(False), \
             mock.patch.object(self.routes, "_build_watermarked_dub",
                               side_effect=_fake_watermark_build) as build:
            r1 = self.client.get(f"/api/download/{JOB}/en")
            r2 = self.client.get(f"/api/download/{JOB}/en?attachment=1")
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r1.content, WM_BYTES)
        self.assertEqual(r2.content, WM_BYTES)
        build.assert_called_once()  # second hit served the cache

    def test_watermark_failure_never_serves_clean(self):
        with self._unlocked(False), \
             mock.patch.object(self.routes, "_build_watermarked_dub",
                               side_effect=RuntimeError("ffmpeg died")):
            r = self.client.get(f"/api/download/{JOB}/en")
            r2 = self.client.get(f"/api/download/{JOB}/en?attachment=1")
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r2.status_code, 503)
        self.assertNotIn(CLEAN_BYTES, r.content)

    def test_missing_dub_still_404s(self):
        os.unlink(self.clean_path)
        with self._unlocked(False):
            r = self.client.get(f"/api/download/{JOB}/en")
        self.assertEqual(r.status_code, 404)


class RealEncodeTests(unittest.TestCase):
    """The mocked tests above prove the route plumbing; this one proves the
    encoder itself — the drawtext command and the font file it names must
    actually work in the deployed image (fonts-dejavu-core is pinned in the
    Dockerfile for exactly this)."""

    def setUp(self):
        from app.api import routes
        self.routes = routes
        self.tmp = tempfile.mkdtemp(prefix="wmenc_")
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def _make_clip(self, path):
        import subprocess
        subprocess.run(
            ["ffmpeg", "-y", "-f", "lavfi", "-i",
             "testsrc=duration=1:size=320x240:rate=10",
             "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
             "-c:v", "libx264", "-c:a", "aac", "-shortest", path],
            check=True, capture_output=True)

    def test_drawtext_encode_produces_real_output(self):
        import shutil as _sh
        if not _sh.which("ffmpeg"):
            self.skipTest("ffmpeg not installed")
        if not os.path.exists(self.routes._WATERMARK_FONT):
            self.skipTest("watermark font not installed")
        src = os.path.join(self.tmp, "clip.mp4")
        out = os.path.join(self.tmp, "wm_clip.mp4")
        self._make_clip(src)
        self.routes._build_watermarked_dub(src, out)
        self.assertGreater(os.path.getsize(out), 1000)

    def test_source_changed_during_encode_is_not_published(self):
        src = os.path.join(self.tmp, "clip.mp4")
        out = os.path.join(self.tmp, "wm_clip.mp4")
        with open(src, "wb") as f:
            f.write(b"v1" * 2048)

        def _fake_run(cmd, **_kw):
            # Encoder "succeeds" and writes a FULL-SIZE output (>1KB, so only
            # the fingerprint check can reject it), but the source moved
            # under it — the result must never be published as current.
            with open(cmd[-1], "wb") as f:
                f.write(WM_BYTES * 100)
            with open(src, "ab") as f:
                f.write(b"changed")
            return SimpleNamespace(returncode=0, stderr=b"")

        with mock.patch.object(self.routes.subprocess, "run", side_effect=_fake_run):
            with self.assertRaises(RuntimeError) as cm:
                self.routes._build_watermarked_dub(src, out)
        # rc=0 proves the fingerprint check — not the encode check — fired.
        self.assertIn("rc=0", str(cm.exception))
        self.assertFalse(os.path.exists(out))
        self.assertFalse(os.path.exists(out + ".tmp.mp4"))

    def test_failed_encode_raises_and_leaves_no_partial_file(self):
        # Source stays put; the encoder exits nonzero after writing a large
        # partial file — the returncode check must reject it.
        src = os.path.join(self.tmp, "clip.mp4")
        out = os.path.join(self.tmp, "wm_clip.mp4")
        with open(src, "wb") as f:
            f.write(b"v1" * 2048)

        def _fake_run(cmd, **_kw):
            with open(cmd[-1], "wb") as f:
                f.write(b"x" * 4096)
            return SimpleNamespace(returncode=1, stderr=b"boom")

        with mock.patch.object(self.routes.subprocess, "run", side_effect=_fake_run):
            with self.assertRaises(RuntimeError) as cm:
                self.routes._build_watermarked_dub(src, out)
        self.assertIn("rc=1", str(cm.exception))
        self.assertFalse(os.path.exists(out))
        self.assertFalse(os.path.exists(out + ".tmp.mp4"))

    def test_missing_source_raises(self):
        with self.assertRaises(RuntimeError):
            self.routes._build_watermarked_dub(
                os.path.join(self.tmp, "nope.mp4"),
                os.path.join(self.tmp, "out.mp4"))


if __name__ == "__main__":
    unittest.main()
