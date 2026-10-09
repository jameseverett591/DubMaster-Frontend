import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Clock, ArrowLeft } from "lucide-react"

interface DubNotReadyViewProps {
  jobId: string
}

export function DubNotReadyView({ jobId }: DubNotReadyViewProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center bg-background">
      <div className="rounded-full bg-muted p-4">
        <Clock className="h-8 w-8 text-muted-foreground" />
      </div>
      <h1 className="text-lg font-semibold text-foreground">Dub not ready yet</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        This job hasn&apos;t finished dubbing yet. Return to your projects and
        complete the dubbing process first.
      </p>
      <Button asChild variant="outline" className="gap-2 mt-2">
        <Link href="/dashboard">
          <ArrowLeft className="h-4 w-4" />
          Back to Projects
        </Link>
      </Button>
      <p className="text-[10px] text-muted-foreground/40 mt-4">Job: {jobId}</p>
    </div>
  )
}
