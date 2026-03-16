import { Suspense } from "react"
import { AdvancedDubbingEditor } from "@/components/advanced-dubbing-editor"
import { LoadingSpinner } from "@/components/loading-spinner"

export default function EditorPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <AdvancedDubbingEditor />
    </Suspense>
  )
}
