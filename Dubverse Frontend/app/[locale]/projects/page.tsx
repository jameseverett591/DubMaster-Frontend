'use client'
import { useRouter } from 'next/navigation'

export default function ProjectsPage() {
  const router = useRouter()
  return (
    <div className="min-h-screen bg-[#020817] flex flex-col items-center justify-center gap-6">
      <h1 className="text-2xl font-bold text-white">My Projects</h1>
      <p className="text-slate-400">Project management coming soon.</p>
      <button
        onClick={() => router.push('/dashboard')}
        className="px-4 py-2 rounded bg-purple-600 text-white text-sm hover:bg-purple-700"
      >
        ← Back to Dashboard
      </button>
    </div>
  )
}
