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

    async def test_dotdot_spelling_is_refused_even_when_it_resolves_inside_the_job(self):
        # These land in the job's own folder — but the stored STRING would carry a
        # ".." that anything reading the text (not the file) could be steered by.
        for spelled in (
            f"{self.dubbed}/{JOB_A}/../{JOB_A}/segment_0000.mp3",
            f"{self.dubbed}/{JOB_B}/../{JOB_A}/segment_0000.mp3",
            f"/api/media/{JOB_A}/audio/../audio/segment_0000.mp3",
        ):
            with self.subTest(spelled=spelled):
                with self.assertRaises(HTTPException) as cm:
                    await self.commit({"committed_audio_url": spelled})
                self.assertEqual(cm.exception.status_code, 400)
                with self.assertRaises(HTTPException):
                    await self.commit({"staged_path": spelled})
        self.assertIsNone(self.read_segment()["committed_audio_url"])

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

    def test_dotdot_components_and_encoded_separators_are_refused_by_the_resolver(self):
        from app.services import path_safety as ps
        for bad in (
            "a/../segment_0000.mp3", f"{JOB_A}/../{JOB_A}/segment_0000.mp3", "../segment_0000.mp3",
            "segment_0000.mp3/..", "..\\segment_0000.mp3", "%2e%2e/segment_0000.mp3",
            "dir%2fsegment_0000.mp3", "dir%5csegment_0000.mp3",
            f"/api/media/{JOB_A}/audio/../{JOB_A}/segment_0000.mp3",
            self.dir_a + "/../" + JOB_A + "/segment_0000.mp3",
        ):
            with self.subTest(bad=bad):
                with self.assertRaises(ps.UnsafePath):
                    ps.resolve_job_file(self.dir_a, bad)
        # and a plain, legitimate value is unaffected
        self.assertEqual(ps.resolve_job_file(self.dir_a, "segment_0000.mp3"),
                         os.path.realpath(self.own_take))

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


