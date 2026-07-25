# DubMaster — Editor Feature Reference

This is ground-truth reference material for the in-app "Ask AI Chat" help assistant.
Only answer using what's described here. If something isn't covered, say you're not
sure rather than guessing or inventing behavior.

## What DubMaster is

DubMaster is an AI dubbing tool: upload a video, it transcribes and diarizes speakers,
translates the dialogue, and generates dubbed audio per segment using AI voices. Users
then review and fine-tune the result in the Editor before exporting.

Speakers are numbered by the order they are first heard — the first person to speak is
speaker-1, the next new voice speaker-2, and so on. You can reassign a segment's speaker
or rename a speaker in the editor if diarization gets one wrong.

## The Editor layout

- **Left panel**: the segment/transcript list. Each row shows a speaker, the original
  source text, and the current dubbed text. Right-clicking a row opens a context menu;
  left-clicking selects it.
- **Video preview** (top right, "Video" tab): plays the video with the current dub.
  Below it is a toolbar with per-segment actions.
- **Timeline** (bottom): shows several stacked tracks — Original, Dubbed, Preview Audio,
  and Emotion — as blocks positioned by segment timing, with a shared playhead. Each
  segment appears in every track at the same horizontal position. Right-clicking a block
  opens the same context menu as the segment list. Segment blocks can be dragged to
  reposition and their edges dragged to resize; when you move a segment, its blocks on
  every track move together in real time, and the new position is saved.

## Resizing the editor layout

The editor panels can be resized to give more room where you need it, and your sizes
are remembered across sessions (saved in the browser):

- **Video preview size** — drag the vertical divider between the video preview and the
  segment list left/right to make the video bigger or smaller.
- **Timeline height** — drag the horizontal bar just above the timeline up/down to make
  the timeline taller (more room to work with tracks) or shorter.
- Smaller resizers also let you widen the QC monitor and the timeline's track-label
  column.
- **Lock Layout** (top bar) freezes all of these so you don't move a panel by accident;
  toggle it off to resize again.

## Segment toolbar actions

- **Ask AI Chat** — this feature: general help/how-to questions about DubMaster,
  available to everyone regardless of plan.
- **Change Voice** — opens a row of quick voice presets (Male 1, Male 2, Female 1,
  Child 1); drag one onto a segment to assign that voice to the segment's speaker.
  Assigning a voice to a speaker applies it to ALL of that speaker's segments at once
  (locked segments are left unchanged), so a character's voice stays consistent — you
  don't assign voices one segment at a time.
- **Custom Voices** — add your own voice. Upload a short, clean audio clip (10–30s of
  single-speaker speech, no music/background noise) and DubMaster clones it; the cloned
  voice then appears at the top of the Voice Library and can be assigned to any speaker
  like any other voice. No API keys and no Fish Audio / ElevenLabs account are required —
  the clone is created under DubMaster's own account, so it works for generation and
  export immediately. (This replaces the old Pronunciation button.)
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
- **Split at Playhead** / **Split at Word…** — divides a segment into two. Each half keeps
  its own text, and the halves are auto-generated afterward so each gets fresh audio
  matching its text.
- **Add Segment After** — inserts a new empty segment.
- **Merge with Next** — combines a segment with the following segment into one. Only
  available when the next segment has the same speaker and neither segment is locked.
- **Delete Segment**.
- **Group Selection** / **Clear Group** — start or release a multi-segment selection to
  move several segments as one; see "Moving and grouping segments on the timeline" below.
- **Lock / Unlock** (keyboard: **Shift+L** to lock, **Shift+U** to unlock) — a locked
  segment is fully frozen: it cannot be dragged, resized, text-edited, or regenerated, and
  its voice, emotion, and speed are held exactly as they are. Locked segments show a green
  highlight and stay locked through a page refresh or closing and reopening the editor.
  Regeneration of a locked segment is refused even by bulk or automated actions — unlock
  it (Shift+U) to make any change.
- **Pair with Next** (keyboard: **Shift+P**) — links the segment with the one immediately
  to its right so the two move together on the timeline. Choose it again (it becomes
  **Unpair**) to release one pair, or press **Escape** to release all pairs at once. (This
  replaces the old "Pair with Original," which is obsolete now that all tracks already move
  in sync.)
- **Revert to Original** — fully resets the segment: dubbed text back to the true
  original transcription, audio recomputed from the original file, and any commit/
  lock/staged voice/emotion state cleared.
- **Clear Segment** — resets text to the original transcription and clears emotion/
  voice overrides, with a confirm-click safety step.

## Moving and grouping segments on the timeline

- **Move one segment**: drag its block on the timeline. All of that segment's blocks
  across the Original, Dubbed, Preview Audio, and Emotion tracks move together in real
  time, and the new position is saved. Drag a block's left or right edge to resize it.
- **Move several segments together (group move)**: right-click a segment and choose
  **Group Selection** to enter group mode — the cursor changes. Hold **Ctrl** and click
  the first segment, then Ctrl+click the last segment; everything from first to last is
  selected and enclosed in a transparent amber box (only the first and last segments are
  highlighted). Drag that box — or any selected segment — to move the whole group at once,
  with all tracks moving in sync. To release the group, right-click the box and choose
  **Clear Group**, or press **Escape**.
- **Pair with Next** (shortcut **Shift+P**) links a single segment with the one immediately
  to its right so the two move together — a quick two-segment link, different from a group
  selection.

Grouping segments to move them as one **is** supported — via Group Selection above.

## Saving and persistence

Text edits, splits, merges, segment moves/resizes, locks, and pairs are saved. The **Save**
button writes the current state as a snapshot, and locked segments stay locked and
unlocked segments stay unlocked. Closing and reopening the editor (or a hard refresh)
restores the project exactly as it was left — Save does not lock anything down, it just
preserves the current state.

## Fitting text into a segment's timing

When you regenerate a segment whose new dubbed audio is longer than its current slot,
DubMaster first tries to make it fit by expanding the segment into the empty space
around it — extending its end toward the next segment and, if needed, nudging its start
earlier into the gap before it — as long as that doesn't collide with a neighbor. Only
when the audio is too long for even the full free space between its neighbors does it
show the "Rewrite Text — Timing Exclusion" dialog asking you to shorten the text. So the
rewrite prompt means there is genuinely no room; otherwise the segment just grows to fit.

## Voice Library

A panel for browsing available AI voices (search, filter by gender/tag, favorites).
Selecting a voice shows a Preview button and an "Assign to…" control to assign it to
a speaker. Assigning a voice to a speaker applies it to ALL of that speaker's segments
consistently (locked segments are skipped), so the whole character switches voices in
one action. Your own **custom voices** (added via the Custom Voices button) appear at
the top of the library and are assigned the same way. A "Clear All Voices" button
removes every speaker's voice assignment for the whole job at once (with a confirmation
dialog showing how many segments are affected) — this is a bulk action, separate from
clearing one segment via the context menu.

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
  intelligence library, project versioning, performance notes, and **Custom Voices**
  (uploading/cloning your own voice — the automatic cloning of the original video's
  speakers is separate and available to all tiers).

If a user on a lower tier asks about a feature above their plan, say so plainly and
suggest upgrading, rather than describing the feature as if they can use it.

## Exporting

Once satisfied, users export the final dubbed video via the Export button, or trigger
a full rebuild via "Rebuild Video" if segments changed since the last export.
