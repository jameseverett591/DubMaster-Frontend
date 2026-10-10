"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CheckCircle2, Download, Loader2, Share2 } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { shareDubbedVideo } from "@/lib/share-dub"
import { useT } from "@/lib/use-t"

interface DubReadyDialogProps {
  open: boolean
  onClose: () => void
  title: string
  /** Job whose dub is being shared — the public share link is minted for it. */
  jobId: string
  /** Authenticated URL of the rendered dub. */
  videoUrl: string
  /** Same attachment-forcing URL the editor's Download uses. */
  downloadUrl: string
}

export function DubReadyDialog({ open, onClose, title, jobId, videoUrl, downloadUrl }: DubReadyDialogProps) {
  const t = useT()
  const [sharing, setSharing] = useState(false)
  const [copied, setCopied] = useState(false)

  // The dialog stays mounted between jobs — without this the Share button
  // opens still showing "Link copied!" from a previous job.
  useEffect(() => {
    if (open) setCopied(false)
  }, [open, jobId])

  const handleShare = async () => {
    setSharing(true)
    try {
      const result = await shareDubbedVideo({ jobId, url: videoUrl, title })
      if (result === "copied") {
        // Let the "Link copied!" confirmation land before the card closes.
        setCopied(true)
        setTimeout(onClose, 900)
      } else if (result === "shared") {
        onClose()
      }
    } finally {
      setSharing(false)
    }
  }

  return (
    // The card must survive stray clicks: overlay press, Escape, and the X
    // button are all suppressed — it closes only via Download, Share, or
    // "View in My Projects" (rebuilds cost real money; an accidental dismiss
    // used to force users to re-render to find this card again).
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            {t("Your dub is ready")}
          </DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Button asChild className="gap-2">
            <a href={downloadUrl} onClick={onClose}>
              <Download className="h-4 w-4" /> {t("Download")}
            </a>
          </Button>
          <Button variant="outline" className="gap-2" onClick={handleShare} disabled={sharing}>
            {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
            {copied ? t("Link copied!") : t("Share")}
          </Button>
          <Link
            href="/dashboard?tab=projects"
            onClick={onClose}
            className="pt-1 text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t("View in My Projects")}
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  )
}