class CallSiteTests(_Workspace, unittest.IsolatedAsyncioTestCase):
    """The real entry points that open files named by a segment — each is called
    the way the server calls it, with the expensive/IO parts stubbed so the test
    can see exactly which file would have been opened."""

    async def asyncSetUp(self):
        from app.api import routes
        self.routes = routes
        p = mock.patch.object(routes.settings, "DUBBED_DIR", self.dubbed)
        p.start()
        self.addCleanup(p.stop)

    # ---- POST /analyze-segment/{job}/{index} ---------------------------------
    async def test_analyze_segment_refuses_another_jobs_audio(self):
        self.write_segments([{"transcript_index": 0, "start": 0, "end": 3, "path": self.other_take}])
        spy = mock.MagicMock(return_value={"status": "ok"})
        with mock.patch("app.services.syncnet_service.analyze_segment_lip_sync", spy):
            with self.assertRaises(HTTPException) as cm:
                await self.routes.analyze_segment(JOB_A, 0)
        self.assertEqual(cm.exception.status_code, 404)
        spy.assert_not_called()                       # the other job's file was never opened

    async def test_analyze_segment_relative_attack_is_refused(self):
        self.chdir_to_tmp()
        self.write_segments([{"transcript_index": 0, "start": 0, "end": 3,
                              "path": f"dubbed/{JOB_B}/secret.mp3"}])
        spy = mock.MagicMock(return_value={"status": "ok"})
        with mock.patch.object(self.routes.settings, "DUBBED_DIR", "dubbed"), \
                mock.patch("app.services.syncnet_service.analyze_segment_lip_sync", spy):
            with self.assertRaises(HTTPException):
                await self.routes.analyze_segment(JOB_A, 0)
        spy.assert_not_called()

    async def test_analyze_segment_opens_the_jobs_own_file(self):
        self.write_segments([{"transcript_index": 0, "start": 0, "end": 3, "path": self.own_take}])
        spy = mock.MagicMock(return_value={"status": "ok"})
        with mock.patch("app.services.syncnet_service.analyze_segment_lip_sync", spy):
            result = await self.routes.analyze_segment(JOB_A, 0)
        self.assertEqual(result, {"status": "ok"})
        self.assertEqual(os.path.realpath(spy.call_args.args[1]), os.path.realpath(self.own_take))

    # ---- POST /analyze-lipsync/{job} -----------------------------------------
    async def test_analyze_lipsync_never_hands_attack_paths_to_the_scorers(self):
        self.write_segments([
            {"transcript_index": 0, "start_time": 0, "end_time": 3, "path": self.other_take},
            {"transcript_index": 1, "start_time": 3, "end_time": 6,
             "committed_audio_url": f"../{JOB_B}/secret.mp3"},
            {"transcript_index": 2, "start_time": 6, "end_time": 9,
             "audio_url": f"/api/media/{JOB_B}/audio/secret.mp3"},
            {"transcript_index": 3, "start_time": 9, "end_time": 12, "path": self.own_take,
             "committed_audio_url": "segment_0000.mp3"},
        ])
        seen = []

        def spy(_video, segments, *_a, **_k):
            seen.append(segments)
            return []

        request = mock.MagicMock()
        request.json = mock.AsyncMock(return_value={})
        with mock.patch("app.services.syncnet_service.score_lipsync_windows", spy), \
                mock.patch("app.services.syncnet_service.score_lipsync_audio_windows", spy), \
                mock.patch.object(self.routes, "_probe_video_duration", return_value=12.0):
            result = await self.routes.analyze_lipsync_windows(JOB_A, request)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(len(seen), 2)                          # both scorers were called
        for segments in seen:
            by_ti = {s["transcript_index"]: s for s in segments}
            self.assertIsNone(by_ti[0]["path"])
            self.assertIsNone(by_ti[1]["committed_audio_url"])
            self.assertIsNone(by_ti[2]["audio_url"])
            # safe values come back as their normalized real path (same file, no spelling to misread)
            self.assertEqual(by_ti[3]["path"], os.path.realpath(self.own_take))
            self.assertEqual(by_ti[3]["committed_audio_url"], os.path.realpath(self.own_take))
        # cleaning the in-memory copy must not rewrite segments.json
        self.assertEqual(self.read_segment(0)["path"], self.other_take)

    async def test_analyze_lipsync_range_form_is_cleaned_too(self):
        self.write_segments([{"transcript_index": 0, "start_time": 0, "end_time": 3, "path": self.other_take}])
        seen = []

        def spy(_video, segments, *_a, **_k):
            seen.append(segments)
            return {}

        request = mock.MagicMock()
        request.json = mock.AsyncMock(return_value={"start": 0, "end": 5})
        with mock.patch("app.services.syncnet_service.score_lipsync_range", spy), \
                mock.patch("app.services.syncnet_service.score_lipsync_audio_range", spy), \
                mock.patch.object(self.routes, "_probe_video_duration", return_value=12.0):
            await self.routes.analyze_lipsync_windows(JOB_A, request)
        self.assertEqual(len(seen), 2)
        for segments in seen:
            self.assertIsNone(segments[0]["path"])

    async def test_analyze_lipsync_dotdot_spelling_cannot_steer_the_scorers_into_another_job(self):
        # Resolves INSIDE job A, but its spelling names job B: the scorer derives
        # search folders from the directory names in `path` ("data/dubbed/<job>/…"
        # -> "data/projects/<job>/dubbed"), so an unnormalized value could make it
        # look in job B's project folder for the file named by committed_audio_url.
        from app.services import syncnet_service as sn
        self.chdir_to_tmp()
        for d in (f"data/dubbed/{JOB_A}", f"data/dubbed/{JOB_B}", f"data/projects/{JOB_B}/dubbed"):
            os.makedirs(os.path.join(self.tmp, d), exist_ok=True)
        secret = os.path.join(self.tmp, "data", "projects", JOB_B, "dubbed", "dubbed_en.mp4")
        with open(secret, "wb") as f:
            f.write(b"another customer's film")
        with open(os.path.join(self.tmp, "data", "dubbed", JOB_A, "segments.json"), "w", encoding="utf-8") as f:
            json.dump({"video_path": self.video, "segments": [{
                "transcript_index": 0, "start_time": 0, "end_time": 3,
                "path": f"data/dubbed/{JOB_B}/../{JOB_A}/missing.mp3",
                "committed_audio_url": f"/api/media/{JOB_A}/audio/dubbed_en.mp4",
            }]}, f)
        seen = []

        def spy(_video, segments, *_a, **_k):
            seen.append(segments)
            return []

        request = mock.MagicMock()
        request.json = mock.AsyncMock(return_value={})
        with mock.patch.object(self.routes.settings, "DUBBED_DIR", "data/dubbed"), \
                mock.patch("app.services.syncnet_service.score_lipsync_windows", spy), \
                mock.patch("app.services.syncnet_service.score_lipsync_audio_windows", spy), \
                mock.patch.object(self.routes, "_probe_video_duration", return_value=3.0):
            await self.routes.analyze_lipsync_windows(JOB_A, request)
        self.assertTrue(seen)
        for segments in seen:
            # run the scorer's real file lookup on exactly what it was handed
            found = sn._resolve_seg_audio(segments[0], sn._job_dir_hints(JOB_A))
            self.assertNotEqual(found and os.path.realpath(found), os.path.realpath(secret))
            self.assertIsNone(segments[0]["path"])               # a ".." spelling is refused outright
            self.assertNotIn(JOB_B, str(segments[0].get("path")))

    def test_sanitize_segments_returns_normalized_real_paths(self):
        from app.services import path_safety as ps
        self.chdir_to_tmp()
        # Odd-but-harmless spellings (doubled slash, "./") are rewritten to the one
        # canonical real path, so no reader is left to interpret the spelling.
        out = ps.sanitize_segments(
            [{"transcript_index": 0,
              "path": f"dubbed//{JOB_A}/./segment_0000.mp3",
              "committed_audio_url": "segment_0000.mp3"}],
            os.path.join("dubbed", JOB_A))
        want = os.path.realpath(self.own_take)
        self.assertEqual(out[0]["path"], want)
        self.assertEqual(out[0]["committed_audio_url"], want)

    def test_job_dir_hints_come_only_from_the_job_id(self):
        # The scorer's fallback folders: this job's folder and its projects-layout
        # twin — chosen from the job id, never from the text of a stored path.
        from app.services import syncnet_service as sn
        from app.config import get_settings
        self.chdir_to_tmp()
        for d in (f"data/dubbed/{JOB_A}", f"data/projects/{JOB_A}/dubbed",
                  f"data/dubbed/{JOB_B}", f"data/projects/{JOB_B}/dubbed"):
            os.makedirs(os.path.join(self.tmp, d))
        with mock.patch.object(get_settings(), "DUBBED_DIR", "data/dubbed"):
            self.assertEqual(sn._job_dir_hints(JOB_A),
                             [f"data/dubbed/{JOB_A}".replace("/", os.sep),
                              os.path.join("data", "projects", JOB_A, "dubbed")])
            # a job id that is not a plain name yields no folders at all
            for bad in (None, "", "..", ".", f"{JOB_A}/../{JOB_B}", f"../{JOB_B}"):
                self.assertEqual(sn._job_dir_hints(bad), [], bad)

    def test_scorer_finds_the_jobs_own_files_with_normalized_paths(self):
        # POSITIVE test. Normalization hands the scorer absolute paths; its
        # lookups must still FIND the job's own audio — directly, and through the
        # fallback folders (this job's folder and its projects-layout twin).
        from app.services import path_safety as ps
        from app.services import syncnet_service as sn
        from app.config import get_settings
        self.chdir_to_tmp()
        job_dir = os.path.join("data", "dubbed", JOB_A)
        twin = os.path.join("data", "projects", JOB_A, "dubbed")

        def touch(folder, name):
            os.makedirs(os.path.join(self.tmp, folder), exist_ok=True)
            p = os.path.join(self.tmp, folder, name)
            with open(p, "wb") as f:
                f.write(b"ID3")
            return os.path.realpath(p)

        own = touch(job_dir, "segment_0000.mp3")
        film = touch(job_dir, "dubbed_en.mp4")
        moved = touch(twin, "segment_0002.mp3")          # job folder cleaned up; copy lives in the twin
        moved_film = touch(twin, "dubbed_fr.mp4")        # film only in the twin: fallback lookup
        stale = f"data/dubbed/{JOB_A}/gone.mp3"
        segs = [
            {"transcript_index": 0, "path": f"data/dubbed/{JOB_A}/segment_0000.mp3"},
            {"transcript_index": 1, "path": stale, "committed_audio_url": "dubbed_en.mp4"},
            {"transcript_index": 2, "path": f"data/dubbed/{JOB_A}/segment_0002.mp3",
             "committed_audio_url": "segment_0002.mp3"},
            {"transcript_index": 3, "path": stale, "audio_url": f"/api/media/{JOB_A}/audio/dubbed_fr.mp4"},
        ]
        with mock.patch.object(get_settings(), "DUBBED_DIR", "data/dubbed"):
            clean = ps.sanitize_segments(segs, job_dir)
            hints = sn._job_dir_hints(JOB_A)
            found = [sn._resolve_seg_audio(s, hints) for s in clean]
        self.assertEqual([os.path.realpath(p) if p else None for p in found],
                         [own, film, moved, moved_film])

    async def test_analyze_lipsync_passes_the_requests_job_id_to_every_scorer(self):
        # The scorers search fallback folders; the route must hand them the job id
        # so the search is never steered by path text.
        self.write_segments([{"transcript_index": 0, "start_time": 0, "end_time": 3,
                              "path": self.own_take}])
        calls = []

        def spy(name):
            def _spy(_video, _segments, *_a, **kwargs):
                calls.append((name, kwargs.get("job_id")))
                return {} if "range" in name else []
            return _spy

        for body in ({}, {"start": 0, "end": 5}):
            calls.clear()
            request = mock.MagicMock()
            request.json = mock.AsyncMock(return_value=body)
            with mock.patch("app.services.syncnet_service.score_lipsync_windows", spy("windows")), \
                    mock.patch("app.services.syncnet_service.score_lipsync_audio_windows", spy("audio_windows")), \
                    mock.patch("app.services.syncnet_service.score_lipsync_range", spy("range")), \
                    mock.patch("app.services.syncnet_service.score_lipsync_audio_range", spy("audio_range")), \
                    mock.patch.object(self.routes, "_probe_video_duration", return_value=12.0):
                await self.routes.analyze_lipsync_windows(JOB_A, request)
            self.assertEqual(len(calls), 2, body)
            self.assertTrue(all(job == JOB_A for _name, job in calls), calls)

    # ---- remix_dub (Make Movie) ----------------------------------------------
    def _write_remix_segments(self, segments):
        with open(os.path.join(self.dir_a, "segments.json"), "w", encoding="utf-8") as f:
            json.dump({"segments": segments, "video_path": self.video, "language": "en",
                       "video_duration": 12.0}, f)

    async def test_remix_dub_mixes_only_the_jobs_own_audio(self):
        from app.services import dubbing_service as ds
        self._write_remix_segments([
            {"transcript_index": 0, "start": 0, "end": 3, "path": self.other_take},                  # absolute attack
            {"transcript_index": 1, "start": 3, "end": 6, "path": f"../{JOB_B}/secret.mp3"},         # relative attack
            {"transcript_index": 2, "start": 6, "end": 9,
             "committed_audio_url": f"/api/media/{JOB_A}/audio/../{JOB_B}/secret.mp3"},               # URL attack
            {"transcript_index": 3, "start": 9, "end": 12, "path": self.own_take},                  # legitimate
        ])
        captured = {}

        def fake_merge(merge_segments, *_a, **_k):
            captured["paths"] = [os.path.realpath(m["path"]) for m in merge_segments]
            return False                                   # stop before the video mux

        with mock.patch.object(ds.dubbing_service, "dubbed_dir", self.dubbed), \
                mock.patch.object(ds.dubbing_service, "_merge_audio_segments", fake_merge):
            with self.assertRaises(RuntimeError):
                await ds.dubbing_service.remix_dub(JOB_A)
        self.assertEqual(captured["paths"], [os.path.realpath(self.own_take)])

    async def test_remix_dub_with_only_refused_audio_never_reaches_the_mixer(self):
        # Existing behaviour (remix_dub raised this before this PR): when EVERY line is
        # refused or missing the render stops ("no segments have audio") and nothing is
        # mixed. POST /dub/remix refunds the debit when remix_dub raises (_unmeter_render).
        # What is NOT covered is a PARTIAL refusal, which still renders (and bills) a
        # film with some silent lines — see the follow-up list.
        from app.services import dubbing_service as ds
        self._write_remix_segments([
            {"transcript_index": 0, "start": 0, "end": 3, "path": self.other_take},
            {"transcript_index": 1, "start": 3, "end": 6, "path": f"../{JOB_B}/secret.mp3"},
        ])
        merge = mock.MagicMock(return_value=True)
        with mock.patch.object(ds.dubbing_service, "dubbed_dir", self.dubbed), \
                mock.patch.object(ds.dubbing_service, "_merge_audio_segments", merge):
            with self.assertRaises(RuntimeError) as cm:
                await ds.dubbing_service.remix_dub(JOB_A)
        self.assertIn("no segments have audio", str(cm.exception))
        merge.assert_not_called()


    # ---- regenerate_segment: the stored voice-changer recording --------------
    async def _regenerate_with_perf(self, perf_value):
        from app.services import dubbing_service as ds
        self.write_segments([{
            "transcript_index": 0, "start": 0, "end": 3, "text": "hello", "voice_id": "v1",
            "speaker": "speaker-1", "engine": "elevenlabs-sts", "perf_path": perf_value,
        }])
        sts = mock.AsyncMock(return_value=None)
        with mock.patch.object(ds.dubbing_service, "dubbed_dir", self.dubbed), \
                mock.patch.object(ds.elevenlabs_tts, "speech_to_speech", sts), \
                mock.patch.object(ds.elevenlabs_tts, "enabled", True), \
                mock.patch.object(ds, "fish_audio_tts", mock.MagicMock()):
            try:
                await ds.dubbing_service.regenerate_segment(JOB_A, 0)
            except Exception:
                pass          # what happens after the guard is not under test
        return sts

    async def test_regenerate_never_uploads_another_jobs_recording(self):
        # Without the guard, regenerate_segment open()s perf_path and posts its bytes
        # to ElevenLabs speech-to-speech: another job's file leaves the server.
        for attack in (self.other_take, f"../{JOB_B}/secret.mp3", "/etc/hostname"):
            with self.subTest(attack=attack):
                sts = await self._regenerate_with_perf(attack)
                sts.assert_not_called()

    async def test_regenerate_still_uses_the_jobs_own_recording(self):
        own_perf = os.path.join(self.dir_a, "segment_0000_perf.wav")
        with open(own_perf, "wb") as f:
            f.write(b"RIFFdata")
        sts = await self._regenerate_with_perf(own_perf)
        sts.assert_called_once()
        self.assertEqual(sts.call_args.kwargs["audio_bytes"], b"RIFFdata")


if __name__ == "__main__":
    unittest.main()
