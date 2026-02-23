"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { User, Baby } from "lucide-react"
import type { DetectedVoice } from "@/components/dashboard"

interface TimelineEditorProps {
  detectedVoices: DetectedVoice[]
  currentTime: number
  duration: number
}

export function TimelineEditor({ detectedVoices, currentTime, duration }: TimelineEditorProps) {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const getVoiceColor = (type: DetectedVoice["type"]) => {
    switch (type) {
      case "male":
        return "bg-blue-500"
      case "female":
        return "bg-pink-500"
      case "child":
        return "bg-green-500"
    }
  }

  const getVoiceBorderColor = (type: DetectedVoice["type"]) => {
    switch (type) {
      case "male":
        return "border-blue-500/30"
      case "female":
        return "border-pink-500/30"
      case "child":
        return "border-green-500/30"
    }
  }

  const totalDuration = duration || 300

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-foreground">Voice Timeline</h3>
        <p className="mt-1 text-sm text-muted-foreground">Visual overview of detected speakers throughout the video</p>
      </div>

      {/* Timeline visualization */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Audio Waveform</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative h-24 rounded-lg bg-muted/50">
            {/* Current time indicator */}
            <div
              className="absolute top-0 z-10 h-full w-0.5 bg-primary"
              style={{ left: `${(currentTime / totalDuration) * 100}%` }}
            />

            {/* Voice segments */}
            {detectedVoices.map((voice, voiceIndex) => (
              <div key={voice.id} className="absolute" style={{ top: `${voiceIndex * 30 + 5}px`, height: "24px" }}>
                {voice.timeRanges.map((range, rangeIndex) => (
                  <div
                    key={rangeIndex}
                    className={`absolute rounded ${getVoiceColor(voice.type)} opacity-70`}
                    style={{
                      left: `${(range.start / totalDuration) * 100}%`,
                      width: `${((range.end - range.start) / totalDuration) * 100}%`,
                      height: "24px",
                    }}
                  />
                ))}
              </div>
            ))}

            {/* Time markers */}
            <div className="absolute bottom-1 left-0 right-0 flex justify-between px-2 text-xs text-muted-foreground">
              <span>0:00</span>
              <span>{formatTime(totalDuration / 4)}</span>
              <span>{formatTime(totalDuration / 2)}</span>
              <span>{formatTime((totalDuration * 3) / 4)}</span>
              <span>{formatTime(totalDuration)}</span>
            </div>
          </div>

          {/* Legend */}
          <div className="mt-3 flex gap-4">
            {detectedVoices.map((voice) => (
              <div key={voice.id} className="flex items-center gap-2">
                <div className={`h-3 w-3 rounded ${getVoiceColor(voice.type)}`} />
                <span className="text-xs text-muted-foreground">{voice.characterName}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Voice segment details */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-foreground">Segment Details</h4>
        {detectedVoices.map((voice) => (
          <Card key={voice.id} className={`border ${getVoiceBorderColor(voice.type)}`}>
            <CardHeader className="p-3 pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {voice.type === "child" ? (
                    <Baby className={`h-4 w-4 ${voice.type === "child" ? "text-green-500" : ""}`} />
                  ) : (
                    <User className={`h-4 w-4 ${voice.type === "male" ? "text-blue-500" : "text-pink-500"}`} />
                  )}
                  <CardTitle className="text-sm">{voice.characterName}</CardTitle>
                </div>
                <Badge variant="outline" className="text-xs">
                  {voice.timeRanges.length} segments
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <div className="flex flex-wrap gap-2">
                {voice.timeRanges.map((range, index) => {
                  const isCurrentSegment = currentTime >= range.start && currentTime < range.end
                  return (
                    <Badge key={index} variant={isCurrentSegment ? "default" : "outline"} className="text-xs">
                      {formatTime(range.start)} - {formatTime(range.end)}
                    </Badge>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
