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
- **Emotion** — set or clear the segment's emotional delivery from a pill list
  (see "How emotions reach the voice" below). Applies on the next regeneration.
- **Nuances** — a panel of fine delivery controls (pace, breath, tail, pitch,
  etc.) plus a free-text write-in (see "Nuances — fine delivery control" below).
- **Ask AI** (separate feature, sparkle icon) — a floating panel that rewrites the
  *currently selected segment's* dubbed text based on a free-text request or a quick
  preset ("Make this sound more natural," "Shorten to fit lip-sync," etc.). It only
  sees that one segment's source/dubbed text and language pair — it cannot see or
  change voice, emotion, QC scores, or other segments. Requires a Premium or
  Professional plan.

## Voice engines — Fish Audio and Respeecher

DubMaster can render a segment with either of two voice engines, chosen per
segment. The **Respeecher** tab shows which one a segment last used as a small
chip in its header (`fish-audio` or `respeecher`).

- **To use Respeecher:** open the Respeecher tab, pick a voice, press Generate.
- **To go back to Fish Audio:** press the **Fish Audio** button next to the
  Respeecher tab's title. It re-renders the segment with the voice that
  speaker is mapped to.
- **Dropping a Fish voice** onto a segment also moves it to Fish Audio.

Some segments always render on Fish Audio regardless: **child speakers**
(Respeecher has no child voice), and any segment whose voice isn't in
Respeecher's catalogue.

### The two engines take direction very differently

**Fish Audio** understands performance direction. Emotion pills, Nuances and
Delivery Script tags all reach it and shape the read.

**Respeecher has no directive language at all.** It speaks the segment's text
and nothing else — emotion pills, nuance directives and Delivery Script tags
do **not** reach a Respeecher render. On Respeecher your levers are:

- **Punctuation and phrasing.** A comma buys a beat; a full stop buys more.
  This is the main way to shape a Respeecher read.
- **The voice you cast.** Each Respeecher voice ships its own tuning.
- **The sampling controls** in the Respeecher tab.

Respeecher also has no speed or pitch parameter. The speed chip still works —
DubMaster time-stretches the finished audio instead.

### Why Respeecher gives you three takes

Respeecher's read length varies noticeably between generations of the same
line. DubMaster generates three takes and keeps the one that best fits the
segment's slot — the longest that still fits, since that's closest to natural
pacing. The other two stay listed as `alt1` and `alt2` so you can hear them.

If even the best take overruns the slot by more than can be corrected cleanly,
DubMaster tells you rather than squashing the audio to fit.

## How emotions reach the voice (emotion pills)

DubMaster's Fish Audio S2 engine takes performance direction as free-form
natural-language descriptions. When you set an emotion pill on a
segment, DubMaster does NOT send the bare word — it automatically expands it
into a rich delivery description the voice engine acts on. You never type tags
yourself; setting a pill changes delivery on the segment's next (re)generation.

**This applies to segments rendered with Fish Audio.** Respeecher has no
directive language, so a pill set on a Respeecher segment does not change its
audio — see "Voice engines" above.

The 20 pills map as follows — **pill → what the voice engine actually receives**:

| Pill | Delivery direction sent to the voice |
|---|---|
| Neutral | *(nothing — no steering)* |
| Happy | warm and bright, lightly smiling tone |
| Excited | breathless and eager, rising pitch with building anticipation |
| Calm | slow and steady, soft soothing tone |
| Sad | heavy and subdued, downward trailing endings |
| Angry | tense and forceful, clipped hard delivery |
| Fearful | shaky and hushed, quick uneven breaths |
| Surprised | sudden sharp rise in pitch, wide-eyed disbelief |
| Disgusted | recoiling, curled sneering tone |
| Professional | clear, measured and confident broadcast tone |
| Casual | relaxed and easygoing, conversational |
| Formal | poised and precise, controlled cadence |
| Intimate | soft and close, gentle breathy warmth |
| Defiant | firm and unyielding, chin-up challenging tone |
| Confused | hesitant and searching, inquisitive rising ending |
| Whisper | hushed whisper in a small voice |
| Shout | loud and projected, urgent force |
| Sarcastic | dry and mocking, exaggerated flat delivery |
| Hopeful | gentle rising pitch, warm anticipation |
| Melancholic | wistful and slow, trailing pensive endings |

