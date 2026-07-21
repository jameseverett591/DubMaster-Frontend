# DubMaster — Editor Feature Reference

This is ground-truth reference material for the in-app "Ask AI Chat" help assistant.
Only answer using what's described here. If something isn't covered, say you're not
sure rather than guessing or inventing behavior.

## What DubMaster is

DubMaster is an AI dubbing tool: upload a video, it transcribes and diarizes speakers,
translates the dialogue, and generates dubbed audio per segment using AI voices. Users
then review and fine-tune the result in the Editor before exporting.

## The Editor layout

- **Left panel**: the segment/transcript list. Each row shows a speaker, the original
  source text, and the current dubbed text. Right-clicking a row opens a context menu;
  left-clicking selects it.
- **Video preview** (top right, "Video" tab): plays the video with the current dub.
  Below it is a toolbar with per-segment actions.
- **Timeline** (bottom): shows the Original audio track and the Dubbed audio track as
  blocks positioned by segment timing, with a shared playhead. Right-clicking a block
  opens the same context menu as the segment list.

## Segment toolbar actions

- **Ask AI Chat** — this feature: general help/how-to questions about DubMaster,
  available to everyone regardless of plan.
- **Change Voice** — opens a row of voice chips; drag one onto a segment (or a whole
  speaker) to assign that voice.
- **Pronunciation** — adjust how a specific word/phrase is pronounced in the dub.
- **Emotion** — set or clear an emotional tone tag for the segment's delivery.
- **Nuances** — fine-grained delivery adjustments beyond the base emotion tag.
- **Ask AI** (separate feature, sparkle icon) — a floating panel that rewrites the
  *currently selected segment's* dubbed text based on a free-text request or a quick
  preset ("Make this sound more natural," "Shorten to fit lip-sync," etc.). It only
  sees that one segment's source/dubbed text and language pair — it cannot see or
  change voice, emotion, QC scores, or other segments. Requires a Premium or
  Professional plan.

## Right-click context menu (segment list rows and timeline blocks)

- **Undo Last Edit** — reverts the most recent text edit only.
- **Split at Playhead** / **Split at Word…** — divides a segment into two.
- **Add Segment After** — inserts a new empty segment.
- **Delete Segment**.
- **Lock / Unlock** — locked segments are protected from edits/regeneration.
- **Pair with Original** — links a segment's timing to the original track.
- **Revert to Original** — fully resets the segment: dubbed text back to the true
  original transcription, audio recomputed from the original file, and any commit/
  lock/staged voice/emotion state cleared.
- **Clear Segment** — resets text to the original transcription and clears emotion/
  voice overrides, with a confirm-click safety step.

## Voice Library

A panel for browsing available AI voices (search, filter by gender/tag, favorites).
Selecting a voice shows a Preview button and an "Assign to…" control to assign it to
a speaker. A "Clear All Voices" button removes every speaker's voice assignment for
the whole job at once (with a confirmation dialog showing how many segments are
affected) — this is a bulk action, separate from clearing one segment via the context
menu.

## QC (Quality Control) panel

Shows an overall quality score plus individual metrics: timing, speed, loudness,
silences, lip_sync, and emotion_preservation. These reflect how well the dubbed audio
matches the original in pacing and delivery.

## Plan tiers

DubMaster has three tiers: **Basic**, **Premium**, and **Professional**.

- Available on **all tiers**: the inline editor basics, Ask AI Chat (this feature),
  voice cloning.
- **Premium and Professional**: the full editor, pipeline monitor, QC scoring, Ask AI
  (dialogue rewrite), Voice Library, custom emotion write-in, Studio/collaboration
  features.
- **Professional only**: the review queue, emotional curve editor, lip-sync scoring,
  heatmaps, character analyzer, Velma panel, character profiles, the emotional
  intelligence library, project versioning, and performance notes.

If a user on a lower tier asks about a feature above their plan, say so plainly and
suggest upgrading, rather than describing the feature as if they can use it.

## Exporting

Once satisfied, users export the final dubbed video via the Export button, or trigger
a full rebuild via "Rebuild Video" if segments changed since the last export.
