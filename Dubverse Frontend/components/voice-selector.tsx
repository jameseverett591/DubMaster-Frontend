"use client"

import { useState, useRef } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { User, Baby, Play, Volume2, Square, Loader2 } from "lucide-react"
import type { DetectedVoice } from "@/components/dashboard"

interface VoiceSelectorProps {
  detectedVoices: DetectedVoice[]
  targetLanguage: string
  onVoiceChange: (voiceId: string, newVoice: string) => void
  isAnalyzing: boolean
}

const VOICE_OPTIONS = {
  male: [
    { id: "male-1", name: "Marcus", description: "Deep, authoritative", age: "Adult" },
    { id: "male-2", name: "David", description: "Warm, friendly", age: "Adult" },
    { id: "male-3", name: "James", description: "Professional, clear", age: "Adult" },
    { id: "male-4", name: "Carlos", description: "Energetic, youthful", age: "Young Adult" },
  ],
  female: [
    { id: "female-1", name: "Sarah", description: "Warm, conversational", age: "Adult" },
    { id: "female-2", name: "Emma", description: "Professional, confident", age: "Adult" },
    { id: "female-3", name: "Sofia", description: "Soft, soothing", age: "Adult" },
    { id: "female-4", name: "Luna", description: "Energetic, bright", age: "Young Adult" },
  ],
  child: [
    { id: "child-1", name: "Tommy", description: "Playful boy", age: "8-12" },
    { id: "child-2", name: "Lily", description: "Sweet girl", age: "8-12" },
    { id: "child-3", name: "Max", description: "Energetic boy", age: "6-10" },
    { id: "child-4", name: "Mia", description: "Curious girl", age: "6-10" },
  ],
}

const SAMPLE_TEXTS = {
  male: "Hello, I'm a male voice. I can help dub your videos with a natural, professional tone.",
  female: "Hi there! I'm a female voice. My warm and friendly tone is perfect for your content.",
  child: "Hey! I'm a kid's voice. I sound fun and playful for your videos!",
}

