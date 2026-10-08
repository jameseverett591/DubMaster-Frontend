"""Vendor media tokens (Phase 1, PR 3).

A media token is what Sync.Labs and the video-notes vendor are handed in a URL.
It sits in their logs, so it must unlock only what they actually fetch. These
tests call the REAL routes over HTTP (FastAPI TestClient) with a token for one
job and try to fetch things a vendor has no business reading — above all the
finished film. On the unfixed code those fetches succeed; with the fix they are
refused. The legitimate vendor fetches must keep working.

Run from the backend root (inside the backend container):

    python -m unittest tests.test_vendor_media_tokens -v
"""

import os
import shutil
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

JOB = "job_vendortest1"
OTHER = "job_vendortest2"
SECRET = "test-media-token-secret"


class VendorTokenHttpTests(unittest.TestCase):

    def setUp(self):
        from app.api import routes
        self.routes = routes
        self.tmp = tempfile.mkdtemp(prefix="vendortok_")
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.dubbed = os.path.join(self.tmp, "dubbed")
        job_dir = os.path.join(self.dubbed, JOB)
        os.makedirs(job_dir)
        for name in ("dubbed_en.mp4", "dubbed_audio.wav", "segment_0001.mp3", "lip_in_0.mp4",
                     "lip_in_0.wav", "lip_out_0.mp4", "segments.json", "scrub_proxy.mp4"):
            with open(os.path.join(job_dir, name), "wb") as f:
                f.write(b"FILE:" + name.encode())
        # .webm so the video route does not try to ffmpeg-remux a fake mp4.
        self.video = os.path.join(self.tmp, "source.webm")
        with open(self.video, "wb") as f:
            f.write(b"FILE:original-video")
        job = SimpleNamespace(job_id=JOB, video_path=self.video, user_id="owner-1")

        for p in (
            mock.patch.dict(os.environ, {"MEDIA_TOKEN_SECRET": SECRET}),
            mock.patch.object(routes.settings, "DUBBED_DIR", self.dubbed),
            mock.patch.object(routes, "_get_or_rehydrate_job", mock.AsyncMock(return_value=job)),
        ):
            p.start()
            self.addCleanup(p.stop)

        app = FastAPI()
        app.include_router(routes.router, prefix="/api")
        self.client = TestClient(app)
        self.token = routes._mint_media_token(JOB)

    def get(self, path, token=None, job=JOB):
        return self.client.get(f"/api/media/{job}/{path}", params={"media_token": token or self.token})

    # ---- what vendors legitimately fetch must keep working ---------------------
    def test_vendor_fetches_still_work(self):
        for path, expect in (
            ("video", b"FILE:original-video"),                    # notes + lip-sync
            ("audio/dubbed_audio.wav", b"FILE:dubbed_audio.wav"),  # lip-sync audio
            ("lip_in_0.mp4", b"FILE:lip_in_0.mp4"),                # scoped lip-sync clips
            ("lip_in_0.wav", b"FILE:lip_in_0.wav"),
        ):
            with self.subTest(path=path):
                r = self.get(path)
                self.assertEqual(r.status_code, 200, path)
                self.assertEqual(r.content, expect)

    def test_every_vendor_url_the_code_builds_is_covered(self):
        # The URL shapes lipsync_service / _run_lipsync_ranges / the notes route build.
        rx = self.routes._VENDOR_MEDIA_PATHS
        for built in (
            f"/api/media/{JOB}/video",                               # notes, lip-sync (whole film)
            f"/api/media/{JOB}/audio/dubbed_audio.wav",              # lipsync_service (whole film)
            f"/api/media/{JOB}/lip_in_0.mp4", f"/api/media/{JOB}/lip_in_12.wav",   # scoped ranges
        ):
            self.assertTrue(rx.match(built), built)

    # ---- the attack: a leaked token must not reach anything else --------------
    def test_token_cannot_fetch_the_finished_film_or_other_files(self):
        for path in (
            "dubbed_en.mp4",                    # generic route: the FINISHED FILM
            "audio/dubbed_en.mp4",              # audio route (serves any file in the job folder)
            "audio/segment_0001.mp3",           # a segment's audio
            "segments.json",                    # the job's transcript and settings
            "lip_out_0.mp4",                    # lip-sync RESULT (not an input)
            "lip_in_0.mp4.bak", "lip_in_x.mp4",  # look-alike names
            "scrub-proxy", "separated/vocals", "waveform/accompaniment",
        ):
            with self.subTest(path=path):
                r = self.get(path)
                self.assertEqual(r.status_code, 403, f"{path} -> {r.status_code}")
                self.assertNotIn(b"FILE:dubbed_en.mp4", r.content)

    def test_token_for_one_job_does_not_open_another(self):
        r = self.get("video", job=OTHER)
        self.assertEqual(r.status_code, 401)

    def test_expired_or_garbage_tokens_are_refused(self):
        with mock.patch.object(self.routes.time, "time", return_value=time.time() - 13 * 3600):
            expired = self.routes._mint_media_token(JOB)       # minted 13h ago, TTL is 12h
        for tok in (expired, "garbage", "1.deadbeef", ""):
            with self.subTest(tok=tok[:12]):
                r = self.client.get(f"/api/media/{JOB}/video", params={"media_token": tok} if tok else {})
                self.assertIn(r.status_code, (401, 403))

    # ---- the owner's own login still reaches everything (the editor depends on it)
    def test_owner_login_still_reaches_everything(self):
        r_job = SimpleNamespace(job_id=JOB, video_path=self.video, user_id="owner-1")
        with mock.patch.object(self.routes, "verify_jwt", return_value="owner-1"), \
                mock.patch.object(self.routes, "_require_job", mock.AsyncMock(return_value=r_job)):
            for path in ("dubbed_en.mp4", "audio/segment_0001.mp3", "scrub-proxy", "video"):
                with self.subTest(path=path):
                    r = self.client.get(f"/api/media/{JOB}/{path}", params={"access_token": "owner-jwt"})
                    self.assertEqual(r.status_code, 200, path)


class VendorUrlCredentialTests(unittest.TestCase):

    def test_vendor_url_carries_the_media_token_when_a_secret_exists(self):
        from app.api import routes
        with mock.patch.dict(os.environ, {"MEDIA_TOKEN_SECRET": SECRET}):
            qs = routes._vendor_media_qs(JOB, "LOGIN.JWT.VALUE")
        self.assertTrue(qs.startswith("?media_token="))
        self.assertNotIn("LOGIN.JWT.VALUE", qs)

    def test_without_a_secret_the_login_token_is_never_used(self):
        # Used to fall back to "?access_token=<the caller's login>": a full login
        # credential in vendor URLs and vendor logs. Now: nothing, and a loud log.
        from app.api import routes
        env = {k: v for k, v in os.environ.items() if k not in ("MEDIA_TOKEN_SECRET", "INTERNAL_API_SECRET")}
        with mock.patch.dict(os.environ, env, clear=True), \
                self.assertLogs(routes.logger.name, level="ERROR") as logs:
            qs = routes._vendor_media_qs(JOB, "LOGIN.JWT.VALUE")
        self.assertEqual(qs, "")
        self.assertNotIn("LOGIN.JWT.VALUE", qs)
        self.assertTrue(any("MEDIA-TOKEN" in line for line in logs.output))


if __name__ == "__main__":
    unittest.main()
