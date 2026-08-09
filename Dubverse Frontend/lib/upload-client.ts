'use client'

/**
 * Direct-to-R2 multipart upload.
 *
 * Parts go straight from the browser to R2 — the bytes never cross the
 * backend. That gives three things the old path could not: a dropped
 * connection costs one part instead of the whole transfer, the file is not
 * uploaded twice (client -> backend disk -> R2), and the source lands in
 * object storage from the start.
 *
 * The server is authoritative about minutes. This client's only real
 * responsibility is reporting EXPLICIT intent — a user pressing Cancel. It
 * deliberately does not abort on tab close: closing a tab during a 40-minute
 * upload usually means "I'll come back", not "throw it away", and aborting
 * there would destroy resumability for exactly the people who need it. Genuine
 * abandonment is handled by the server's 24h sweep.
 */

import { apiClient } from '@/lib/api-client'

const CONCURRENCY = 3
const PART_RETRIES = 3
const STORE_PREFIX = 'dubmaster_upload_'
// Matches the server's PRESIGN_TTL_SECONDS / STALE_AFTER_HOURS. Past this the
// server has released the reservation, so a saved entry is worthless.
const RESUME_TTL_MS = 24 * 60 * 60 * 1000

export interface CompletedPart {
  part_number: number
  etag: string
}

export interface SavedUpload {
  jobId: string
  uploadId: string
  objectKey: string
  partSize: number
  totalParts: number
  /** Identity only — a File handle cannot be persisted. */
  file: { name: string; size: number; lastModified: number }
  completed: CompletedPart[]
  claimedDuration: number
  createdAt: number
}

export interface UploadResult {
  jobId: string
  durationSeconds: number
  minutesCharged: number
}

export class UploadError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'UploadError'
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function storeKey(jobId: string) {
  return `${STORE_PREFIX}${jobId}`
}

function save(s: SavedUpload) {
  try {
    localStorage.setItem(storeKey(s.jobId), JSON.stringify(s))
  } catch {
    // Storage full or blocked. Resume is a convenience, not a correctness
    // requirement — the upload itself is unaffected.
  }
}

function clear(jobId: string) {
  try { localStorage.removeItem(storeKey(jobId)) } catch { /* see save() */ }
}

function allSaved(): SavedUpload[] {
  const out: SavedUpload[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k?.startsWith(STORE_PREFIX)) continue
      try {
        const s = JSON.parse(localStorage.getItem(k) || '') as SavedUpload
        if (Date.now() - s.createdAt < RESUME_TTL_MS) out.push(s)
        else localStorage.removeItem(k)   // server already released it
      } catch {
        localStorage.removeItem(k)
      }
    }
  } catch { /* storage unavailable */ }
  return out
}

/** A resumable upload matching this exact file, or null.
 *
 *  Identity is name + size + lastModified. This check is the difference
 *  between resuming and silently corrupting: PUTting different bytes into an
 *  existing multipart produces a broken object with no error anywhere.
 */
export function findResumable(file: File): SavedUpload | null {
  return allSaved().find(s =>
    s.file.name === file.name &&
    s.file.size === file.size &&
    s.file.lastModified === file.lastModified
  ) ?? null
}

// ---------------------------------------------------------------------------
// Part transfer
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** PUT one part. Returns its ETag, 'EXPIRED' if the URL lapsed, or null. */
async function putPart(
  url: string, blob: Blob, signal?: AbortSignal,
): Promise<string | 'EXPIRED' | null> {
  for (let attempt = 1; attempt <= PART_RETRIES; attempt++) {
    if (signal?.aborted) throw new UploadError('Cancelled', 'cancelled')
    try {
      // Plain fetch, not apiClient: this goes to R2, and the presigned URL IS
      // the credential. An Authorization header would break the signature.
      const res = await fetch(url, { method: 'PUT', body: blob, signal })

      // 403 means the signature expired, not that the upload died. The
      // multipart is valid in R2 for 7 days; only the URLs lapse at 24h.
      if (res.status === 403) return 'EXPIRED'

      if (res.ok) {
        const etag = res.headers.get('ETag')
        if (!etag) {
          // The PUT succeeded but we cannot read the ETag, which means R2's
          // CORS policy does not expose it. Completing without ETags would
          // fail server-side with a far more confusing error, so name the
          // real cause here.
          throw new UploadError(
            'Upload succeeded but the ETag header was not readable. R2 CORS ' +
            'must include ExposeHeaders: ["ETag"].',
            'cors_etag',
          )
        }
        return etag
      }
    } catch (e) {
      if (e instanceof UploadError) throw e
      if (signal?.aborted) throw new UploadError('Cancelled', 'cancelled')
    }
    if (attempt < PART_RETRIES) await sleep(2 ** attempt * 500)
  }
  return null
}