Typing your own custom emotion word passes through as-is. **Questions:** a line
that is a question but has no question mark tends to fall flat at the end — add
a "?" to the segment text and regenerate to get the rising, questioning
delivery. Emotion is one of several cues; the voice-clone identity still carries
most of the character, so pills nuance the read rather than override the voice.

**A pill and a Delivery Script are mutually exclusive.** If the segment has a
Delivery Script in its `+ write-in` box, the pill is ignored for that generation —
put the emotion in the script's tags instead (`[defiant] ...`). The pill still
shows in the UI, but it is not sent. See "Delivery Script" below.

## Nuances — fine delivery control

The Nuances tab gives per-segment control beyond the emotion pill. Every control
here folds into the SAME single delivery instruction sent to the voice, applied
when you press "Regenerate with Nuances". The **center/neutral position of any
control is the intentional "no change" baseline** — move a control off center
for it to take effect.

**Nuances do not apply when the segment has a Delivery Script.** If the `+ write-in`
box holds a Delivery Script, that text is sent to the voice verbatim and every
control on this panel is discarded except **Tempo Pacing**, which still affects
speed. Use one tool or the other, not both.

Basic buttons (three positions; the middle is neutral, **both ends now act**):

| Button | Low end | High end |
|---|---|---|
| Pace | quick, rushed *(also speeds up)* | slow, deliberate *(also slows down)* |
| Weight | light, airy | heavy, weighted |
| Breath | tight, controlled | breathy, intimate |
| Delivery | intimate, close and soft | projected, energized |
| Tail | clipped, clean stop | soft trailing fade |

Advanced sliders (0–100; act in **both** directions once moved off center):

| Slider | Toward minimum | Toward maximum |
|---|---|---|
| Prosody | flat, level | expressive, wide pitch |
| Pitch Contour | flat contour | melodic, sing-song |
| Volume Dynamics | compressed, even | dynamic swells |
| Tempo Pacing | slower | faster |
| Breath Sounds | minimal breaths | audible breaths |
| Voice Quality | smooth, clean | textured, gravelly |
| Micro Intonation | flat, robotic | natural, human |
| Pauses | fewer pauses | more/longer pauses *(edits the spoken text)* |

**Inline markers** (Rise, Drop, Stress, Whisper, Pause, Breathy): select part of
the text, then click a marker to apply that effect to just those words.

**Nuances write-in:** the free-text box at the bottom of *this panel* — not the
same thing as the segment's `+ write-in` chip. Add any extra delivery note here
(e.g. "lingers on the last word", "rising, inquisitive on 'me'") and it's appended
to the segment's delivery instruction on regenerate. A few decisive settings land
better than maxing everything at once. Like the rest of this panel, it is discarded
if the segment has a Delivery Script.

## Delivery Script — inline tags placed exactly where you want them

**Delivery Script is a Fish Audio feature.** Writing one on a segment that's
currently on Respeecher moves that segment to Fish Audio so the tags are
actually honoured — a brief notice tells you when that happens.

For fine, positional control you can write the line together with inline delivery
tags in **square brackets**, placed at the exact point where the shift should
happen. The voice engine reads the tags as performance direction and does **not**
speak them:

    There are many masters, [reassuring] anyone of them should be fine.
    She set the folder down. [long pause] Then she looked up.
    [defiant] [shouting] What! Go On!!

You author this in the segment's **write-in box** (the "+ write-in" chip), so the
brackets never clutter the on-screen line or subtitle:

1. Open the write-in box, then **double-click inside it** to load the segment's
   current line.
2. Type your `[tags]` inline where you want the delivery to change. You can also
   rewrite the words themselves — punctuation, emphasis, whole phrasings — the
   spoken line does not have to match the text bubble.
3. Press **Generate Speech** (or Ctrl+Enter).

The write-in text is what the voice speaks; the segment's normal text bubble,
subtitle, and timeline keep the clean line (no brackets, no timing change).

**How the box decides what you meant.** The write-in box does two jobs, and it
tells them apart by the *shape* of what you typed:

