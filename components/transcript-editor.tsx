"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Edit2, Check, X, Copy, RefreshCw } from "lucide-react"

interface TranscriptEditorProps {
  currentTime: number
  targetLanguage: string
}

type TranscriptLine = {
  id: string
  startTime: number
  endTime: number
  originalText: string
  translatedText: string
  speaker: string
  speakerType: "male" | "female" | "child"
}

const SAMPLE_TRANSCRIPT: TranscriptLine[] = [
  {
    id: "1",
    startTime: 0,
    endTime: 5,
    originalText: "Welcome to our presentation today.",
    translatedText: "Bienvenidos a nuestra presentación de hoy.",
    speaker: "Speaker 1",
    speakerType: "male",
  },
  {
    id: "2",
    startTime: 5,
    endTime: 12,
    originalText: "We're going to discuss the future of AI technology.",
    translatedText: "Vamos a discutir el futuro de la tecnología de IA.",
    speaker: "Speaker 1",
    speakerType: "male",
  },
  {
    id: "3",
    startTime: 12,
    endTime: 18,
    originalText: "That sounds exciting! Tell us more.",
    translatedText: "¡Eso suena emocionante! Cuéntanos más.",
    speaker: "Speaker 2",
    speakerType: "female",
  },
  {
    id: "4",
    startTime: 18,
    endTime: 28,
    originalText: "Of course. First, let me show you some examples.",
    translatedText: "Por supuesto. Primero, déjame mostrarte algunos ejemplos.",
    speaker: "Speaker 1",
    speakerType: "male",
  },
  {
    id: "5",
    startTime: 28,
    endTime: 35,
    originalText: "Can I ask a question about that?",
    translatedText: "¿Puedo hacer una pregunta sobre eso?",
    speaker: "Speaker 3",
    speakerType: "child",
  },
]

export function TranscriptEditor({ currentTime, targetLanguage }: TranscriptEditorProps) {
  const [transcript, setTranscript] = useState<TranscriptLine[]>(SAMPLE_TRANSCRIPT)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState("")

  const handleEdit = (line: TranscriptLine) => {
    setEditingId(line.id)
    setEditText(line.translatedText)
  }

  const handleSave = (id: string) => {
    setTranscript((prev) => prev.map((line) => (line.id === id ? { ...line, translatedText: editText } : line)))
    setEditingId(null)
    setEditText("")
  }

  const handleCancel = () => {
    setEditingId(null)
    setEditText("")
  }

  const isActive = (line: TranscriptLine) => {
    return currentTime >= line.startTime && currentTime < line.endTime
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const getSpeakerColor = (type: TranscriptLine["speakerType"]) => {
    switch (type) {
      case "male":
        return "bg-blue-500/10 text-blue-500 border-blue-500/20"
      case "female":
        return "bg-pink-500/10 text-pink-500 border-pink-500/20"
      case "child":
        return "bg-green-500/10 text-green-500 border-green-500/20"
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Translation Script</h3>
          <p className="text-sm text-muted-foreground">Edit translations for perfect alignment</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 bg-transparent">
          <RefreshCw className="h-3.5 w-3.5" />
          Re-translate
        </Button>
      </div>

      <div className="space-y-2">
        {transcript.map((line) => (
          <div
            key={line.id}
            className={`rounded-lg border p-3 transition-all ${
              isActive(line) ? "border-primary bg-primary/5" : "border-border bg-card"
            }`}
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={getSpeakerColor(line.speakerType)}>
                  {line.speaker}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {formatTime(line.startTime)} - {formatTime(line.endTime)}
                </span>
              </div>
              {editingId !== line.id && (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => navigator.clipboard.writeText(line.translatedText)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(line)}>
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>

            <p className="mb-2 text-xs text-muted-foreground">{line.originalText}</p>

            {editingId === line.id ? (
              <div className="space-y-2">
                <Textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="min-h-[60px] text-sm"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={handleCancel}>
                    <X className="mr-1 h-3.5 w-3.5" />
                    Cancel
                  </Button>
                  <Button size="sm" onClick={() => handleSave(line.id)}>
                    <Check className="mr-1 h-3.5 w-3.5" />
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-foreground">{line.translatedText}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
