"""QC on the RunPod GPU (PR 7).

QC's re-transcription must run on the RunPod GPU worker (about 31 s on a feature
film), never on the backend CPU (about 41 minutes, and it froze the API). These
tests pin that down: the availability gate accepts RunPod only when fully
configured, the re-transcription dispatches to RunPod and never starts the local
Whisper path, results map back into the QC schema, and the R2 hand-off copy is
cleaned up whether the worker succeeds or fails.

Run from the backend root (inside the backend container):

    python -m unittest tests.test_qc_runpod -v
"""

import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest import mock

RUNPOD_ENV = {"RUNPOD_API_KEY": "k", "RUNPOD_ENDPOINT_ID": "e"}
R2_ENV = {"R2_BUCKET_NAME": "b", "R2_ACCESS_KEY_ID": "i",
          "R2_SECRET_ACCESS_KEY": "s", "R2_ACCOUNT_ID": "a"}
# QC_ALLOW_CPU is a gate input too — a host env that has it would make every
# "refused" test silently pass.
ALL_KEYS = list(RUNPOD_ENV) + list(R2_ENV) + ["QC_ALLOW_CPU"]


def _env(**extra):
    """A clean environment holding only the given QC-related variables."""
    base = {k: v for k, v in os.environ.items() if k not in ALL_KEYS}
    base.update(extra)
    return mock.patch.dict(os.environ, base, clear=True)


class GateTests(unittest.TestCase):

    def setUp(self):
        from app.api import routes
        self.routes = routes
        # No local GPU: torch missing is the same as torch with no CUDA device.
        p = mock.patch.dict(sys.modules, {"torch": None})
        p.start()
        self.addCleanup(p.stop)

    def test_runpod_and_r2_configured_is_available(self):
        with _env(**RUNPOD_ENV, **R2_ENV):
            self.assertTrue(self.routes._qc_gpu_available())

    def test_nothing_configured_is_refused(self):
        with _env():
            self.assertFalse(self.routes._qc_gpu_available())

    def test_runpod_without_r2_is_refused(self):
        with _env(**RUNPOD_ENV):
            self.assertFalse(self.routes._qc_gpu_available())

    def test_r2_without_runpod_is_refused(self):
        with _env(**R2_ENV):
            self.assertFalse(self.routes._qc_gpu_available())

    def test_local_cuda_is_available(self):
        torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True))
        with mock.patch.dict(sys.modules, {"torch": torch}), _env():
            self.assertTrue(self.routes._qc_gpu_available())