- `[tags]` **and** words outside them → a **Delivery Script**. The whole thing is
  sent to the voice verbatim; the tags steer, the words are spoken.
- No tags, or nothing but tags → a **short emotion**, staged as an emotion pill.

So `[defiant] What! Go On!!` is a script, while `defiant` or `[defiant]` on its
own is a pill.

**Brackets must be square.** `[like this]`, never `{like this}` or a mismatched
`[like this}`. The voice engine speaks anything it can't parse as a tag, so a
curly brace turns your direction into dialogue. The box checks this as you type
and blocks Generate Speech until the brackets are balanced.

**Tags are free-form** natural language — describe the delivery in your own words
(`[whispering]`, `[warm and reassuring]`, `[quiet, trailing off]`); you're not
limited to a fixed list. You can stack more than one, and a tag at the start of a
sentence steers the whole sentence while a tag mid-line steers the words right
after it. Fish Audio recommends **no more than three** combined emotion clauses
per sentence — past that, direction gets muddy rather than stronger.

**A Delivery Script overrides everything else on the segment.** While one is
present, the emotion pill, the speaker's character traits, every Nuances control
except Tempo Pacing, the inline word markers, and the Nuances write-in are all
discarded. The script's tags have to carry the entire performance direction. Use
one tool or the other — not both.

This applies only when you generate from the write-in; a normal regenerate goes
back to the plain line plus any emotion/nuance settings.

## Writing effective delivery — craft notes

The sections above describe what the controls *do*. This one is about what
actually produces a good read. Findings marked **measured** come from real runs
with figures; the rest are documented behaviour or reported experience.

### Punctuation is the strongest lever you have

Commas are not decoration — they are **phrase boundaries**, and phrasing is
where prosody lives. Without them the engine sees one prosodic unit and gives
it one flat contour across the whole line, with nowhere to place emphasis.

**Measured**, same segment, same voice, same tags, only punctuation changed:

    Master please dont be angry!     -> 1.73 s   flat, run together, no colour
    Master, please, dont be angry!   -> 3.42 s   each phrase shaped separately

**98% longer, and the only difference was two commas.** The commas gave the
engine three units to shape instead of one: "please," could actually plead
because it became a standalone phrase with room to breathe, and "dont be
angry!" landed with urgency because it was a separate unit ending on "!".

- **Question marks**: a question written without a "?" tends to fall flat at the
  end. Adding one produces the rising, questioning delivery.
- **Exclamation points**: end a phrase with attack and urgency.
- **Commas**: create the phrase boundaries that make emphasis possible. If a
  line sounds flat and rushed, punctuation is the first thing to try — before
  reaching for more tags.

### Punctuate the spoken line, not the subtitle

The text bubble, subtitle, and timeline all show the segment's `text`. Only the
Delivery Script reaches the voice. So punctuate purely for performance without
it ever appearing on screen:

    subtitle:  Master, please don't be angry
    spoken:    [pleading] Master, please, don't be angry!

Em-dashes, ellipses, an extra comma inserted to force a breath — all of it
shapes the read and none of it reaches the viewer. This is the main reason to
author in the write-in rather than editing the line itself.

### Conflicting tags don't average — one wins

Stacking tags that pull in opposite directions does not split the difference;
the stronger instruction takes over.

**Measured:** `[pleading] [raised voice] Master, please don't be angry!`
rendered at **-31.24 LUFS** — quieter than the take it replaced. "Pleading" is
inherently a small, soft delivery and it beat the level instruction outright.
On the same job, `[shout] Master Yip [intense] I've been wronged!` rendered at
**-14.16 LUFS**, the loudest line in the scene.

Keep the tags on one segment semantically consistent.

### Never use tags to chase volume

If a line is too quiet that is a level problem, and tags are the wrong tool —
asking for `[raised voice]` on a quiet take produced a *quieter* result.

Segment level is handled for you: a rendered segment measuring below the floor
(-20 LUFS) is raised automatically, boost-only and peak-safe, while anything
already at or above the floor is left untouched. A shout stays louder than a
whisper; a broken-quiet take gets rescued.

Write tags for **character only** — how the line is performed, not how loud it
is. That keeps each tag doing one job.