/** Upload the given part numbers, re-signing once if URLs have expired. */
async function uploadParts(
  file: File,
  state: SavedUpload,
  wanted: number[],
  urls: Map<number, string>,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
  resignDepth = 0,
): Promise<void> {
  const queue = [...wanted]
  const expired: number[] = []

  const progress = () => onProgress?.(
    Math.round((state.completed.length / state.totalParts) * 100)
  )
  progress()

  const worker = async () => {
    for (;;) {
      const n = queue.shift()
      if (n === undefined) return
      const url = urls.get(n)
      if (!url) { expired.push(n); continue }

      const start = (n - 1) * state.partSize
      const blob = file.slice(start, Math.min(start + state.partSize, file.size))
      const etag = await putPart(url, blob, signal)

      if (etag === 'EXPIRED') { expired.push(n); continue }
      if (etag === null) {
        throw new UploadError(`Part ${n} failed after ${PART_RETRIES} attempts`, 'part_failed')
      }
      state.completed.push({ part_number: n, etag })
      // Persist after EACH part: a crash then costs one part, not the upload.
      save(state)
      progress()
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))

  if (expired.length) {
    // One re-sign only. Freshly issued URLs are valid for 24h, so if they come
    // back expired immediately something else is wrong — a clock skew, a
    // revoked key — and recursing would retry forever instead of surfacing it.
    if (resignDepth >= 1) {
      throw new UploadError(
        `Upload URLs expired immediately after being reissued (${expired.length} ` +
        `part(s)). Check the system clock and R2 credentials.`,
        'resign_loop',
      )
    }
    const fresh = await apiClient.presignParts(state.jobId, expired)
    const freshUrls = new Map(fresh.map(p => [p.part_number, p.url]))
    await uploadParts(file, state, expired, freshUrls, onProgress, signal, resignDepth + 1)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function startDirectUpload(
  file: File,
  claimedDurationSeconds: number,
  opts: { onProgress?: (pct: number) => void; signal?: AbortSignal } = {},
): Promise<UploadResult> {
  const pres = await apiClient.presignUpload(
    file.name, file.size, claimedDurationSeconds)

  const state: SavedUpload = {
    jobId: pres.job_id,
    uploadId: pres.upload_id,
    objectKey: pres.object_key,
    partSize: pres.part_size,
    totalParts: pres.parts.length,
    file: { name: file.name, size: file.size, lastModified: file.lastModified },
    completed: [],
    claimedDuration: claimedDurationSeconds,
    createdAt: Date.now(),
  }
  save(state)

  return runToCompletion(file, state, new Map(
    pres.parts.map((p: { part_number: number; url: string }) => [p.part_number, p.url])
  ), opts)
}

export async function resumeDirectUpload(
  file: File,
  saved: SavedUpload,
  opts: { onProgress?: (pct: number) => void; signal?: AbortSignal } = {},
): Promise<UploadResult> {
  // Guard again even though findResumable matched: the caller may have passed
  // a different file, and uploading mismatched bytes into an existing
  // multipart corrupts the object silently.
  if (
    saved.file.name !== file.name ||
    saved.file.size !== file.size ||
    saved.file.lastModified !== file.lastModified
  ) {
    await cancelDirectUpload(saved.jobId)
    throw new UploadError(
      'That is a different file from the one being resumed. The previous ' +
      'upload was cancelled — start again.',
      'file_mismatch',
    )
  }

  const done = new Set(saved.completed.map(p => p.part_number))
  const missing = Array.from({ length: saved.totalParts }, (_, i) => i + 1)
    .filter(n => !done.has(n))

  if (missing.length) {
    const parts = await apiClient.presignParts(saved.jobId, missing)
    return runToCompletion(file, saved, new Map(parts.map(p => [p.part_number, p.url])), opts)
  }
  return runToCompletion(file, saved, new Map(), opts)
}

async function runToCompletion(
  file: File,
  state: SavedUpload,
  urls: Map<number, string>,
  opts: { onProgress?: (pct: number) => void; signal?: AbortSignal },
): Promise<UploadResult> {
  const done = new Set(state.completed.map(p => p.part_number))
  const wanted = Array.from({ length: state.totalParts }, (_, i) => i + 1)
    .filter(n => !done.has(n))

  await uploadParts(file, state, wanted, urls, opts.onProgress, opts.signal)

  const res = await apiClient.completeUpload(
    state.jobId, file.name, file.size,
    // Server sorts by part number, but send them ordered anyway.
    [...state.completed].sort((a, b) => a.part_number - b.part_number),
  )

  // Only clear once the server has settled. Clearing earlier would strand a
  // resumable upload the user could no longer find.
  clear(state.jobId)
  return {
    jobId: res.job_id,
    durationSeconds: res.duration_seconds,
    minutesCharged: res.minutes_charged,
  }
}

/** Explicit cancel. The ONLY thing that should call /upload/abort. */
export async function cancelDirectUpload(jobId: string): Promise<void> {
  try {
    await apiClient.abortUpload(jobId)
  } finally {
    // Clear locally even if the server call failed: the reservation will be
    // released by the 24h sweep, and leaving a dead entry would offer the user
    // a resume that cannot work.
    clear(jobId)
  }
}