class RetranscribeTests(unittest.TestCase):

    def setUp(self):
        from app.pipeline import analyze_dub
        self.mod = analyze_dub
        self.tmp = tempfile.mkdtemp(prefix="qcrunpod_")
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        job_dir = Path(self.tmp) / "job_qcrp1"
        job_dir.mkdir()
        self.video = job_dir / "dubbed_en.mp4"
        self.video.write_bytes(b"x")
        self.opus = job_dir / "dubbed_en.qc.opus"

    def test_dispatches_to_runpod_and_never_runs_local_whisper(self):
        with _env(**RUNPOD_ENV, **R2_ENV), \
             mock.patch.object(self.mod, "_retranscribe_via_runpod",
                               return_value={"status": "ok", "engine": "runpod"}) as rp, \
             mock.patch.object(self.mod.subprocess, "run") as sp:
            out = self.mod._retranscribe_dubbed_audio(self.video, "en")
        self.assertEqual(out["engine"], "runpod")
        rp.assert_called_once()
        sp.assert_not_called()  # the local path would start ffmpeg + CPU Whisper

    def test_runpod_not_chosen_without_r2(self):
        # RunPod keys but no R2 bucket: the RunPod path cannot work, so it must
        # not be picked (a local-GPU host would otherwise fail instead of using
        # its own GPU). The local path is stubbed out to fail fast.
        with _env(**RUNPOD_ENV), \
             mock.patch.object(self.mod, "_retranscribe_via_runpod") as rp, \
             mock.patch.object(self.mod.subprocess, "run", side_effect=RuntimeError("local")):
            out = self.mod._retranscribe_dubbed_audio(self.video, "en")
        rp.assert_not_called()
        self.assertEqual(out["status"], "error")

    def _run_via_runpod(self, poll, ffmpeg=None, s3_setup=None):
        """Run the RunPod path with every external service faked."""
        s3 = mock.MagicMock()
        s3.generate_presigned_url.return_value = "https://r2.example/get"
        if s3_setup:
            s3_setup(s3)
        boto3 = ModuleType("boto3")
        boto3.client = mock.MagicMock(return_value=s3)
        botocore = ModuleType("botocore")
        botocore_config = ModuleType("botocore.config")
        botocore_config.Config = mock.MagicMock()
        botocore.config = botocore_config
        rp_service = mock.MagicMock()
        rp_service.submit_job = mock.AsyncMock(return_value={"id": "rp-1"})
        rp_service.poll_until_complete = poll

        def fake_ffmpeg(cmd, **kw):
            self.opus.write_bytes(b"o" * 5000)
            return SimpleNamespace(returncode=0)

        rp_mod = ModuleType("app.services.runpod_service")
        rp_mod.runpod_service = rp_service
        with _env(**RUNPOD_ENV, **R2_ENV), \
             mock.patch.dict(sys.modules, {"boto3": boto3, "botocore": botocore,
                                           "botocore.config": botocore_config,
                                           "app.services.runpod_service": rp_mod}), \
             mock.patch.object(self.mod.subprocess, "run", side_effect=ffmpeg or fake_ffmpeg):
            out = self.mod._retranscribe_via_runpod(self.video, "en")
        return out, s3, rp_service

    # ---- a failure at ANY stage must leave no audio behind ----------------------
    def test_extraction_timeout_leaves_no_local_audio(self):
        import subprocess as _sp

        def ffmpeg_dies_midway(cmd, **kw):
            self.opus.write_bytes(b"o" * 5000)   # partial output already on disk
            raise _sp.TimeoutExpired(cmd, 600)

        out, s3, _ = self._run_via_runpod(mock.AsyncMock(), ffmpeg=ffmpeg_dies_midway)
        self.assertEqual(out["status"], "error")
        self.assertFalse(self.opus.exists())
        s3.upload_file.assert_not_called()
        s3.delete_object.assert_not_called()   # nothing was uploaded

    def test_failed_upload_cleans_local_audio_and_partial_object(self):
        def boom(s3):
            s3.upload_file.side_effect = RuntimeError("upload broke")
        out, s3, _ = self._run_via_runpod(mock.AsyncMock(), s3_setup=boom)
        self.assertEqual(out["status"], "error")
        self.assertFalse(self.opus.exists())
        s3.delete_object.assert_called_once()   # a partial upload may exist

    def test_failed_url_creation_removes_uploaded_copy(self):
        def boom(s3):
            s3.generate_presigned_url.side_effect = RuntimeError("sign broke")
        out, s3, _ = self._run_via_runpod(mock.AsyncMock(), s3_setup=boom)
        self.assertEqual(out["status"], "error")
        self.assertFalse(self.opus.exists())
        s3.upload_file.assert_called_once()
        s3.delete_object.assert_called_once()

    def test_transcribe_only_nested_transcript_is_read(self):
        # The transcribe-only worker returns text under output.transcript.
        # segments — reading only the flat shape silently produced an empty
        # transcript and zeroed pronunciation_clarity.
        poll = mock.AsyncMock(return_value={"transcript": {"segments": [
            {"start": 0.0, "end": 1.5, "text": "nested line", "confidence": 0.9},
        ]}})
        out, _, _ = self._run_via_runpod(poll)
        self.assertEqual(out["status"], "ok")
        self.assertEqual(out["segment_count"], 1)
        self.assertEqual(out["segments"][0]["text"], "nested line")

    def test_runpod_result_maps_into_qc_schema(self):
        poll = mock.AsyncMock(return_value={"segments": [
            {"start": 0.0, "end": 1.5, "text": " hello ", "confidence": 0.9},
            {"start": 2.0, "end": 3.0, "text": "   "},
        ]})
        out, s3, rp = self._run_via_runpod(poll)
        self.assertEqual(out["status"], "ok")
        self.assertEqual(out["engine"], "runpod")
        self.assertEqual(out["segment_count"], 1)
        self.assertEqual(out["segments"][0]["text"], "hello")
        # transcribe-only: the worker must not separate stems or diarize for QC
        self.assertEqual(rp.submit_job.call_args.kwargs["steps"], ["transcribe"])
        s3.delete_object.assert_called_once()
        self.assertFalse(self.opus.exists())

    def test_r2_copy_cleaned_up_when_worker_fails(self):
        poll = mock.AsyncMock(side_effect=RuntimeError("worker died"))
        out, s3, _ = self._run_via_runpod(poll)
        self.assertEqual(out["status"], "error")
        self.assertIn("worker died", out["reason"])
        s3.delete_object.assert_called_once()
        self.assertFalse(self.opus.exists())

    def test_worker_reported_error_is_an_error(self):
        poll = mock.AsyncMock(return_value={"error": "boom"})
        out, _, _ = self._run_via_runpod(poll)
        self.assertEqual(out["status"], "error")
        self.assertIn("boom", out["reason"])

    def test_live_sentinel_is_never_stale_regardless_of_age(self):
        # A long RunPod wait must not let a second run start: staleness is
        # decided by PROCESS identity (pid:token), not age — a sentinel whose
        # writer is alive stays claimed even past any time limit.
        from app.api import routes
        sentinel = Path(self.tmp) / "analysis_en.running"
        token = routes._process_token(os.getpid()) or ""
        sentinel.write_text(f"{os.getpid()}:{token}")
        stale = os.path.getmtime(sentinel) - 25 * 3600
        os.utime(sentinel, (stale, stale))   # "a day old" — must still be live
        self.assertFalse(routes._clear_stale_analysis_sentinel(sentinel))
        self.assertTrue(sentinel.exists())


if __name__ == "__main__":
    unittest.main()