export function VoiceSelector({ detectedVoices, targetLanguage, onVoiceChange, isAnalyzing }: VoiceSelectorProps) {
  const [expandedVoice, setExpandedVoice] = useState<string | null>(null)
  const [voiceSettings, setVoiceSettings] = useState<Record<string, { pitch: number; speed: number }>>({})
  const [playingVoice, setPlayingVoice] = useState<string | null>(null)
  const [isLoadingSample, setIsLoadingSample] = useState<string | null>(null)
  const speechSynthRef = useRef<SpeechSynthesisUtterance | null>(null)

  const getVoiceIcon = (type: DetectedVoice["type"]) => {
    switch (type) {
      case "male":
        return <User className="h-4 w-4 text-blue-500" />
      case "female":
        return <User className="h-4 w-4 text-pink-500" />
      case "child":
        return <Baby className="h-4 w-4 text-green-500" />
    }
  }

  const getVoiceBadgeColor = (type: DetectedVoice["type"]) => {
    switch (type) {
      case "male":
        return "bg-blue-500/10 text-blue-500 border-blue-500/20"
      case "female":
        return "bg-pink-500/10 text-pink-500 border-pink-500/20"
      case "child":
        return "bg-green-500/10 text-green-500 border-green-500/20"
    }
  }

  const handleSettingChange = (voiceId: string, setting: "pitch" | "speed", value: number) => {
    setVoiceSettings((prev) => ({
      ...prev,
      [voiceId]: {
        ...prev[voiceId],
        [setting]: value,
      },
    }))
  }

  const playVoiceSample = (voice: DetectedVoice, isPreview = false) => {
    // Stop any currently playing audio
    if (speechSynthRef.current) {
      window.speechSynthesis.cancel()
    }

    if (playingVoice === voice.id) {
      setPlayingVoice(null)
      return
    }

    setIsLoadingSample(voice.id)

    const utterance = new SpeechSynthesisUtterance(
      isPreview
        ? `This is how ${voice.characterName.split(" ")[0]} will sound in your dubbed video.`
        : SAMPLE_TEXTS[voice.type],
    )

    // Get available voices and try to match gender
    const voices = window.speechSynthesis.getVoices()
    const settings = voiceSettings[voice.id] || { pitch: 50, speed: 50 }

    // Find a voice that matches the type
    const selectedSynthVoice = voices.find((v) => {
      if (voice.type === "female")
        return (
          v.name.toLowerCase().includes("female") ||
          v.name.toLowerCase().includes("samantha") ||
          v.name.toLowerCase().includes("victoria")
        )
      if (voice.type === "child") return v.name.toLowerCase().includes("junior") || v.name.toLowerCase().includes("kid")
      return (
        v.name.toLowerCase().includes("male") ||
        v.name.toLowerCase().includes("daniel") ||
        v.name.toLowerCase().includes("alex")
      )
    })

    if (selectedSynthVoice) {
      utterance.voice = selectedSynthVoice
    }

    // Apply pitch and speed settings (converted from 0-100 to appropriate ranges)
    utterance.pitch = 0.5 + (settings.pitch / 100) * 1.5 // Range: 0.5 - 2
    utterance.rate = 0.5 + (settings.speed / 100) * 1.5 // Range: 0.5 - 2

    // Adjust for child voice
    if (voice.type === "child") {
      utterance.pitch = Math.min(utterance.pitch * 1.3, 2)
      utterance.rate = utterance.rate * 1.1
    }

    utterance.onstart = () => {
      setIsLoadingSample(null)
      setPlayingVoice(voice.id)
    }

    utterance.onend = () => {
      setPlayingVoice(null)
    }

    utterance.onerror = () => {
      setIsLoadingSample(null)
      setPlayingVoice(null)
    }

    speechSynthRef.current = utterance
    window.speechSynthesis.speak(utterance)
  }

  const stopSample = () => {
    window.speechSynthesis.cancel()
    setPlayingVoice(null)
    setIsLoadingSample(null)
  }

  if (isAnalyzing) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-muted/50 p-6 text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-pulse rounded-full bg-primary/20" />
          <p className="font-medium text-foreground">Analyzing Voices</p>
          <p className="mt-1 text-sm text-muted-foreground">
            AI is detecting and classifying speakers in your video...
          </p>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse rounded-lg border border-border p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-muted" />
              <div className="flex-1">
                <div className="h-4 w-24 rounded bg-muted" />
                <div className="mt-2 h-3 w-32 rounded bg-muted" />
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-foreground">Detected Speakers</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {detectedVoices.length} voices detected. Select replacement voices for each speaker.
        </p>
      </div>

      <div className="flex gap-2">
        <Badge variant="outline" className="gap-1.5 border-blue-500/20 bg-blue-500/10 text-blue-500">
          <User className="h-3 w-3" />
          {detectedVoices.filter((v) => v.type === "male").length} Male
        </Badge>
        <Badge variant="outline" className="gap-1.5 border-pink-500/20 bg-pink-500/10 text-pink-500">
          <User className="h-3 w-3" />
          {detectedVoices.filter((v) => v.type === "female").length} Female
        </Badge>
        <Badge variant="outline" className="gap-1.5 border-green-500/20 bg-green-500/10 text-green-500">
          <Baby className="h-3 w-3" />
          {detectedVoices.filter((v) => v.type === "child").length} Child
        </Badge>
      </div>

      <div className="space-y-3">
        {detectedVoices.map((voice) => (
          <Card
            key={voice.id}
            className={`cursor-pointer transition-all ${expandedVoice === voice.id ? "ring-2 ring-primary" : ""}`}
          >
            <CardHeader
              className="p-4 pb-2"
              onClick={() => setExpandedVoice(expandedVoice === voice.id ? null : voice.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full ${
                      voice.type === "male"
                        ? "bg-blue-500/10"
                        : voice.type === "female"
                          ? "bg-pink-500/10"
                          : "bg-green-500/10"
                    }`}
                  >
                    {getVoiceIcon(voice.type)}
                  </div>
                  <div>
                    <CardTitle className="text-sm">{voice.characterName}</CardTitle>
                    <CardDescription className="text-xs">
                      {voice.timeRanges.length} segments •{" "}
                      {voice.timeRanges.reduce((acc, r) => acc + (r.end - r.start), 0).toFixed(0)}s total
                    </CardDescription>
                  </div>
                </div>
                <Badge variant="outline" className={getVoiceBadgeColor(voice.type)}>
                  {voice.type}
                </Badge>
              </div>
            </CardHeader>

            {expandedVoice === voice.id && (
              <CardContent className="space-y-4 p-4 pt-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Replacement Voice</Label>
                  <Select value={voice.selectedVoice} onValueChange={(value) => onVoiceChange(voice.id, value)}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue placeholder="Select a voice" />
                    </SelectTrigger>
                    <SelectContent>
                      {VOICE_OPTIONS[voice.type].map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{option.name}</span>
                            <span className="text-muted-foreground">- {option.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5 bg-transparent"
                    onClick={(e) => {
                      e.stopPropagation()
                      playVoiceSample(voice, true)
                    }}
                    disabled={isLoadingSample === voice.id}
                  >
                    {isLoadingSample === voice.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : playingVoice === voice.id ? (
                      <Square className="h-3 w-3" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                    {playingVoice === voice.id ? "Stop" : "Preview"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5 bg-transparent"
                    onClick={(e) => {
                      e.stopPropagation()
                      playVoiceSample(voice, false)
                    }}
                    disabled={isLoadingSample === voice.id}
                  >
                    {isLoadingSample === voice.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Volume2 className="h-3 w-3" />
                    )}
                    Sample
                  </Button>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">Pitch</Label>
                      <span className="text-xs text-muted-foreground">{voiceSettings[voice.id]?.pitch ?? 50}%</span>
                    </div>
                    <Slider
                      value={[voiceSettings[voice.id]?.pitch ?? 50]}
                      max={100}
                      step={1}
                      onValueChange={([value]) => handleSettingChange(voice.id, "pitch", value)}
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">Speed</Label>
                      <span className="text-xs text-muted-foreground">{voiceSettings[voice.id]?.speed ?? 50}%</span>
                    </div>
                    <Slider
                      value={[voiceSettings[voice.id]?.speed ?? 50]}
                      max={100}
                      step={1}
                      onValueChange={([value]) => handleSettingChange(voice.id, "speed", value)}
                      className="mt-2"
                    />
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
