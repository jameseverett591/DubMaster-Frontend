// Sharing a finished dub. Only reachable from the payment-success dialog and
// the paid project cards — never from the editor itself.
//
// SECURITY: `opts.url` is an AUTHENTICATED media URL carrying the owner's
// access token — it may only feed the file-fetch path (blob → share files).
// The URL-share and clipboard fallbacks must use the public share link
// created server-side; handing the token URL to a share sheet or clipboard
// leaks the credential and 401s for the recipient once the token rotates.
import { apiClient } from "./api-client"

const SHARE_FILE_MAX_BYTES = 250 * 1024 * 1024

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed'

export async function shareDubbedVideo(opts: { jobId: string; url: string; title: string }): Promise<ShareResult> {
  const fileName = `${opts.title}_dubbed.mp4`

  // Web Share Level 2: hand the OS the actual video file when it fits.
  if (navigator.canShare) {
    try {
      const resp = await fetch(opts.url)
      if (resp.ok) {
        const blob = await resp.blob()
        if (blob.size <= SHARE_FILE_MAX_BYTES) {
          const file = new File([blob], fileName, { type: blob.type || 'video/mp4' })
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: fileName })
            return 'shared'
          }
        }
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return 'cancelled'
    }
  }

  // URL-level sharing requires the PUBLIC link — never the token URL.
  const shareUrl = await apiClient.createShareLink(opts.jobId).catch(() => null)
  if (!shareUrl) return 'failed'

  if (navigator.share) {
    try {
      await navigator.share({ title: opts.title, text: 'Check out this dubbed video!', url: shareUrl })
      return 'shared'
    } catch (err) {
      return (err as Error)?.name === 'AbortError' ? 'cancelled' : 'failed'
    }
  }

  try {
    await navigator.clipboard.writeText(shareUrl)
    return 'copied'
  } catch {
    return 'failed'
  }
}
