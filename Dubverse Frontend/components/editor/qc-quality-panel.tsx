'use client'

import { Clock, Gauge, VolumeX, Volume2, Heart, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { QCReport, QCFinding } from '@/lib/editor-types'

interface QCQualityPanelProps {
  report: QCReport
  onJumpToTime?: (seconds: number) => void
  onSelectFinding?: (finding: QCFinding) => void
  onSelectSegment?: (segmentIndex: number) => void
  selectedRetranscriptionIndex?: number
}

function formatTimeShort(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function gradeColor(grade: QCReport['grade']) {
  switch (grade) {
    case 'A':
      return 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
    case 'B':
      return 'border-lime-500 text-lime-400 bg-lime-500/10'
    case 'C':
      return 'border-yellow-500 text-yellow-400 bg-yellow-500/10'
    case 'D':
      return 'border-orange-500 text-orange-400 bg-orange-500/10'
    case 'F':
    default:
      return 'border-red-500 text-red-400 bg-red-500/10'
  }
}

function pillColor(score: number) {
  if (score >= 80) return 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'
  if (score >= 60) return 'border-yellow-500/40 text-yellow-300 bg-yellow-500/10'
  if (score >= 40) return 'border-orange-500/40 text-orange-300 bg-orange-500/10'
  return 'border-red-500/40 text-red-300 bg-red-500/10'
}

function statusBadge(status: 'ok' | 'warn' | 'fail') {
  if (status === 'ok')
    return <span className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/40 text-emerald-300 bg-emerald-500/10">OK</span>
  if (status === 'warn')
    return <span className="text-[10px] px-2 py-0.5 rounded-full border border-yellow-500/40 text-yellow-300 bg-yellow-500/10">Warn</span>
  return <span className="text-[10px] px-2 py-0.5 rounded-full border border-red-500/40 text-red-300 bg-red-500/10">Fail</span>
}

export function QCQualityPanel({ report, onJumpToTime, onSelectFinding, onSelectSegment, selectedRetranscriptionIndex }: QCQualityPanelProps) {
  const componentEntries: { key: keyof QCReport['components']; label: string }[] = [
    { key: 'timing', label: 'timing' },
    { key: 'speed', label: 'speed' },
    { key: 'loudness', label: 'loudness' },
    { key: 'silences', label: 'silences' },
    { key: 'emotion_variance', label: 'emotion_variance' },
    { key: 'emotion_intensity', label: 'emotion_intensity' },
    { key: 'lip_sync', label: 'lip_sync' },
    { key: 'emotion_preservation', label: 'emotion_preservation' },
  ]

  return (
    <div className="flex flex-col gap-3 p-3 overflow-y-auto h-full bg-neutral-950 text-white">
      {/* Score header */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-white">Quality Score</div>
          {report.emotion_provider === 'hume' && (
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-purple-500/40 text-purple-300 bg-purple-500/10">
              ♥ Hume
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold border-2',
              gradeColor(report.grade)
            )}
          >
            {report.grade}
          </div>
          <div>
            <div className="text-3xl font-bold leading-none">{report.overall}</div>
            <div className="text-xs text-slate-500">/100</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-3">
          {componentEntries.map(({ key, label }) => (
            <span
              key={key}
              className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', pillColor(report.components[key]))}
            >
              {label}: {report.components[key]}
            </span>
          ))}
        </div>
      </div>

      {/* Timing */}
      <SectionCard icon={<Clock className="h-4 w-4" />} title="Timing" trailing={statusBadge(report.timing.status)} />

      {/* Speed */}
      <SectionCard
        icon={<Gauge className="h-4 w-4" />}
        title="Speed"
        trailing={statusBadge(report.speed.status)}
      >
        <div className="text-xs text-slate-400">
          Mean: {report.speed.mean}x | StdDev: {report.speed.std_dev}
        </div>
      </SectionCard>

      {/* Silence Gaps */}
      <SectionCard
        icon={<VolumeX className="h-4 w-4" />}
        title="Silence Gaps"
        trailing={
          <span
            className={cn(
              'text-[10px] px-2 py-0.5 rounded-full border',
              report.silence_gaps.unexpected_count > 0
                ? 'border-red-500/40 text-red-300 bg-red-500/10'
                : 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'
            )}
          >
            {report.silence_gaps.unexpected_count} unexpected
          </span>
        }
      >
        <div className="flex flex-col">
          {report.silence_gaps.gaps.map((g, i) => {
            const finding = report.findings.find(
              f => f.type === 'timing' && Math.abs(f.timestamp_start - g.start) < 1
            )
            return (
              <button
                key={i}
                onClick={() => {
                  onJumpToTime?.(g.start)
                  if (finding) onSelectFinding?.(finding)
                }}
                className="flex items-center justify-between py-1.5 text-xs hover:bg-neutral-800/50 rounded px-1 -mx-1 cursor-pointer text-left"
              >
                <span className="text-slate-300">
                  {formatTimeShort(g.start)} — {formatTimeShort(g.end)}
                </span>
                <span className="text-red-400 font-medium">{g.duration.toFixed(1)}s</span>
              </button>
            )
          })}
        </div>
      </SectionCard>

      {/* Loudness */}
      <SectionCard
        icon={<Volume2 className="h-4 w-4" />}
        title="Loudness"
        trailing={
          <span
            className={cn(
              'text-[10px] px-2 py-0.5 rounded-full border',
              report.loudness.within_spec
                ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'
                : 'border-yellow-500/40 text-yellow-300 bg-yellow-500/10'
            )}
          >
            {report.loudness.within_spec ? 'Within spec' : 'Out of spec'}
          </span>
        }
      >
        <div className="grid grid-cols-3 gap-2">
          <Stat label="LUFS" value={report.loudness.lufs.toFixed(2)} />
          <Stat label="Peak" value={`${report.loudness.peak_db.toFixed(2)} dB`} />
          <Stat label="Range" value={`${report.loudness.range_lu.toFixed(1)} LU`} />
        </div>
      </SectionCard>

      {/* Emotion Analysis */}
      <SectionCard
        icon={<Heart className="h-4 w-4 text-purple-400" />}
        title="Emotion Analysis"
        trailing={
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-yellow-500/40 text-yellow-300 bg-yellow-500/10">
            {report.emotion.label}
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-2 mb-3">
          <Stat label="Variance" value={String(report.emotion.variance)} accent="text-orange-400" />
          <Stat label="Intensity" value={String(report.emotion.intensity)} accent="text-orange-400" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {report.emotion.top.map((e) => (
            <span
              key={e.name}
              className="text-[10px] px-2 py-0.5 rounded-full border border-purple-500/40 text-purple-300 bg-purple-500/10"
            >
              {e.name}: {e.pct}%
            </span>
          ))}
        </div>
      </SectionCard>

      {/* Re-transcription */}
      <SectionCard
        icon={<FileText className="h-4 w-4" />}
        title={`Re-transcription (${report.retranscription.segment_count} segments)`}
        subtitle="What Whisper heard in the dubbed audio"
      >
        <div className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-1">
          {report.retranscription.items.map((it, i) => {
            const finding = report.findings.find(
              f => f.type === 'pronunciation' && Math.abs(f.timestamp_start - it.start) < 1
            )
            return (
              <button
                key={i}
                onClick={() => {
                  onJumpToTime?.(it.start)
                  onSelectSegment?.(i)
                  if (finding) onSelectFinding?.(finding)
                }}
                className={cn(
                  "flex items-start gap-3 py-1.5 px-2 -mx-2 text-xs rounded cursor-pointer text-left",
                  selectedRetranscriptionIndex === i ? "bg-amber-500/20 border border-amber-500/30" : "hover:bg-neutral-800/50"
                )}
              >
                <span className="text-slate-500 font-mono w-10 shrink-0">{formatTimeShort(it.start)}</span>
                <span className="flex-1 text-slate-300">{it.text}</span>
                <span
                  className={cn(
                    'font-medium shrink-0',
                    it.confidence >= 0.85
                      ? 'text-emerald-400'
                      : it.confidence >= 0.7
                        ? 'text-yellow-400'
                        : 'text-orange-400'
                  )}
                >
                  {Math.round(it.confidence * 100)}%
                </span>
              </button>
            )
          })}
        </div>
      </SectionCard>

      {/* QC Findings */}
      {report.findings.length > 0 && (
        <SectionCard
          icon={<Gauge className="h-4 w-4 text-amber-400" />}
          title={`QC Findings (${report.findings.length})`}
          subtitle="Click to jump to issue and apply correction"
        >
          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-1">
            {report.findings.map((finding, i) => (
              <button
                key={i}
                onClick={() => {
                  onJumpToTime?.(finding.timestamp_start)
                  onSelectFinding?.(finding)
                }}
                className="flex items-start gap-3 py-2 px-2 -mx-2 text-xs hover:bg-neutral-800/50 rounded cursor-pointer text-left border-l-2"
                style={{
                  borderColor: finding.severity === 'error' ? '#ef4444' : finding.severity === 'warning' ? '#eab308' : '#3b82f6'
                }}
              >
                <span className="text-slate-500 font-mono w-10 shrink-0">{formatTimeShort(finding.timestamp_start)}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded font-medium uppercase',
                      finding.severity === 'error' ? 'bg-red-500/20 text-red-400' : finding.severity === 'warning' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'
                    )}>
                      {finding.severity}
                    </span>
                    <span className="capitalize text-slate-300">{finding.type}</span>
                  </div>
                  <div className="text-slate-400">{finding.message}</div>
                </div>
              </button>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  )
}

interface SectionCardProps {
  icon: React.ReactNode
  title: string
  subtitle?: string
  trailing?: React.ReactNode
  children?: React.ReactNode
}

function SectionCard({ icon, title, subtitle, trailing, children }: SectionCardProps) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          {icon}
          <span>{title}</span>
        </div>
        {trailing}
      </div>
      {subtitle && <div className="text-[11px] text-slate-500 mb-2">{subtitle}</div>}
      {children}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
      <div className="text-[10px] text-slate-500 mb-0.5">{label}</div>
      <div className={cn('text-sm font-bold', accent ?? 'text-white')}>{value}</div>
    </div>
  )
}
