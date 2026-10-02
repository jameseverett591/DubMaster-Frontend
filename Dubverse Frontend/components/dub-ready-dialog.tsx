"use client"

import { useState } from "react"
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
  /** Authenticated URL of the rendered dub. */
  videoUrl: string
  /** Same attachment-forcing URL the editor's Download uses. */
  downloadUrl: string
}

export function DubReadyDialog({ open, onClose, title, videoUrl, downloadUrl }: DubReadyDialogProps) {
  const t = useT()
  const [sharing, setSharing] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleShare = async () => {
    setSharing(true)
    try {
      const result = await shareDubbedVideo({ url: videoUrl, title })
      if (result === "copied") {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } finally {
      setSharing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            {t("Your dub is ready")}
          </DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Button asChild className="gap-2">
            <a href={downloadUrl}>
              <Download className="h-4 w-4" /> {t("Download")}
            </a>
          </Button>
          <Button variant="outline" className="gap-2" onClick={handleShare} disabled={sharing}>
            {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
            {copied ? t("Link copied!") : t("Share")}
          </Button>
          <Link
            href="/dashboard?tab=projects"
            className="pt-1 text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t("View in My Projects")}
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  )
}