### Placement scopes the tag

A tag at the **start of a sentence** steers the whole sentence; a tag **mid-line**
steers the words that follow it. These are different instructions:

    [whispering] She left without saying goodbye.
    She left without saying goodbye, [whispering] again.

Fish Audio recommends **no more than three** combined emotion clauses per
sentence. Past that, direction gets muddy rather than stronger.

### Brackets must be square, and balanced

`[like this]` — never `{like this}` or a mismatched `[like this}`. Anything the
engine cannot parse as a tag is spoken aloud. **Measured:** a malformed
`[Defiant}` produced 6.37 seconds of audio for a three-word line, with the
direction read out as dialogue. The write-in box blocks Generate Speech until
the brackets are balanced.

## Right-click context menu (segment list rows and timeline blocks)

- **Undo Last Edit** — reverts the most recent text edit only.
- **Copy Text** / **Paste Text** — copy the segment's dubbed text to the clipboard, or
  replace it with the clipboard contents (applied like a normal edit).
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

## When a line sounds rushed or hurried

If a dubbed line sounds sped-up, the cause is almost always that the English needs
more time than the original line allows. DubMaster handles this in three stages,
in order: it **shortens** the wording (using the sync_fit adaptation variant), then
**speeds up** the audio if it still overruns, and only trims as a last resort.

Things you can do, most effective first:

1. **Try a different voice.** Voices differ in how fast they speak — the same line
   can run noticeably longer in one voice than another. If a character consistently
   sounds hurried, assigning a faster-speaking voice from the Voice Library often
   fixes it on its own, with no text change. DubMaster learns each voice's actual
   speaking rate as it dubs and uses that rate when deciding how much to shorten,
   so this is a real lever rather than a workaround.
2. **Shorten the text yourself** using the write-in on that segment. Fewer syllables
   is the only change that reduces speed without side effects — this is the most
   reliable fix for a specific line, such as an opening line where the original
   packs a name and a statement into a very short window.
3. **Give the segment more room** by dragging its boundary on the timeline, if
   there is silence next to it. DubMaster already borrows nearby space
   automatically, so this helps only where genuine slack remains.

Some source lines are simply very dense — a few Cantonese syllables can carry more
than English can say in the same time. In those cases a slight speed-up is normal
and is what a human dub would also do; the goal is that it stays unobtrusive rather
than disappearing entirely.

## Voice Library

A panel for browsing available AI voices (search, filter by gender/tag, favorites).
The panel shows voice names on the left — each with a play button to audition it,
and a badge naming any speaker the voice is already assigned to — and the selected
voice's description, tags and controls on the right.
Selecting a voice shows a Preview button and an "Assign to…" control to assign it to
a speaker. Assigning a voice to a speaker applies it to ALL of that speaker's segments
consistently (locked segments are skipped), so the whole character switches voices in
one action. Your own **custom voices** (added via the Custom Voices button) appear at
the top of the library and are assigned the same way. A "Clear All Voices" button
removes every speaker's voice assignment for the whole job at once (with a confirmation
dialog showing how many segments are affected) — this is a bulk action, separate from
clearing one segment via the context menu.

## Seed Library

Every Respeecher take is produced from a **seed** — a number that, replayed
with the same voice and settings, reproduces that same read in a single
request rather than generating three fresh ones. The **Seed Library** tab
lists every take this job has produced.

A seed only reproduces **its own line**. The text is part of the take, so a
seed recalled after you've rewritten the line gives you an unrelated read.

Each row shows the line, the voice, and the seed, with:

- **use** — re-render that entry's own segment from its seed. One request,
  and normally the exact take back. Occasionally the read varies slightly;
  that's the engine, not a fault.
- **padlock** (gold when on) — keep this take forever. Unlocked entries are
  dropped once a segment accumulates more than twelve, so lock anything you
  want to keep.
- **trash** — forget the entry. This only removes it from the list; the
  segment's current audio is untouched.
- **live** — this seed is what the segment plays right now.
- **#number** — jumps the timeline to that segment.

There's also a filter box (line, voice or seed) and a **this segment** toggle.

The library is per job. Locking a seed protects it from being dropped
automatically; it does not stop you deleting it deliberately.

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
