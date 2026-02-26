# Copilot / AI Agent Instructions for DubVerse Phase 1 Integration ✅

Purpose
- Help an AI coding agent be immediately productive integrating Phase 1 backend into a frontend repo.
- Focus on concrete, discoverable patterns and examples in this workspace.

Big picture (quick):
- User uploads a video → `api-client.uploadVideo()` sends file to backend and returns a `job_id`.
- UI navigates to the Dubbing Workspace using that `job_id`.
- `useJobStatus` polls `GET /api/status/{job_id}` (default 2000ms) until `status` is `completed` or `failed`.
- On completion the backend exposes `chunks` via `GET /api/chunks/{job_id}`.

Key files & what to use from them 🔧
- `lib/api-client.ts`
  - API surface: `uploadVideo(file, onProgress)`, `getJobStatus(jobId)`, `getChunks(jobId)`, `cancelJob(jobId)`, `healthCheck()`.
  - Types: `UploadResponse`, `JobStatus`, `ChunkManifest`, `APIError`.
  - Conventions: API base comes from `NEXT_PUBLIC_API_URL` (fallback `http://localhost:8000`).
  - Helpers: `validateVideoFile()`, `formatFileSize()`, `getStatusMessage()`.
- `hooks/use-job-status.ts`
  - Polling hook: default `pollInterval=2000`ms; stops on `completed` or `failed`.
  - Exposes: `{ status, loading, error, refetch, stopPolling, startPolling }`.
  - Accepts `onComplete` and `onError` callbacks—use these to transition UI.
- `components/video-upload-example.tsx` and `components/dubbing-workspace-example.tsx`
  - Practical examples: replace mock upload with `apiClient.uploadVideo()` and pass `response.job_id` as `video.id`.
  - Show how progress bars, toasts, and error handling should be wired.
- `test-backend.js`
  - Run `node test-backend.js` to verify the backend endpoints, CORS and health before integrating.
- `.env.local.example`
  - Set `NEXT_PUBLIC_API_URL` here for local development. Do not commit `.env.local`.

Project-specific conventions & constraints ⚠️
- Identity: `job_id` is the canonical identifier for a processing job and is passed between components and API calls.
- Status enum: `pending | extracting | chunking | completed | failed` (progress 0–100).
- Upload limits validated in `validateVideoFile()`: formats (MP4, MOV, AVI, MKV, WebM), max size 10GB, max duration 2 hours.
- Upload progress: `uploadVideo(file, onProgress)` uses a progress callback with integer percent values.
- Errors: non-OK fetch responses throw Errors; API-specific errors can be wrapped in `DubVerseAPIError` and surfaced via `handleAPIError()`.

Developer workflows & debugging tips 🛠️
- Local backend (from README): run Verdant backend (Uvicorn) on `http://localhost:8000` and confirm with `apiClient.healthCheck()` or `node test-backend.js`.
- Frontend: usual `npm run dev` to test UI. Use the example components to swap-in real behavior.
- Debugging checks: watch network calls for `/api/upload`, `/api/status/{jobId}`, `/api/chunks/{jobId}`; verify `job_id` is returned and used by `useJobStatus`.
- For broken polling: call `apiClient.getJobStatus(jobId)` directly from console to isolate fetch vs. hook issues.

Concrete examples to lean on 📌
- Example: wire upload → workspace
  - `const response = await apiClient.uploadVideo(file, onProgress)`
  - `onVideoSelect({ id: response.job_id, title: file.name, url: URL.createObjectURL(file), source: 'upload' })`
  - `useJobStatus({ jobId: response.job_id, onComplete: ... })`
- Example: stop polling
  - `if (jobStatus.status === 'completed' || jobStatus.status === 'failed') stopPolling()` (already implemented in `useJobStatus`).

What NOT to change without confirmation ❗
- Changing the API contract (status strings, field names like `job_id` or `chunks`)—these reflect Verdant's backend and tests rely on them.
- Upload limits and validation rules—these are intentional and surfaced to users.

If you update docs or examples
- Keep `README.md` and examples in `components/*-example.tsx` consistent.
- Add short test steps when you change the API client or hook (e.g., update `test-backend.js` or add a small script that calls `uploadVideo` and `getJobStatus`).

Feedback requested 🙏
- Anything missing or unclear (e.g., other dev commands, CI workflows, or env variables)? Reply with which area to expand and I will iterate the file.

---
Last updated: Feb 2, 2026
