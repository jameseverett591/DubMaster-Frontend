"""Audio path traversal (Phase 1, PR 1).

These tests ATTACK the code the way a signed-in user could: they save a segment
whose audio points at another job's file (relative "../" and absolute), then
render. On the unfixed code the saves are accepted and the render opens the
other job's file; with the fix the saves are refused and the render skips them.

Run from the backend root (inside the backend container):

    python -m unittest tests.test_audio_path_traversal -v
"""

import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

from fastapi import HTTPException

JOB_A = "job_aaaaaaaa"   # the attacker's own job
JOB_B = "job_bbbbbbbb"   # someone else's job


class _Workspace(unittest.TestCase):
    """Two jobs on disk under a throwaway dubbed/ root."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="pathtrav_")
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.dubbed = os.path.join(self.tmp, "dubbed")
        self.dir_a = os.path.join(self.dubbed, JOB_A)
        self.dir_b = os.path.join(self.dubbed, JOB_B)
        for d in (self.dir_a, self.dir_b):
            os.makedirs(d)
        self.own_take = os.path.join(self.dir_a, "segment_0000.mp3")
        self.other_take = os.path.join(self.dir_b, "secret.mp3")
        for p in (self.own_take, self.other_take):
            with open(p, "wb") as f:
                f.write(b"ID3")
        self.video = os.path.join(self.tmp, "source.mp4")
        with open(self.video, "wb") as f:
            f.write(b"\x00")

    def chdir_to_tmp(self):
        """Run as the server does: cwd above a *relative* dubbed/ root."""
        old = os.getcwd()
        os.chdir(self.tmp)
        self.addCleanup(os.chdir, old)

    def write_segments(self, segments):
        with open(os.path.join(self.dir_a, "segments.json"), "w", encoding="utf-8") as f:
            json.dump({"segments": segments, "video_path": self.video}, f)

    def read_segment(self, ti=0):
        with open(os.path.join(self.dir_a, "segments.json"), encoding="utf-8") as f:
            return next(s for s in json.load(f)["segments"] if s["transcript_index"] == ti)


class CommitEndpointTests(_Workspace, unittest.IsolatedAsyncioTestCase):
    """PATCH /segment/commit/{job}/{index} — the write side."""

    async def asyncSetUp(self):
        from app.api import routes
        self.routes = routes
        self.write_segments([{"transcript_index": 0, "start": 0, "end": 5,
                              "path": None, "committed_audio_url": None}])
        stack = mock.patch.object(routes.settings, "DUBBED_DIR", self.dubbed)
        stack.start()
        self.addCleanup(stack.stop)
        # The Supabase mirror write is best-effort; keep it off the network.
        import app.services.supabase_client as sc
        w = mock.patch.object(sc, "supabase_writer", mock.MagicMock())
        w.start()
        self.addCleanup(w.stop)

    async def commit(self, body):
        return await self.routes.commit_segment_timing(JOB_A, 0, body, request=mock.MagicMock())

    async def test_relative_traversal_to_another_job_is_rejected(self):
        with self.assertRaises(HTTPException) as cm:
            await self.commit({"committed_audio_url": f"../{JOB_B}/secret.mp3"})
        self.assertEqual(cm.exception.status_code, 400)
        self.assertIsNone(self.read_segment()["committed_audio_url"])  # nothing saved

    async def test_absolute_path_to_another_job_is_rejected(self):
        with self.assertRaises(HTTPException) as cm:
            await self.commit({"committed_audio_url": self.other_take})
        self.assertEqual(cm.exception.status_code, 400)
        self.assertIsNone(self.read_segment()["committed_audio_url"])

    async def test_absolute_path_outside_everything_is_rejected(self):
        with self.assertRaises(HTTPException) as cm:
            await self.commit({"committed_audio_url": "/etc/passwd"})
        self.assertEqual(cm.exception.status_code, 400)

    async def test_media_url_naming_another_job_is_rejected(self):
        with self.assertRaises(HTTPException):
            await self.commit({"committed_audio_url": f"/api/media/{JOB_B}/audio/secret.mp3"})

    async def test_audio_dotdot_url_is_rejected(self):
        with self.assertRaises(HTTPException):
            await self.commit({"committed_audio_url": f"/api/media/{JOB_A}/audio/../{JOB_B}/secret.mp3"})

    async def test_staged_path_into_another_job_is_rejected(self):
        # The old check only required the shared dubbed/ root, and the file existing.
        with self.assertRaises(HTTPException) as cm:
            await self.commit({"staged_path": self.other_take})
        self.assertEqual(cm.exception.status_code, 400)
        self.assertIsNone(self.read_segment().get("path"))

    async def test_valid_values_are_saved(self):
        for good in (
            "segment_0000.mp3",                                   # bare filename
            self.own_take,                                        # absolute, inside this job
            os.path.join(self.dubbed, JOB_A, "segment_0000.mp3"), # absolute (via the dubbed root)
            f"/api/media/{JOB_A}/audio/segment_0000.mp3",         # served URL, own job
        ):
            with self.subTest(good=good):
                await self.commit({"committed_audio_url": good})
                self.assertEqual(self.read_segment()["committed_audio_url"], good)

    async def test_cwd_relative_values_with_a_relative_dubbed_root(self):
        # Production shape: DUBBED_DIR is relative ("data/dubbed") and the server
        # stores take paths relative to its working directory. This is the form
        # the staged-take feature sends, and the one a naive "relative to the job
        # folder" reading would wrongly reject.
        self.chdir_to_tmp()
        rel_take = f"dubbed/{JOB_A}/segment_0000.mp3"
        with mock.patch.object(self.routes.settings, "DUBBED_DIR", "dubbed"):
            await self.commit({"committed_audio_url": rel_take})
            self.assertEqual(self.read_segment()["committed_audio_url"], rel_take)
            await self.commit({"staged_path": rel_take})
            self.assertEqual(self.read_segment()["path"], rel_take)
            # ...and the same relative form pointing at another job is still refused.
            for attack in (f"dubbed/{JOB_B}/secret.mp3", f"dubbed/{JOB_A}/../{JOB_B}/secret.mp3"):
                with self.subTest(attack=attack):
                    with self.assertRaises(HTTPException):
                        await self.commit({"committed_audio_url": attack})
                    with self.assertRaises(HTTPException):
                        await self.commit({"staged_path": attack})

    async def test_valid_staged_path_is_accepted(self):
        await self.commit({"staged_path": self.own_take})
        seg = self.read_segment()
        self.assertEqual(seg["path"], self.own_take)


class MixerReadSideTests(_Workspace):
    """The render step must never open a path outside the job folder, whatever
    is already in segments.json (it can be written by other endpoints too)."""

    def test_scene_preview_skips_attack_paths_and_keeps_the_valid_one(self):
        from app.services import dubbing_service as ds
        self.write_segments([
            {"transcript_index": 0, "start_time": 0, "end_time": 3,
             "committed_audio_url": f"../{JOB_B}/secret.mp3"},               # relative attack
            {"transcript_index": 1, "start_time": 3, "end_time": 6,
             "committed_audio_url": self.other_take},                         # absolute attack
            {"transcript_index": 2, "start_time": 6, "end_time": 9,
             "committed_audio_url": "segment_0000.mp3"},                      # legitimate
        ])
        captured = {}

        def fake_mixdown(segments, *_a, **_k):
            captured["paths"] = [os.path.realpath(s["path"]) for s in segments]
            return False  # stop after the mix step; we only need the inputs

        scene = {"start": 0, "end": 10, "source_start": 0, "source_end": 10}
        with mock.patch.object(ds.settings, "DUBBED_DIR", self.dubbed), \
                mock.patch.object(ds.dubbing_service, "_merge_audio_segments_mixdown", fake_mixdown):
            with self.assertRaises(RuntimeError):
                ds.dubbing_service.render_scene_preview(JOB_A, scene, os.path.join(self.tmp, "out.mp4"))

        self.assertEqual(captured["paths"], [os.path.realpath(self.own_take)])

    def test_segment_audio_resolver_used_by_the_film_render(self):
        from app.services import path_safety as ps
        d = self.dir_a
        self.assertIsNone(ps.resolve_segment_audio({"path": self.other_take}, d))
        self.assertIsNone(ps.resolve_segment_audio({"path": f"../{JOB_B}/secret.mp3"}, d))
        self.assertIsNone(ps.resolve_segment_audio(
            {"committed_audio_url": f"/api/media/{JOB_A}/audio/../{JOB_B}/secret.mp3"}, d))
        self.assertIsNone(ps.resolve_segment_audio(
            {"committed_audio_url": f"/api/media/{JOB_B}/audio/secret.mp3"}, d))
        self.assertEqual(ps.resolve_segment_audio({"path": self.own_take}, d),
                         os.path.realpath(self.own_take))
        self.assertEqual(
            ps.resolve_segment_audio({"audio_url": f"/api/media/{JOB_A}/audio/segment_0000.mp3"}, d),
            os.path.realpath(self.own_take))

    def test_cwd_relative_value_resolves_in_the_film_render_and_preview(self):
        from app.services import dubbing_service as ds
        from app.services import path_safety as ps
        self.chdir_to_tmp()
        rel_dir = os.path.join("dubbed", JOB_A)                 # relative job folder, as in production
        rel_take = f"dubbed/{JOB_A}/segment_0000.mp3"           # relative to the working directory
        want = os.path.realpath(self.own_take)
        # film render (remix_dub) resolver
        self.assertEqual(ps.resolve_segment_audio({"path": rel_take}, rel_dir), want)
        self.assertEqual(ps.resolve_segment_audio({"path": "segment_0000.mp3"}, rel_dir), want)
        self.assertIsNone(ps.resolve_segment_audio({"path": f"dubbed/{JOB_B}/secret.mp3"}, rel_dir))
        # scene preview, with the relative form in segments.json
        self.write_segments([{"transcript_index": 0, "start_time": 0, "end_time": 3,
                              "committed_audio_url": rel_take}])
        captured = {}

        def fake_mixdown(segments, *_a, **_k):
            captured["paths"] = [os.path.realpath(s["path"]) for s in segments]
            return False

        scene = {"start": 0, "end": 10, "source_start": 0, "source_end": 10}
        with mock.patch.object(ds.settings, "DUBBED_DIR", "dubbed"), \
                mock.patch.object(ds.dubbing_service, "_merge_audio_segments_mixdown", fake_mixdown):
            with self.assertRaises(RuntimeError):
                ds.dubbing_service.render_scene_preview(JOB_A, scene, os.path.join(self.tmp, "out.mp4"))
        self.assertEqual(captured["paths"], [want])

    def test_film_render_logs_every_refused_file(self):
        from app.services import path_safety as ps
        seg = {"transcript_index": 7, "path": self.other_take,
               "committed_audio_url": f"/api/media/{JOB_B}/audio/secret.mp3"}
        with self.assertLogs("app.services.path_safety", level="WARNING") as logs:
            self.assertIsNone(ps.resolve_segment_audio(seg, self.dir_a, label=f"[REMIX] job={JOB_A}"))
        text = "\n".join(logs.output)
        self.assertIn(f"[REMIX] job={JOB_A}", text)
        self.assertIn("transcript_index=7", text)
        self.assertIn("field=path", text)
        self.assertIn("field=committed_audio_url", text)
        self.assertIn("render as silence", text)

    def test_a_missing_file_is_not_logged_as_refused(self):
        from app.services import path_safety as ps
        with self.assertNoLogs("app.services.path_safety", level="WARNING"):
            self.assertIsNone(ps.resolve_segment_audio(
                {"transcript_index": 1, "path": os.path.join(self.dir_a, "not_rendered_yet.mp3")}, self.dir_a))

    def test_a_value_with_directories_is_read_as_the_server_reads_it(self):
        # "sub/x.mp3" is NOT quietly re-read as job-folder-relative: the rest of the
        # server opens stored values relative to its working directory, so the
        # string has to be safe under THAT reading. Bare filenames are job-relative.
        from app.services import path_safety as ps
        with self.assertRaises(ps.UnsafePath):
            ps.resolve_job_file(self.dir_a, "sub/x.mp3")
        self.assertEqual(ps.resolve_job_file(self.dir_a, "segment_0000.mp3"),
                         os.path.realpath(self.own_take))

    def test_qc_preview_stitch_only_receives_safe_paths(self):
        # analyze_dub (QC, no export yet) also feeds seg["path"] to ffmpeg.
        from app.pipeline import analyze_dub as ad
        from app.services import dubbing_service as ds
        self.chdir_to_tmp()
        qc_a = os.path.join(self.tmp, "data", "dubbed", JOB_A)
        qc_b = os.path.join(self.tmp, "data", "dubbed", JOB_B)
        os.makedirs(qc_a)
        os.makedirs(qc_b)
        own = os.path.join(qc_a, "segment_0000.mp3")
        other = os.path.join(qc_b, "secret.mp3")
        for p in (own, other):
            with open(p, "wb") as f:
                f.write(b"ID3")
        segs = [
            {"transcript_index": 0, "start": 0, "end": 3, "path": f"data/dubbed/{JOB_A}/segment_0000.mp3"},
            {"transcript_index": 1, "start": 3, "end": 6, "path": other},                          # absolute attack
            {"transcript_index": 2, "start": 6, "end": 9, "path": f"data/dubbed/{JOB_B}/secret.mp3"},  # relative attack
        ]
        with open(os.path.join(qc_a, "segments.json"), "w", encoding="utf-8") as f:
            json.dump({"segments": segs, "video_duration": 10}, f)
        captured = {}

        def fake_merge(merge_segments, *_a, **_k):
            captured["paths"] = [os.path.realpath(m["path"]) for m in merge_segments]
            return False  # stop after the stitch; we only need its inputs

        with mock.patch.object(ds.dubbing_service, "_merge_audio_segments", fake_merge):
            result = ad.analyze_dub(JOB_A, "en", self.video)
        self.assertEqual(result["status"], "error")
        self.assertEqual(captured["paths"], [os.path.realpath(own)])

    @unittest.skipUnless(hasattr(os, "symlink"), "needs symlinks")
    def test_symlink_planted_in_the_job_folder_cannot_escape(self):
        from app.services import path_safety as ps
        link = os.path.join(self.dir_a, "innocent.mp3")
        try:
            os.symlink(self.other_take, link)
        except (OSError, NotImplementedError):
            self.skipTest("cannot create symlinks here")
        with self.assertRaises(ps.UnsafePath):
            ps.resolve_job_file(self.dir_a, "innocent.mp3")


if __name__ == "__main__":
    unittest.main()
