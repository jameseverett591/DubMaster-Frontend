'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams } from 'next/navigation'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Mic2, Star, Search, Play, Check, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { apiClient, API_BASE_URL, type Voice } from '@/lib/api-client'
import { useEditorStore } from '@/lib/editor-store'

const FAVORITES_KEY = 'dubmaster.voiceLibrary.favorites'
const SWIPE_THRESHOLD_FRAC = 0.25 // drag past 25% of viewport width to advance
const DIRECTION_LOCK_PX = 8       // px movement before we lock horizontal-vs-vertical intent

type Layout = 'grid' | 'list'

interface VoiceLibraryContentProps {
  /** 'grid' = responsive multi-col (modal). 'list' = single-column (narrow panel). */
  layout?: Layout
  onVoiceAssigned?: (speakerId: string, voiceId: string) => void
  /** Bumped by the Custom Voices modal to trigger a re-fetch of the user's voices. */
  customVoicesVersion?: number
}

/**
 * Shared body: speakers strip + filter bar + swipe-paginated carousel + favorites.
 * Rendered inside both <VoiceLibraryModal> (Dialog wrapper) and <VoiceLibraryPanel>
 * (right-panel-tab wrapper). All state lives here.
 */
export function VoiceLibraryContent({ layout = 'grid', onVoiceAssigned, customVoicesVersion = 0 }: VoiceLibraryContentProps) {
  // Job context (browse-only when no jobId in URL)
  const params = useParams<{ jobId?: string }>()
  const routeJobId = (params as any)?.jobId as string | undefined
  const storeJobId = useEditorStore((state) => state.jobId)
  const jobId = routeJobId ?? storeJobId ?? undefined
  const isJobAware = !!jobId
  const { segments, speakerVoiceMap, updateSpeakerVoice, pulseSpeaker } = useEditorStore()

  // User-added custom voices (Fish/ElevenLabs) — shown at the top of page 1 as
  // Voice cards so they can be assigned like any catalog voice.
  const [customVoices, setCustomVoices] = useState<Voice[]>([])
  useEffect(() => {
    let cancelled = false
    apiClient.getCustomVoices().then(cvs => {
      if (cancelled) return
      setCustomVoices(cvs.map(cv => ({
        voice_id: cv.voice_id,
        name: cv.name,
        category: 'custom',
        labels: {},
        preview_url: '',
        description: `${cv.provider === 'fish-audio' ? 'Fish Audio' : 'ElevenLabs'} · your voice`,
        tags: [...(cv.tags || []), cv.provider === 'fish-audio' ? 'fish' : 'elevenlabs', 'custom'],
        task_count: 0,
        like_count: 0,
      })))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [customVoicesVersion])

  const getSpeakerDisplayName = useCallback((speakerId: string, speakerLabel?: string) => {
    const digits = speakerId.match(/\d+/)?.[0]
    return digits ? `Speaker ${digits}` : speakerLabel ?? speakerId
  }, [])

  // Page sizing differs by layout:
  //   grid (modal):  50 per page × 3 pages cap = 150 total, dots indicator
  //   list (panel):  1 per page  × 150 pages cap = 150 total, hero card + Page X of N + Jump-to
  // The panel is a scrollable master list now, not one hero card per page, so a
  // page holds a screenful rather than a single voice — 150 pages of one became
  // 8 pages of 20.
  const PAGE_SIZE = layout === 'list' ? 20 : 50
  const MAX_PAGES = layout === 'list' ? 8 : 3
  const gapClass  = layout === 'list' ? 'gap-4' : 'gap-3'

  // Page cache (lazy paginated, in-memory)
  const [pageCache, setPageCache] = useState<Record<number, Voice[]>>({})
  const [pageLoading, setPageLoading] = useState<Record<number, boolean>>({})
  const [pageError, setPageError] = useState<Record<number, string>>({})
  const [currentPage, setCurrentPage] = useState(1)
  const [totalFromServer, setTotalFromServer] = useState<number | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [gender, setGender] = useState('')
  const [tag, setTag] = useState('')
  const [language, setLanguage] = useState('en')
  const [sortBy, setSortBy] = useState('task_count')

  // Context menu for gender filter (panel layout only)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Debounce search
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(t)
  }, [search])

  // Favorites (localStorage)
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY)
      if (raw) setFavorites(new Set(JSON.parse(raw) as string[]))
    } catch {}
  }, [])
  const toggleFavorite = useCallback((voiceId: string) => {
    setFavorites(prev => {
      const next = new Set(prev)
      if (next.has(voiceId)) next.delete(voiceId)
      else next.add(voiceId)
      try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next])) } catch {}
      return next
    })
  }, [])

  // Reset cache when filters change or custom voices are added/removed
  useEffect(() => {
    setPageCache({})
    setPageLoading({})
    setPageError({})
    setCurrentPage(1)
    setTotalFromServer(null)
  }, [tag, gender, language, debouncedSearch, sortBy, customVoicesVersion])

  // Derived total pages
  const totalPages = useMemo(() => {
    if (totalFromServer === null) return 1
    if (totalFromServer <= PAGE_SIZE) return 1
    return Math.min(MAX_PAGES, Math.ceil(totalFromServer / PAGE_SIZE))
  }, [totalFromServer])

  // Lazy fetch
  const fetchPage = useCallback(async (page: number) => {
    if (pageCache[page] !== undefined || pageLoading[page]) return
    setPageLoading(prev => ({ ...prev, [page]: true }))
    setPageError(prev => { const n = { ...prev }; delete n[page]; return n })
    try {
      const r = await apiClient.getVoices({
        page,
        pageSize: PAGE_SIZE,
        tag: tag || undefined,
        gender: gender || undefined,
        language: language || undefined,
        search: debouncedSearch || undefined,
        sortBy,
      })
      setPageCache(prev => ({ ...prev, [page]: r.voices }))
      if (r.total != null) setTotalFromServer(r.total)
      else if (r.voices.length < PAGE_SIZE) {
        setTotalFromServer((page - 1) * PAGE_SIZE + r.voices.length)
      }
    } catch (e: any) {
      setPageError(prev => ({ ...prev, [page]: e?.message || 'Failed to load voices' }))
    } finally {
      setPageLoading(prev => { const n = { ...prev }; delete n[page]; return n })
    }
  }, [tag, gender, language, debouncedSearch, sortBy, pageCache, pageLoading])

  useEffect(() => {
    fetchPage(currentPage)
  }, [currentPage, fetchPage])

  // Speakers strip
  const speakers = useMemo(() => {
    if (!isJobAware) return []
    const seen = new Set<string>()
    const result: Array<{ speaker_id: string; display_name: string; current_voice_id: string | null }> = []
    for (const seg of segments) {
      if (seen.has(seg.speaker_id)) continue
      seen.add(seg.speaker_id)
      result.push({
        speaker_id: seg.speaker_id,
        display_name: getSpeakerDisplayName(seg.speaker_id, seg.speaker_label),
        current_voice_id: speakerVoiceMap[seg.speaker_id] || null,
      })
    }
    // Ensure at least 7 speaker slots are available for assignment
    for (let i = 1; result.length < 7; i++) {
      const spkId = `speaker-${i}`
      if (!seen.has(spkId)) {
        seen.add(spkId)
        result.push({
          speaker_id: spkId,
          display_name: `Speaker ${i}`,
          current_voice_id: speakerVoiceMap[spkId] || null,
        })
      }
    }
    return result
  }, [segments, speakerVoiceMap, isJobAware])

  // Which voice the detail pane is showing (panel layout only).
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null)

  // Reverse of speakerVoiceMap: voice_id → the speakers using it. Assignment
  // state previously lived only in the speakers strip, so there was no way to
  // tell from the library which voices were already in play.
  const voiceAssignments = useMemo(() => {
    const byVoice: Record<string, string[]> = {}
    for (const [speakerId, voiceId] of Object.entries(speakerVoiceMap || {})) {
      if (!voiceId) continue
      ;(byVoice[voiceId] ||= []).push(getSpeakerDisplayName(speakerId))
    }
    return byVoice
  }, [speakerVoiceMap, getSpeakerDisplayName])

  // Preview audio
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const handlePreview = useCallback(async (voiceId: string, previewUrl?: string) => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    if (previewingId === voiceId) { setPreviewingId(null); return }

    // Must go through apiClient.mediaUrl: /api/voice-preview requires auth, and
    // an <audio> element cannot send an Authorization header — the backend takes
    // access_token in the query string instead. Building this URL by hand is why
    // preview 401'd on both the direct play and the blob fallback below.
    // An absolute URL is a third-party preview (ElevenLabs et al) and needs no token.
    const rawPath = previewUrl
      ? (previewUrl.startsWith('/') ? previewUrl : `/${previewUrl}`)
      : `/api/voice-preview/${encodeURIComponent(voiceId)}`
    const src = previewUrl?.startsWith('http')
      ? previewUrl
      : await apiClient.mediaUrl(rawPath)

    // Try direct playback first. If it fails (CORS, range request, or other),
    // fall back to fetching the audio and creating a blob URL to play.
    try {
      console.debug('[VoicePreview] attempting direct play', { voiceId, src })
      const audio = new Audio(src)
      audio.onended = () => setPreviewingId(null)
      audio.onerror = (ev) => {
        console.error('[VoicePreview] direct audio error', ev, src)
        setPreviewingId(null)
      }
      audioRef.current = audio
      setPreviewingId(voiceId)
      await audio.play()
      return
    } catch (err) {
      console.warn('[VoicePreview] direct play failed, falling back to fetch', { voiceId, src, err })
    }

    // Fallback: fetch the audio and play from a blob URL
    try {
      // Belt and braces: src already carries access_token, but send the header
      // too so this path works even if the query-string form is ever dropped.
      const res = await fetch(src, { method: 'GET', headers: await apiClient.ensureAuthHeaders() })
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
      const buf = await res.arrayBuffer()
      const blob = new Blob([buf], { type: res.headers.get('Content-Type') || 'audio/mpeg' })
      const blobUrl = URL.createObjectURL(blob)
      const audio = new Audio(blobUrl)
      audio.onended = () => {
        setPreviewingId(null)
        // release blob URL after a short delay
        setTimeout(() => URL.revokeObjectURL(blobUrl), 2000)
      }
      audio.onerror = (ev) => {
        console.error('[VoicePreview] blob audio error', ev, src)
        setPreviewingId(null)
        setTimeout(() => URL.revokeObjectURL(blobUrl), 2000)
      }
      audioRef.current = audio
      setPreviewingId(voiceId)
      await audio.play()
      return
    } catch (err) {
      console.error('[VoicePreview] fallback fetch/play failed', { voiceId, src, err })
      setPreviewingId(null)
    }
  }, [previewingId])
  // Stop preview when content unmounts (tab switch, modal close)
  useEffect(() => {
    return () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    }
  }, [])

  // Assign
  const [assignFeedback, setAssignFeedback] = useState<Record<string, string>>({})
  const handleAssign = useCallback(async (voiceId: string, speakerId: string) => {
    updateSpeakerVoice(speakerId, voiceId)
    pulseSpeaker(speakerId)
    onVoiceAssigned?.(speakerId, voiceId)
    const newMap = { ...speakerVoiceMap, [speakerId]: voiceId }
    if (jobId) {
      try { await apiClient.updateVoiceMapping(jobId, newMap) } catch {}
    }
    const sp = speakers.find(s => s.speaker_id === speakerId)
    const speakerName = getSpeakerDisplayName(speakerId, sp?.display_name)
    setAssignFeedback(prev => ({ ...prev, [voiceId]: speakerName }))
    setTimeout(() => {
      setAssignFeedback(prev => { const n = { ...prev }; delete n[voiceId]; return n })
    }, 2500)
  }, [jobId, speakerVoiceMap, updateSpeakerVoice, pulseSpeaker, onVoiceAssigned, speakers, getSpeakerDisplayName])

  // Swipe carousel
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragStateRef = useRef<{ startX: number; startY: number; locked: 'h' | 'v' | null; pointerId: number } | null>(null)
  const [dragDelta, setDragDelta] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [jumpInput, setJumpInput] = useState('')

  const goToPage = useCallback((p: number) => {
    setCurrentPage(prev => Math.max(1, Math.min(totalPages, p)))
  }, [totalPages])

  // Wheel-driven page navigation for the list (panel) layout.
  // Vertical scroll wheel moves between pages directly.
  const wheelLockRef = useRef(false)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (layout !== 'list' || totalPages <= 1 || wheelLockRef.current) return
    const delta = e.deltaY
    if (delta > 2 && currentPage < totalPages) {
      e.preventDefault()
      wheelLockRef.current = true
      goToPage(currentPage + 1)
      setTimeout(() => { wheelLockRef.current = false }, 600)
    } else if (delta < -2 && currentPage > 1) {
      e.preventDefault()
      wheelLockRef.current = true
      goToPage(currentPage - 1)
      setTimeout(() => { wheelLockRef.current = false }, 600)
    }
  }, [layout, totalPages, currentPage, goToPage])

  useEffect(() => {
    const el = viewportRef.current
    if (!el || layout !== 'list') return
    const handler = (e: WheelEvent) => {
      if (totalPages <= 1 || wheelLockRef.current) return
      if (e.deltaY > 2 && currentPage < totalPages) {
        e.preventDefault()
        wheelLockRef.current = true
        goToPage(currentPage + 1)
        setTimeout(() => { wheelLockRef.current = false }, 600)
      } else if (e.deltaY < -2 && currentPage > 1) {
        e.preventDefault()
        wheelLockRef.current = true
        goToPage(currentPage - 1)
        setTimeout(() => { wheelLockRef.current = false }, 600)
      }
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [layout, totalPages, currentPage, goToPage])

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button, select, input, a, textarea, [role="button"], [draggable="true"]')) return
    dragStateRef.current = {
      startX: e.clientX, startY: e.clientY, locked: null, pointerId: e.pointerId,
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const s = dragStateRef.current
    if (!s) return
    const dx = e.clientX - s.startX
    const dy = e.clientY - s.startY
    if (s.locked === null) {
      if (Math.abs(dx) > DIRECTION_LOCK_PX || Math.abs(dy) > DIRECTION_LOCK_PX) {
        s.locked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
        if (s.locked === 'h') {
          ;(e.currentTarget as HTMLElement).setPointerCapture(s.pointerId)
          setIsDragging(true)
        }
      }
    }
    if (s.locked === 'h') {
      const atLeftEdge = currentPage === 1 && dx > 0
      const atRightEdge = currentPage === totalPages && dx < 0
      setDragDelta(atLeftEdge || atRightEdge ? dx * 0.3 : dx)
    }
  }
  const onPointerUp = () => {
    const s = dragStateRef.current
    if (!s) return
    if (s.locked === 'h') {
      const w = viewportRef.current?.clientWidth ?? 0
      const threshold = w * SWIPE_THRESHOLD_FRAC
      if (dragDelta < -threshold) goToPage(currentPage + 1)
      else if (dragDelta > threshold) goToPage(currentPage - 1)
      setDragDelta(0)
      setIsDragging(false)
    }
    dragStateRef.current = null
  }

  // Layout-aware grid class
  const gridColsClass = layout === 'list' ? 'grid-cols-1' : 'md:grid-cols-2 lg:grid-cols-3'

  // Render helpers
  const renderVoiceCard = (v: Voice) => {
    const isFav = favorites.has(v.voice_id)
    const isPlaying = previewingId === v.voice_id
    const assignedTo = assignFeedback[v.voice_id]
    const isHero = layout === 'list'
    return (
      <div key={v.voice_id}
        draggable={false}
        className={`bg-[#08131D]/90 border border-amber-500/20 rounded-2xl flex flex-col hover:border-amber-400/40 transition-all duration-200 ${
          isHero ? 'group p-6 gap-5 h-full overflow-hidden cursor-default' : 'p-3 gap-2'
        }`}>
        <div className={`flex items-start justify-between gap-3 ${isHero ? 'shrink-0' : ''}`}>
          <div className="flex-1 min-w-0">
            <div
              className={`font-semibold text-amber-300 ${isHero ? 'text-2xl sm:text-3xl cursor-grab active:cursor-grabbing select-none inline-block' : 'text-sm'}`}
              title={isHero ? `${v.name} — drag onto a segment` : v.name}
              draggable={isHero ? true : false}
              onPointerDown={isHero ? (e) => e.stopPropagation() : undefined}
              onDragStart={isHero ? (e) => {
                e.dataTransfer.effectAllowed = 'copy'
                e.dataTransfer.setData('application/x-voice-payload', JSON.stringify({ voice_id: v.voice_id, name: v.name }))
                e.dataTransfer.setData('text/plain', v.voice_id)
                const ghost = document.createElement('div')
                ghost.textContent = `${v.name} ▸`
                ghost.style.cssText = [
                  'position:absolute', 'top:-1000px', 'left:-1000px',
                  'padding:8px 12px',
                  'background:rgba(251,191,36,0.95)',
                  'color:#111827',
                  'border:1px solid rgba(245,158,11,0.95)',
                  'border-radius:8px',
                  'font:700 13px system-ui,sans-serif',
                  'box-shadow:0 6px 18px rgba(0,0,0,0.35)',
                  'pointer-events:none', 'z-index:9999',
                ].join(';')
                document.body.appendChild(ghost)
                e.dataTransfer.setDragImage(ghost, 0, 0)
                setTimeout(() => ghost.remove(), 0)
                console.log('[VOICE-DRAG] dragstart', { voice_id: v.voice_id, name: v.name })
              } : undefined}
            >
              {v.name}
            </div>
            <div className={`text-slate-500 flex flex-wrap items-center gap-2 ${isHero ? 'text-xs mt-2' : 'text-[10px]'}`}>
              {v.labels?.gender && <span>{v.labels.gender}</span>}
              {typeof v.task_count === 'number' && v.task_count > 0 && (
                <span>· {v.task_count.toLocaleString()} uses</span>
              )}
            </div>
          </div>
          <button type="button"
            title={isFav ? 'Remove from favorites' : 'Add to favorites'}
            aria-label="Toggle favorite"
            onClick={() => toggleFavorite(v.voice_id)}
            className={`shrink-0 ${isFav ? 'text-amber-400' : 'text-slate-600 hover:text-amber-400'} transition-colors`}>
            <Star className={`${isHero ? 'h-6 w-6' : 'h-4 w-4'} ${isFav ? 'fill-current' : ''}`} />
          </button>
        </div>
        {v.tags && v.tags.length > 0 && (
          <div className={`flex flex-wrap gap-1 ${isHero ? 'shrink-0' : ''}`}>
            {(isHero ? v.tags : v.tags.slice(0, 5)).map(t => (
              <span key={t} className={`rounded bg-slate-800 text-slate-400 border border-slate-700 ${
                isHero ? 'text-[10px] px-2 py-0.5' : 'text-[9px] px-1.5 py-0.5'
              }`}>
                {t}
              </span>
            ))}
          </div>
        )}
        {v.description && (
          isHero ? (
            <div
              className="
                flex-1 min-h-0 overflow-y-auto pr-1
                [scrollbar-width:thin]
                [scrollbar-color:transparent_transparent]
                group-hover:[scrollbar-color:#64748b_transparent]
                [&::-webkit-scrollbar]:w-1.5
                [&::-webkit-scrollbar-track]:bg-transparent
                [&::-webkit-scrollbar-thumb]:bg-transparent
                [&::-webkit-scrollbar-thumb]:rounded-full
                [&::-webkit-scrollbar-thumb]:transition-colors
                [&::-webkit-scrollbar-thumb]:duration-200
                group-hover:[&::-webkit-scrollbar-thumb]:bg-slate-500/60
              "
            >
              <p className="text-sm text-slate-300 leading-relaxed">{v.description}</p>
            </div>
          ) : (
            <p className="text-[11px] text-slate-400 line-clamp-2">{v.description}</p>
          )
        )}
        <div className={`flex items-center gap-3 ${isHero ? 'shrink-0 mt-auto' : 'mt-4'}`}>
          <Button size="sm" variant="outline"
            onClick={() => handlePreview(v.voice_id, v.preview_url)}
            className={`border border-amber-500/30 text-amber-200 bg-slate-950/60 hover:bg-amber-500/10 flex-1 ${
              isHero ? 'h-12 text-sm' : 'h-8 text-xs'
            } ${isPlaying ? 'ring-2 ring-amber-400/80 animate-pulse' : ''}`}>
            <Play className={`h-3.5 w-3.5 mr-2 ${isPlaying ? 'text-amber-300' : ''}`} />
            {isPlaying ? 'Playing…' : 'Preview'}
          </Button>
          {isJobAware && (
            assignedTo ? (
              <span className="text-[10px] text-emerald-400 font-medium flex items-center gap-1 px-2">
                <Check className="h-3 w-3" /> {assignedTo}
              </span>
            ) : (
              <select aria-label="Assign to speaker" defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    handleAssign(v.voice_id, e.target.value)
                    e.target.value = ''
                  }
                }}
                className={`rounded bg-emerald-600/20 border border-emerald-600/40 text-emerald-300 hover:bg-emerald-600/30 cursor-pointer shrink-0 ${
                  isHero ? 'h-10 text-xs px-3 min-w-[130px]' : 'h-8 text-[11px] px-2 min-w-[110px]'
                }`}>
                <option value="" style={{ backgroundColor: '#0F172A', color: '#F1F5F9' }}>
                  Assign to…
                </option>
                {speakers.map(sp => (
                  <option key={sp.speaker_id} value={sp.speaker_id}
                    style={{ backgroundColor: '#0F172A', color: '#F1F5F9' }}>
                    {sp.display_name}
                  </option>
                ))}
              </select>
            )
          )}
        </div>
      </div>
    )
  }

  const renderPageContent = (pageNum: number) => {
    if (pageError[pageNum]) {
      return (
        <div className="flex flex-col items-center justify-center h-32 gap-2 text-red-400 text-xs">
          <span>{pageError[pageNum]}</span>
          <Button size="sm" variant="outline" onClick={() => fetchPage(pageNum)} className="h-7 text-xs">
            Retry
          </Button>
        </div>
      )
    }
    const voices = pageCache[pageNum]
    if (voices === undefined) {
      return (
        <div className="flex items-center justify-center h-32 text-slate-400 gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading page {pageNum}…
        </div>
      )
    }
    if (voices.length === 0) {
      return (
        <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
          No voices match your filters.
        </div>
      )
    }
    // Surface the user's custom voices at the very top of page 1.
    const pageVoices = pageNum === 1 && customVoices.length > 0 ? [...customVoices, ...voices] : voices

    // Panel layout: master list on the left, detail on the right. The hero card
    // it replaced was sized for the modal (p-6, text-3xl, one voice per page),
    // so in a short panel a single card filled the column and the description
    // fell below the fold — you had to collapse the timeline to read it. Here
    // the description gets its own pane and never displaces anything.
    if (layout === 'list') {
      const selected = pageVoices.find(v => v.voice_id === selectedVoiceId) ?? pageVoices[0]
      return (
        <div className="flex h-full min-h-0 gap-3">
          {/* Master: names + preview */}
          <div className="w-[45%] min-w-0 overflow-y-auto pr-1 space-y-1">
            {pageVoices.map(v => {
              const isSel = selected?.voice_id === v.voice_id
              const assigned = voiceAssignments[v.voice_id] || []
              return (
                <button
                  key={v.voice_id}
                  onClick={() => setSelectedVoiceId(v.voice_id)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors ${
                    isSel
                      ? 'bg-amber-500/10 border-amber-400/50'
                      : 'bg-[#08131D]/60 border-transparent hover:border-amber-500/25'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Preview ${v.name}`}
                      onClick={(e) => { e.stopPropagation(); handlePreview(v.voice_id, v.preview_url) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); handlePreview(v.voice_id, v.preview_url) } }}
                      className="shrink-0 text-amber-300 hover:text-amber-200"
                    >
                      {previewingId === v.voice_id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Play className="h-3.5 w-3.5" />}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-sm text-slate-200">{v.name}</span>
                    {favorites.has(v.voice_id) && (
                      <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
                    )}
                  </div>
                  {assigned.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {assigned.map(s => (
                        <span key={s} className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {/* Detail: description + assignment */}
          <div className="flex-1 min-w-0 overflow-y-auto rounded-xl border border-amber-500/20 bg-[#08131D]/90 p-4">
            {selected ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-lg font-semibold text-amber-300 leading-tight">{selected.name}</h3>
                  <button
                    onClick={() => toggleFavorite(selected.voice_id)}
                    aria-label="Toggle favourite"
                    className="shrink-0 text-slate-400 hover:text-amber-300"
                  >
                    <Star className={`h-4 w-4 ${favorites.has(selected.voice_id) ? 'fill-amber-400 text-amber-400' : ''}`} />
                  </button>
                </div>

                <p className="text-xs text-slate-400">
                  {[selected.labels?.gender, selected.task_count ? `${selected.task_count.toLocaleString()} uses` : null]
                    .filter(Boolean).join(' · ')}
                </p>

                {(voiceAssignments[selected.voice_id] || []).length > 0 && (
                  <p className="text-xs text-emerald-300">
                    Assigned to {(voiceAssignments[selected.voice_id] || []).join(', ')}
                  </p>
                )}

                {selected.tags && selected.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selected.tags.map(t => (
                      <span key={t} className="rounded bg-slate-700/50 px-1.5 py-0.5 text-[10px] text-slate-300">{t}</span>
                    ))}
                  </div>
                )}

                {selected.description && (
                  <p className="text-sm text-slate-300 leading-relaxed">{selected.description}</p>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs"
                    onClick={() => handlePreview(selected.voice_id, selected.preview_url)}>
                    <Play className="h-3.5 w-3.5" />
                    {previewingId === selected.voice_id ? 'Playing…' : 'Preview'}
                  </Button>
                  {isJobAware && (
                    <select
                      aria-label="Assign to speaker"
                      value=""
                      onChange={(e) => { if (e.target.value) handleAssign(selected.voice_id, e.target.value) }}
                      className="h-8 flex-1 min-w-0 rounded-md border border-amber-500/30 bg-[#0F172A] px-2 text-xs text-slate-200"
                    >
                      <option value="" style={{ backgroundColor: '#0F172A', color: '#F1F5F9' }}>Assign to…</option>
                      {speakers.map(s => (
                        <option key={s.speaker_id} value={s.speaker_id}
                          style={{ backgroundColor: '#0F172A', color: '#F1F5F9' }}>
                          {s.display_name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {assignFeedback[selected.voice_id] && (
                  <p className="text-xs text-emerald-400">Assigned to {assignFeedback[selected.voice_id]}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Select a voice to see its details.</p>
            )}
          </div>
        </div>
      )
    }

    return (
      <div className={`grid ${gapClass} ${gridColsClass}`}>
        {pageVoices.map(renderVoiceCard)}
      </div>
    )
  }

  // Favorites-only: pull matching voices from whatever's in cache
  const favoritesView = useMemo(() => {
    if (!showOnlyFavorites) return null
    const all = Object.values(pageCache).flat()
    const seen = new Set<string>()
    const out: Voice[] = []
    for (const v of all) {
      if (seen.has(v.voice_id)) continue
      if (!favorites.has(v.voice_id)) continue
      seen.add(v.voice_id)
      out.push(v)
    }
    return out
  }, [showOnlyFavorites, pageCache, favorites])

  return (
    <div className="flex flex-col h-full min-h-0 gap-3 overflow-hidden">
      {/* Speakers strip — modal (grid) layout only */}
      {layout === 'grid' && isJobAware && speakers.length > 0 && (
        <div className="rounded-lg bg-slate-900/60 border border-slate-700 p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[11px] text-slate-400 shrink-0 whitespace-nowrap font-medium">
              Speakers in this project:
            </span>
            {speakers.map(sp => {
              const voiceName = sp.current_voice_id
                ? (Object.values(pageCache).flat().find(v => v.voice_id === sp.current_voice_id)?.name
                    ?? '(voice set)')
                : null
              return (
                <span key={sp.speaker_id}
                  title={sp.current_voice_id ? `Voice ID: ${sp.current_voice_id}` : 'No voice assigned yet'}
                  className={`text-[11px] px-2.5 py-1 rounded-full border whitespace-nowrap ${
                    sp.current_voice_id
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                      : 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                  }`}>
                  <span className="font-medium">{sp.display_name}</span>
                  <span className="opacity-70 mx-1">›</span>
                  <span>{voiceName ?? '(no voice yet)'}</span>
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Filter bar — differs by layout */}
      {layout === 'grid' ? (
        /* Modal (grid) layout: full filter row */
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name…" aria-label="Search voices by name"
              className="pl-8 h-8 text-xs bg-slate-900 border-slate-700" />
          </div>
          <select value={gender} onChange={(e) => setGender(e.target.value)}
            aria-label="Filter by gender"
            className="h-8 px-2 text-xs rounded bg-slate-900 border border-slate-700 text-slate-200">
            <option value="">All genders</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="child">Child</option>
          </select>
          <select value={tag} onChange={(e) => setTag(e.target.value)}
            aria-label="Filter by tag"
            className="h-8 px-2 text-xs rounded bg-slate-900 border border-slate-700 text-slate-200">
            <option value="">All tags</option>
            {['calm','expressive','dramatic','warm','cinematic','natural','narration','character-voice','energetic','authoritative','intense','smooth'].map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}
            aria-label="Filter by language"
            className="h-8 px-2 text-xs rounded bg-slate-900 border border-slate-700 text-slate-200">
            <option value="">All languages</option>
            <option value="en">English</option>
            <option value="zh">Chinese</option>
            <option value="ja">Japanese</option>
            <option value="ko">Korean</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
            aria-label="Sort order"
            className="h-8 px-2 text-xs rounded bg-slate-900 border border-slate-700 text-slate-200">
            <option value="task_count">Most used</option>
            <option value="like_count">Most liked</option>
            <option value="created_at">Newest</option>
          </select>
          <Button size="sm" variant={showOnlyFavorites ? 'default' : 'outline'}
            onClick={() => setShowOnlyFavorites(p => !p)}
            className={`h-8 text-xs ${showOnlyFavorites ? 'bg-amber-500 hover:bg-amber-600 text-black' : 'border-slate-700 text-slate-300'}`}>
            <Star className={`h-3.5 w-3.5 mr-1 ${showOnlyFavorites ? 'fill-current' : ''}`} />
            Favorites ({favorites.size})
          </Button>
        </div>
      ) : (
        /* Panel (list) layout: search + gender context menu + active filter chip + favorites */
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[180px]" onContextMenu={(e) => {
            e.preventDefault()
            setContextMenu({ x: e.clientX, y: e.clientY })
          }}>
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
            <Input ref={searchInputRef} value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name… (right-click for gender)" aria-label="Search voices by name"
              className="pl-8 h-8 text-xs bg-slate-900 border-slate-700" />
          </div>
          {gender && (
            <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-purple-600/20 border border-purple-600/40 text-purple-300">
              {gender.charAt(0).toUpperCase() + gender.slice(1)}
              <button type="button" onClick={() => setGender('')} aria-label="Clear gender filter" className="hover:text-purple-100">
                ✕
              </button>
            </span>
          )}
          <Button size="sm" variant={showOnlyFavorites ? 'default' : 'outline'}
            onClick={() => setShowOnlyFavorites(p => !p)}
            className={`h-8 text-xs ${showOnlyFavorites ? 'bg-amber-500 hover:bg-amber-600 text-black' : 'border-slate-700 text-slate-300'}`}>
            <Star className={`h-3.5 w-3.5 mr-1 ${showOnlyFavorites ? 'fill-current' : ''}`} />
            Favorites ({favorites.size})
          </Button>
          {/* Gender context menu */}
          {contextMenu && (
            <div className="fixed z-50 bg-slate-800 border border-slate-700 rounded-md shadow-lg overflow-hidden"
              style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
              onMouseLeave={() => setContextMenu(null)}>
              {['All voices', 'Male', 'Female', 'Children'].map(label => (
                <button key={label} type="button"
                  onClick={() => {
                    setGender(label === 'All voices' ? '' : label.toLowerCase())
                    setContextMenu(null)
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-700 whitespace-nowrap">
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Carousel viewport */}
      {showOnlyFavorites ? (
        <div className="flex-1 overflow-y-auto pr-1">
          {favoritesView && favoritesView.length > 0 ? (
            <div className={`grid ${gapClass} ${gridColsClass}`}>
              {favoritesView.map(renderVoiceCard)}
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
              No favorites yet — star a voice to add it here.
            </div>
          )}
        </div>
      ) : (
        <>
          <div
            ref={viewportRef}
            className="flex-1 overflow-hidden relative group"
            style={{ touchAction: 'pan-y' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={handleWheel}
          >
            {/* Side-edge arrows (panel layout) — appear only on hover over the viewport */}
            {layout === 'list' && currentPage > 1 && (
              <button
                type="button"
                onClick={() => goToPage(currentPage - 1)}
                aria-label="Previous page"
                title="Previous page"
                className="absolute left-1 top-1/2 -translate-y-1/2 z-10 w-8 h-12 flex items-center justify-center rounded-md bg-slate-900/40 text-slate-500 hover:bg-slate-900/75 hover:text-slate-200 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-150"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}
            {layout === 'list' && currentPage < totalPages && (
              <button
                type="button"
                onClick={() => goToPage(currentPage + 1)}
                aria-label="Next page"
                title="Next page"
                className="absolute right-1 top-1/2 -translate-y-1/2 z-10 w-8 h-12 flex items-center justify-center rounded-md bg-slate-900/40 text-slate-500 hover:bg-slate-900/75 hover:text-slate-200 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-150"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            )}
            <div
              className="flex h-full"
              style={{
                width: `${totalPages * 100}%`,
                transform: `translateX(calc(${-(currentPage - 1) * (100 / totalPages)}% + ${dragDelta}px))`,
                transition: isDragging ? 'none' : 'transform 300ms ease-out',
                cursor: 'default',
              }}
            >
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => (
                <div key={pageNum}
                  data-carousel-page
                  className="overflow-hidden pr-1 h-full"
                  style={{ width: `${100 / totalPages}%`, flexShrink: 0 }}>
                  {renderPageContent(pageNum)}
                </div>
              ))}
            </div>
          </div>

          {/* Page indicator — dots for grid (modal), arrows + jump-to for list (panel) */}
          <div className="flex flex-col items-center gap-1 border-t border-slate-800 pt-2">
            {layout === 'list' ? (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400 tabular-nums">
                  Page <span className="text-slate-100 font-medium">{currentPage}</span>
                  <span className="text-slate-600"> of </span>
                  <span className="text-slate-200">{totalPages}</span>
                </span>
                {totalPages > 1 && (
                  <>
                    <span className="text-slate-700 mx-1">|</span>
                    <span className="text-[11px] text-slate-500">Jump to:</span>
                    <Input
                      type="number"
                      min={1}
                      max={totalPages}
                      value={jumpInput}
                      onChange={(e) => setJumpInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const n = parseInt(jumpInput, 10)
                          if (!isNaN(n)) goToPage(n)
                          setJumpInput('')
                        }
                      }}
                      placeholder="#"
                      aria-label="Jump to page"
                      className="h-7 w-14 text-[11px] bg-slate-900 border-slate-700 px-2 text-center tabular-nums"
                    />
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center gap-3">
                <span className="text-[11px] text-slate-500">
                  Page {currentPage} of {totalPages}
                </span>
                {totalPages > 1 && (
                  <div className="flex gap-1.5">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => (
                      <button
                        key={pageNum}
                        type="button"
                        onClick={() => goToPage(pageNum)}
                        aria-label={`Go to page ${pageNum}`}
                        title={`Page ${pageNum}`}
                        className={`h-2 w-6 rounded-full transition-colors ${
                          pageNum === currentPage ? 'bg-amber-400' : 'bg-slate-600 hover:bg-slate-400'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
            {layout === 'grid' && totalFromServer !== null && totalFromServer > totalPages * PAGE_SIZE && (
              <span className="text-[10px] text-slate-600">
                Showing top {(totalPages * PAGE_SIZE).toLocaleString()} of {totalFromServer.toLocaleString()} —
                narrow with filters to see more
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Modal wrapper — kept for the global header (dashboard / projects / collaborate / profile / account),
 * which opens it in browse-only mode when no job is in the URL.
 */
interface VoiceLibraryModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function VoiceLibraryModal({ open, onOpenChange }: VoiceLibraryModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] bg-[#020817]/95 backdrop-blur-md border-[#A855F7]/30 flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Mic2 className="h-5 w-5 text-[#A855F7]" />
            Voice Library
            <span className="text-xs text-slate-400 ml-2">— browse only (open a project to assign)</span>
          </DialogTitle>
          <DialogDescription className="text-[#94A3B8]">
            Browse Fish Audio&apos;s catalog. Swipe between pages, preview any voice.
            Star favorites to find them quickly later.
          </DialogDescription>
        </DialogHeader>
        <VoiceLibraryContent layout="grid" />
      </DialogContent>
    </Dialog>
  )
}

/**
 * Right-panel tab wrapper — narrow, single-column. Used inside the editor's
 * right rail as a sibling to the Speakers tab.
 */
export function VoiceLibraryPanel({ onVoiceAssigned, customVoicesVersion }: { onVoiceAssigned?: (speakerId: string, voiceId: string) => void; customVoicesVersion?: number } = {}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col p-3">
      <VoiceLibraryContent layout="list" onVoiceAssigned={onVoiceAssigned} customVoicesVersion={customVoicesVersion} />
    </div>
  )
}
