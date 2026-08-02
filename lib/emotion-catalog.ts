// Extended Emotion Library — ~194 delivery states across 10 categories, each with a
// short natural-language description that doubles as the Fish S2 tag. Selecting one
// stages the segment's emotion as "name, description" (passes straight through to Fish
// as [name, description], now that S2 tags parse). None duplicate the base 20 pills.
// Cross-category / in-list repeats from the source spec are deduped (kept on first use).

export interface CatalogEmotion {
  name: string
  desc: string
}

export interface EmotionCategory {
  key: string
  label: string
  icon: string
  emotions: CatalogEmotion[]
}

export const EMOTION_LIBRARY: EmotionCategory[] = [
  {
    key: 'A', label: 'Light, Soft, Gentle', icon: '🌤️',
    emotions: [
      { name: 'Tender', desc: 'soft warmth, gentle upward inflection' },
      { name: 'Affectionate', desc: 'warm tone, lightly smiling vowels' },
      { name: 'Caring', desc: 'slow, nurturing delivery with softened consonants' },
      { name: 'Comforting', desc: 'soothing tone, gentle downward glide' },
      { name: 'Sympathetic', desc: 'soft, understanding tone with breathy warmth' },
      { name: 'Reassuring', desc: 'steady, calm tone with subtle upward lift' },
      { name: 'Warm', desc: 'cozy resonance, relaxed pacing' },
      { name: 'Friendly', desc: 'open tone, easy conversational rhythm' },
      { name: 'Cheerful', desc: 'bright tone, buoyant pitch movement' },
      { name: 'Sunny', desc: 'lightly glowing tone with airy brightness' },
      { name: 'Lighthearted', desc: 'playful rhythm, soft bouncy inflection' },
      { name: 'Gentle', desc: 'delicate tone, softened articulation' },
      { name: 'Softspoken', desc: 'quiet, controlled delivery with minimal force' },
      { name: 'Mild', desc: 'low-intensity tone, smooth contour' },
      { name: 'Pleasant', desc: 'balanced tone with subtle warmth' },
      { name: 'Inviting', desc: 'welcoming tone, slight upward tilt' },
      { name: 'Open', desc: 'clear, transparent tone with relaxed pacing' },
      { name: 'Soothing', desc: 'slow, calming resonance' },
      { name: 'Kind', desc: 'warm tone with softened edges' },
      { name: 'Nurturing', desc: 'gentle, protective tone with slow pacing' },
    ],
  },
  {
    key: 'B', label: 'Strong, Intense, High-Energy', icon: '🔥',
    emotions: [
      { name: 'Fierce', desc: 'sharp, forceful delivery with strong emphasis' },
      { name: 'Explosive', desc: 'sudden bursts of energy and pitch' },
      { name: 'Raging', desc: 'heated tone, pressured pacing' },
      { name: 'Commanding', desc: 'authoritative projection, firm cadence' },
      { name: 'Dominant', desc: 'strong, controlled tone with downward inflection' },
      { name: 'Impassioned', desc: 'intense emotional weight, wide dynamics' },
      { name: 'Driven', desc: 'forward-pushing tone with tight pacing' },
      { name: 'Forceful', desc: 'heavy articulation, strong consonants' },
      { name: 'Boisterous', desc: 'loud, lively tone with energetic rhythm' },
      { name: 'Triumphant', desc: 'lifted pitch, victorious resonance' },
      { name: 'Heroic', desc: 'bold, resonant tone with confident projection' },
      { name: 'Exploratory', desc: 'curious energy, rising mid-phrase' },
      { name: 'Hyperactive', desc: 'rapid pacing, bright pitch spikes' },
      { name: 'Agitated', desc: 'restless tone, uneven rhythm' },
      { name: 'Volatile', desc: 'unpredictable pitch and pacing' },
      { name: 'Intense', desc: 'compressed tone with emotional pressure' },
      { name: 'Zealous', desc: 'fervent tone with strong conviction' },
      { name: 'Energetic', desc: 'lively pacing, bright inflection' },
      { name: 'Wild', desc: 'unrestrained tone with erratic dynamics' },
    ],
  },
  {
    key: 'C', label: 'Dark, Heavy, Somber', icon: '🌑',
    emotions: [
      { name: 'Brooding', desc: 'low, slow tone with heavy resonance' },
      { name: 'Grave', desc: 'serious, weighty delivery' },
      { name: 'Mournful', desc: 'soft, downward tone with emotional heaviness' },
      { name: 'Desolate', desc: 'hollow tone, slow pacing' },
      { name: 'Hopeless', desc: 'flat contour, drained energy' },
      { name: 'Bleak', desc: 'cold, monotone delivery' },
      { name: 'Forlorn', desc: 'fragile tone with downward drift' },
      { name: 'Sorrowful', desc: 'emotional weight, tremored vowels' },
      { name: 'Somber', desc: 'muted tone, slow cadence' },
      { name: 'Dreary', desc: 'dull tone, minimal inflection' },
      { name: 'Defeated', desc: 'slumped tone, downward endings' },
      { name: 'Crushed', desc: 'strained tone, breathy breaks' },
      { name: 'Wounded', desc: 'fragile tone with emotional tremor' },
      { name: 'Tormented', desc: 'strained delivery, uneven pacing' },
      { name: 'Anguished', desc: 'intense emotional pain, trembling pitch' },
      { name: 'Burdened', desc: 'heavy tone, slow articulation' },
      { name: 'Depressed', desc: 'flat, low-energy delivery' },
      { name: 'Languid', desc: 'slow, dragging tone' },
      { name: 'Somnolent', desc: 'sleepy, softened consonants' },
      { name: 'Empty', desc: 'hollow tone, minimal dynamics' },
    ],
  },
  {
    key: 'D', label: 'Nervous, Uncertain, Tense', icon: '⚡',
    emotions: [
      { name: 'Uneasy', desc: 'tight tone, hesitant pacing' },
      { name: 'Tense', desc: 'compressed delivery, rigid articulation' },
      { name: 'Restless', desc: 'jittery pacing, uneven breaths' },
      { name: 'Skittish', desc: 'quick, startled inflection' },
      { name: 'Jittery', desc: 'shaky tone with micro-pauses' },
      { name: 'On Edge', desc: 'sharp tone, clipped endings' },
      { name: 'Wary', desc: 'cautious tone, slow rising tail' },
      { name: 'Hesitant', desc: 'delayed onset, searching inflection' },
      { name: 'Apprehensive', desc: 'tight breath, rising uncertainty' },
      { name: 'Trembling', desc: 'shaky pitch, fragile tone' },
      { name: 'Fretful', desc: 'worried tone with uneven pacing' },
      { name: 'Distracted', desc: 'unfocused tone, drifting cadence' },
      { name: 'Uncertain', desc: 'wavering pitch, soft delivery' },
      { name: 'Timid', desc: 'quiet tone, minimal projection' },
      { name: 'Nervous', desc: 'breathy tone, rapid pacing' },
      { name: 'Anxious', desc: 'tight delivery, micro-breaths' },
      { name: 'Paranoid', desc: 'tense tone, suspicious inflection' },
      { name: 'Alarmed', desc: 'sharp pitch spikes, sudden breaths' },
      { name: 'Startled', desc: 'abrupt onset, quick rise' },
    ],
  },
  {
    key: 'E', label: 'Positive, Upbeat, Bright', icon: '🌈',
    emotions: [
      { name: 'Joyful', desc: 'bright tone, wide pitch movement' },
      { name: 'Radiant', desc: 'glowing resonance, lifted inflection' },
      { name: 'Buoyant', desc: 'bouncy rhythm, airy tone' },
      { name: 'Optimistic', desc: 'rising contour, warm pacing' },
      { name: 'Uplifted', desc: 'elevated tone, gentle swell' },
      { name: 'Encouraging', desc: 'supportive tone, upward emphasis' },
      { name: 'Inspired', desc: 'energized tone, expressive contour' },
      { name: 'Motivated', desc: 'forward-leaning tone, confident pacing' },
      { name: 'Grateful', desc: 'warm tone, softened articulation' },
      { name: 'Content', desc: 'relaxed tone, steady pacing' },
      { name: 'Pleased', desc: 'soft smile in the voice' },
      { name: 'Delighted', desc: 'bright tone, lively inflection' },
      { name: 'Playful', desc: 'teasing rhythm, light pitch dips' },
      { name: 'Charmed', desc: 'warm, lightly amused tone' },
      { name: 'Amused', desc: 'soft laugh under speech' },
      { name: 'Tickled', desc: 'bubbly tone, rising inflection' },
      { name: 'Festive', desc: 'lively tone, celebratory rhythm' },
      { name: 'Hope-filled', desc: 'gentle rise, warm resonance' },
      { name: 'Blissful', desc: 'soft, glowing tone' },
      { name: 'Enthusiastic', desc: 'energetic tone, expressive dynamics' },
    ],
  },
  {
    key: 'F', label: 'Negative, Sharp, Harsh', icon: '🌪️',
    emotions: [
      { name: 'Irritated', desc: 'clipped delivery, tight pacing' },
      { name: 'Annoyed', desc: 'flat tone with sharp emphasis' },
      { name: 'Dismissive', desc: 'curt tone, minimal inflection' },
      { name: 'Contemptuous', desc: 'sneering tone, curled vowels' },
      { name: 'Hostile', desc: 'aggressive tone, pressured delivery' },
      { name: 'Cold', desc: 'detached tone, crisp articulation' },
      { name: 'Harsh', desc: 'sharp consonants, forceful projection' },
      { name: 'Scornful', desc: 'mocking tone, downward inflection' },
      { name: 'Judgmental', desc: 'pointed emphasis, slow pacing' },
      { name: 'Critical', desc: 'precise articulation, firm tone' },
      { name: 'Accusatory', desc: 'sharp inflection, rising tension' },
      { name: 'Demanding', desc: 'forceful tone, strong projection' },
      { name: 'Impatient', desc: 'rushed pacing, clipped endings' },
      { name: 'Frustrated', desc: 'pressured tone, uneven rhythm' },
      { name: 'Resentful', desc: 'tight tone, downward drift' },
      { name: 'Bitter', desc: 'sharp tone, compressed delivery' },
      { name: 'Grim', desc: 'cold tone, minimal dynamics' },
      { name: 'Severe', desc: 'strict tone, controlled cadence' },
      { name: 'Harried', desc: 'rushed tone, stressed pacing' },
      { name: 'Snide', desc: 'sly, mocking tone' },
    ],
  },
  {
    key: 'G', label: 'Airy, Breath-Based, Whispery', icon: '🌬️',
    emotions: [
      { name: 'Breathy', desc: 'airy tone, soft consonants' },
      { name: 'Ghostly', desc: 'hollow whisper, slow pacing' },
      { name: 'Hushed', desc: 'quiet tone, minimal projection' },
      { name: 'Secretive', desc: 'low, conspiratorial whisper' },
      { name: 'Ethereal', desc: 'floating tone, airy resonance' },
      { name: 'Dreamy', desc: 'soft, drifting delivery' },
      { name: 'Distant', desc: 'far-away tone, slow pacing' },
      { name: 'Foggy', desc: 'hazy tone, blurred articulation' },
      { name: 'Sleepy', desc: 'soft, slow tone with trailing ends' },
      { name: 'Faint', desc: 'barely-there tone, gentle breath' },
      { name: 'Weightless', desc: 'airy tone, light inflection' },
      { name: 'Floating', desc: 'drifting rhythm, soft contour' },
      { name: 'Breath-lifted', desc: 'audible inhale shaping tone' },
      { name: 'Soft-winded', desc: 'gentle airflow, quiet delivery' },
      { name: 'Murmured', desc: 'low, soft articulation' },
      { name: 'Underbreath', desc: 'half-spoken, quiet tone' },
      { name: 'Sighing', desc: 'breath-heavy tone, downward drift' },
      { name: 'Feathery', desc: 'delicate, airy tone' },
      { name: 'Whimpered', desc: 'soft tremor, fragile breath' },
      { name: 'Misted', desc: 'diffuse tone, softened edges' },
    ],
  },
  {
    key: 'H', label: 'Cognitive, Thoughtful, Reflective', icon: '🧠',
    emotions: [
      { name: 'Thoughtful', desc: 'slow pacing, reflective tone' },
      { name: 'Pensive', desc: 'soft, downward inflection' },
      { name: 'Analytical', desc: 'precise articulation, measured pacing' },
      { name: 'Philosophical', desc: 'calm tone, expanded cadence' },
      { name: 'Contemplative', desc: 'slow rhythm, gentle pauses' },
      { name: 'Meditative', desc: 'even pacing, soft resonance' },
      { name: 'Introspective', desc: 'quiet tone, inward focus' },
      { name: 'Curious', desc: 'rising inflection, leaning-forward tone' },
      { name: 'Speculative', desc: 'drifting tone, uncertain contour' },
      { name: 'Wondering', desc: 'soft upward tilt, gentle pacing' },
      { name: 'Deliberate', desc: 'careful pacing, controlled tone' },
      { name: 'Reasoned', desc: 'steady tone, clear articulation' },
      { name: 'Studious', desc: 'focused tone, precise delivery' },
      { name: 'Observant', desc: 'attentive tone, slight upward lift' },
      { name: 'Investigative', desc: 'probing tone, rising mid-phrase' },
      { name: 'Socratic', desc: 'questioning tone, gentle rise' },
      { name: 'Reflective', desc: 'soft tone, slow cadence' },
      { name: 'Musing', desc: 'drifting tone, airy pacing' },
      { name: 'Ruminative', desc: 'slow, heavy tone' },
      { name: 'Inquisitive', desc: 'searching inflection, rising tail' },
    ],
  },
  {
    key: 'I', label: 'Social, Interpersonal, Relational', icon: '🎭',
    emotions: [
      { name: 'Polite', desc: 'controlled tone, softened articulation' },
      { name: 'Diplomatic', desc: 'balanced tone, careful pacing' },
      { name: 'Supportive', desc: 'warm tone, gentle upward lift' },
      { name: 'Persuasive', desc: 'confident tone, rhythmic emphasis' },
      { name: 'Charming', desc: 'warm tone, playful inflection' },
      { name: 'Flirtatious', desc: 'teasing tone, lilting contour' },
      { name: 'Teasing', desc: 'playful tone, light dips' },
      { name: 'Coaxing', desc: 'soft tone, gentle upward pull' },
      { name: 'Receptive', desc: 'soft tone, relaxed pacing' },
      { name: 'Collaborative', desc: 'steady tone, inclusive rhythm' },
      { name: 'Mentoring', desc: 'supportive tone, clear articulation' },
      { name: 'Guiding', desc: 'calm tone, steady pacing' },
      { name: 'Affirming', desc: 'warm tone, upward emphasis' },
      { name: 'Respectful', desc: 'measured tone, controlled delivery' },
      { name: 'Courteous', desc: 'polite tone, smooth cadence' },
      { name: 'Empathetic', desc: 'soft tone, emotional resonance' },
    ],
  },
  {
    key: 'J', label: 'Complex, Layered, Mixed', icon: '🌀',
    emotions: [
      { name: 'Conflicted', desc: 'uneven pacing, wavering tone' },
      { name: 'Torn', desc: 'fragile tone, downward drift' },
      { name: 'Ambivalent', desc: 'mixed inflection, shifting contour' },
      { name: 'Bittersweet', desc: 'warm tone with soft sadness' },
      { name: 'Hope-tinged', desc: 'gentle rise with emotional weight' },
      { name: 'Reluctant', desc: 'hesitant tone, delayed onset' },
      { name: 'Cautiously Optimistic', desc: 'soft rise, controlled pacing' },
      { name: 'Guarded', desc: 'restrained tone, tight delivery' },
      { name: 'Reserved', desc: 'quiet tone, minimal dynamics' },
      { name: 'Masked', desc: 'controlled tone hiding emotion' },
      { name: 'Underplayed', desc: 'subtle tone, minimal inflection' },
      { name: 'Layered', desc: 'mixed emotional cues in delivery' },
      { name: 'Confessional', desc: 'soft tone, intimate pacing' },
      { name: 'Haunted', desc: 'hollow tone, tremored inflection' },
      { name: 'Unsettled', desc: 'wavering tone, uneven pacing' },
      { name: 'Mixed', desc: 'blended emotional contour' },
      { name: 'Dual-toned', desc: 'contrasting inflection patterns' },
      { name: 'Muted', desc: 'low-intensity tone, soft delivery' },
      { name: 'Subdued', desc: 'restrained tone, gentle pacing' },
      { name: 'Veiled', desc: 'hidden emotion, softened articulation' },
    ],
  },
]

