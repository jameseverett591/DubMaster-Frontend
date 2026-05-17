import { Suspense } from "react"
import { UserDashboard } from "@/components/user-dashboard"
import { LoadingSpinner } from "@/components/loading-spinner"

export default function DashboardPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <UserDashboard />
    </Suspense>
  )
}
