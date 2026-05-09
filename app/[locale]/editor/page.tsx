'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function EditorPage() {
  const router = useRouter()

  useEffect(() => {
    const lastJobId = localStorage.getItem('dubverse.lastEditorJobId')
    if (lastJobId && lastJobId !== 'demo') {
      router.replace(`/editor/${lastJobId}`)
    } else {
      router.replace('/dashboard')
    }
  }, [router])

  return null
}