// The tag value staged onto a segment when a library emotion is picked:
// "name, description" — displays as the name (first word) and reads to Fish as the tag.
export function libraryEmotionValue(e: CatalogEmotion): string {
  return `${e.name.toLowerCase()}, ${e.desc}`
}

export const EMOTION_LIBRARY_COUNT = EMOTION_LIBRARY.reduce((n, c) => n + c.emotions.length, 0)

// ---------------------------------------------------------------------------
// Chord chart -> library bridge
// ---------------------------------------------------------------------------
// The emotional curve chart speaks in psychological NOUNS ("Anger", "Grief")
// while every other emotion surface — the base pills and this library — speaks
// in delivery ADJECTIVES with an S2 description attached. Nothing in the two
// vocabularies overlaps, so a chord committed straight from the chart reached
// Fish as a bare "[anger]" instead of a real directive.
//
// Each chord emotion maps to three library states along the curve's own height:
// the curve stops being decoration and starts choosing HOW hard the emotion is
// played. Anger at 0.2 is Irritated; at 0.9 it's Raging.
export interface ChordTier {
  low: string
  mid: string
  high: string
}

export const CHORD_EMOTION_TIERS: Record<string, ChordTier> = {
  Acceptance:    { low: 'Muted',        mid: 'Receptive',     high: 'Affirming' },
  Anger:         { low: 'Irritated',    mid: 'Hostile',       high: 'Raging' },
  Anticipation:  { low: 'Wondering',    mid: 'Motivated',     high: 'Enthusiastic' },
  Anxiety:       { low: 'Uneasy',       mid: 'Anxious',       high: 'Alarmed' },
  Apprehension:  { low: 'Wary',         mid: 'Apprehensive',  high: 'Paranoid' },
  Awe:           { low: 'Wondering',    mid: 'Inspired',      high: 'Radiant' },
  Boredom:       { low: 'Muted',        mid: 'Dreary',        high: 'Languid' },
  Compassion:    { low: 'Kind',         mid: 'Sympathetic',   high: 'Nurturing' },
  Confidence:    { low: 'Reserved',     mid: 'Commanding',    high: 'Dominant' },
  Confusion:     { low: 'Uncertain',    mid: 'Distracted',    high: 'Torn' },
  Contempt:      { low: 'Dismissive',   mid: 'Contemptuous',  high: 'Scornful' },
  Contentment:   { low: 'Content',      mid: 'Pleased',       high: 'Blissful' },
  Courage:       { low: 'Deliberate',   mid: 'Driven',        high: 'Heroic' },
  Curiosity:     { low: 'Observant',    mid: 'Curious',       high: 'Inquisitive' },
  Delight:       { low: 'Amused',       mid: 'Delighted',     high: 'Tickled' },
  Despair:       { low: 'Bleak',        mid: 'Hopeless',      high: 'Desolate' },
  Determination: { low: 'Deliberate',   mid: 'Driven',        high: 'Forceful' },
  Disgust:       { low: 'Cold',         mid: 'Harsh',         high: 'Severe' },
  Empathy:       { low: 'Receptive',    mid: 'Empathetic',    high: 'Tender' },
  Envy:          { low: 'Guarded',      mid: 'Resentful',     high: 'Bitter' },
  Euphoria:      { low: 'Buoyant',      mid: 'Blissful',      high: 'Wild' },
  Excitement:    { low: 'Buoyant',      mid: 'Energetic',     high: 'Hyperactive' },
  Fear:          { low: 'Timid',        mid: 'Nervous',       high: 'Trembling' },
  Frustration:   { low: 'Impatient',    mid: 'Frustrated',    high: 'Agitated' },
  Gratitude:     { low: 'Affirming',    mid: 'Grateful',      high: 'Uplifted' },
  Grief:         { low: 'Somber',       mid: 'Mournful',      high: 'Anguished' },
  Guilt:         { low: 'Reluctant',    mid: 'Confessional',  high: 'Tormented' },
  Hope:          { low: 'Hope-tinged',  mid: 'Hope-filled',   high: 'Inspired' },
  Humility:      { low: 'Reserved',     mid: 'Respectful',    high: 'Courteous' },
  Indifference:  { low: 'Muted',        mid: 'Cold',          high: 'Dismissive' },
  Irritation:    { low: 'Annoyed',      mid: 'Irritated',     high: 'Impatient' },
  Jealousy:      { low: 'Reserved',     mid: 'Wary',          high: 'Accusatory' },
  Joy:           { low: 'Cheerful',     mid: 'Joyful',        high: 'Radiant' },
  Loneliness:    { low: 'Distant',      mid: 'Forlorn',       high: 'Empty' },
  Love:          { low: 'Affectionate', mid: 'Tender',        high: 'Impassioned' },
  Melancholy:    { low: 'Pensive',      mid: 'Somber',        high: 'Sorrowful' },
  Nostalgia:     { low: 'Musing',       mid: 'Bittersweet',   high: 'Haunted' },
  Pride:         { low: 'Affirming',    mid: 'Triumphant',    high: 'Boisterous' },
  Regret:        { low: 'Reluctant',    mid: 'Reflective',    high: 'Wounded' },
  Relief:        { low: 'Sighing',      mid: 'Soothing',      high: 'Uplifted' },
  Resentment:    { low: 'Cold',         mid: 'Resentful',     high: 'Bitter' },
  Sadness:       { low: 'Subdued',      mid: 'Sorrowful',     high: 'Crushed' },
  Serenity:      { low: 'Soothing',     mid: 'Meditative',    high: 'Weightless' },
  Shame:         { low: 'Timid',        mid: 'Masked',        high: 'Whimpered' },
  Surprise:      { low: 'Observant',    mid: 'Startled',      high: 'Alarmed' },
  Tenderness:    { low: 'Softspoken',   mid: 'Tender',        high: 'Caring' },
  Trust:         { low: 'Receptive',    mid: 'Reassuring',    high: 'Supportive' },
  Vulnerability: { low: 'Hesitant',     mid: 'Confessional',  high: 'Unsettled' },
  Wonder:        { low: 'Observant',    mid: 'Wondering',     high: 'Ethereal' },
  Zeal:          { low: 'Motivated',    mid: 'Zealous',       high: 'Explosive' },

  // Backend-only chords. `_VELMA_TO_CHORD` maps Velma labels onto these four,
  // but they are NOT in the chart's 50-slot CHORDS axis (which is full — adding
  // to it would re-space the whole chart). Without these entries they resolved
  // to bare "[pleading]" and rendered as Anger via the CHORDS[0] fallback.
  Pleading:      { low: 'Coaxing',      mid: 'Fretful',       high: 'Anguished' },
  Desperation:   { low: 'Fretful',      mid: 'Anguished',     high: 'Tormented' },
  Longing:       { low: 'Dreamy',       mid: 'Bittersweet',   high: 'Forlorn' },
  Yearning:      { low: 'Dreamy',       mid: 'Hope-tinged',   high: 'Impassioned' },
}

// Flat name -> CatalogEmotion index, so a tier name resolves to its description.
const EMOTION_BY_NAME: Record<string, CatalogEmotion> = {}
for (const cat of EMOTION_LIBRARY) {
  for (const e of cat.emotions) EMOTION_BY_NAME[e.name.toLowerCase()] = e
}

export function catalogEmotionByName(name: string): CatalogEmotion | undefined {
  return EMOTION_BY_NAME[name.trim().toLowerCase()]
}

/** Resolve a chord emotion + curve height (0-1) to a Fish-ready "name, description".
 *
 * Falls back to the bare lowercased chord word for anything unmapped, which is
 * exactly what the chart sent before — so an unknown chord is never worse off.
 */
export function chordEmotionValue(emotion: string, intensity: number): string {
  const tier = CHORD_EMOTION_TIERS[emotion]
  if (!tier) return emotion.toLowerCase()
  const i = Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 0.5
  const name = i < 0.34 ? tier.low : i < 0.67 ? tier.mid : tier.high
  const found = catalogEmotionByName(name)
  return found ? libraryEmotionValue(found) : name.toLowerCase()
}
