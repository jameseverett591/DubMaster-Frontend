export type PlanType = 'free' | 'pro'

/** Flat cap on the in-browser recorder, in seconds — a technical ceiling on
 *  one take, not a plan gate. Mirrors MAX_VIDEO_DURATION_SECONDS in the
 *  backend's routes.py. Same for everyone, signed in or not. */
export const RECORDING_LIMIT = 2 * 60 * 60 // 120 min

/** Same flat cap for uploads. The backend enforces it after ffprobe; the
 *  client copy exists for fast rejection before bytes move. */
export const UPLOAD_DURATION_LIMIT = 2 * 60 * 60 // 120 min

/** Maximum upload size. Must match MAX_UPLOAD_SIZE in the backend's
 *  app/config.py — they were out of step once before (client 10GB, server 5GB),
 *  which let an oversized file upload in full before being rejected. */
export const MAX_UPLOAD_GB = 5
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_GB * 1024 ** 3

/** "1 hour" / "2 hours" / "Any length" — used for both the label and the
 *  rejection message so they can never drift apart. */
export function formatDurationLimit(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'Any length'
  const h = seconds / 3600
  if (h >= 1) return `${h} hour${h === 1 ? '' : 's'}`
  return `${Math.round(seconds / 60)} min`
}
