export type SegmentStatus = "pending" | "approved" | "rejected"

export type SegmentLanguage = "cantonese" | "mandarin" | "english" | "mixed"

export interface WordAlignment {
  word: string
  start: number
  end: number
  confidence: number
}

export interface InlineSegment {
  id: string
  text: string
  original_text: string
  start: number
  end: number
  speaker_id: string
  language: SegmentLanguage
  confidence: number
  confidence_tier?: "high" | "medium" | "low"
  words: WordAlignment[]
  is_edited: boolean
  status: SegmentStatus
}

export interface InlineSpeaker {
  id: string
  name: string
  gender: "male" | "female" | "unknown"
  age_estimate?: number
  color: string
}
