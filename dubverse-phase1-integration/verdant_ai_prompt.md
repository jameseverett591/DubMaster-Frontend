# AI Video Dubbing Platform - Development Continuation Prompt

## Project Overview
I'm building an AI-powered video dubbing web application deployed on Vercel that allows users to upload videos (up to 2 hours long) and automatically dub them into different languages with character-aware voice casting. The app intelligently detects male, female, and children's voices, assigns appropriate voice actors, and maintains emotional context throughout the dubbing process.

## Current Status
The app pipeline is in its early stages and needs to be completed, then wired back into my Vercel Vo frontend.

## Core Functionality Required

### 1. User Flow (End-to-End)
- User uploads a video (up to 2 hours)
- App extracts audio from video
- Detects speakers (male/female/child) automatically
- Segments dialogue by character
- User selects target language(s) and voice preferences (per gender/age or per character)
- AI transcribes → translates → re-synthesizes speech with time-alignment to original lip timing
- App outputs dubbed video with optional subtitle tracks and stylistic modes

### 2. System Architecture to Build

**Frontend (Web/Mobile)**
- Upload & Playback UI
- Language & Voice Selection interface
- Timeline Preview (optional advanced feature)

**Backend (Cloud - needs implementation)**

**Video Processing Service:**
- Audio extraction using FFmpeg
- Video chunking into 5-10 minute segments (critical for 2-hour videos)
- Parallel processing capability

**Speech Intelligence Pipeline:**
- Speaker diarization (detect who is speaking when)
- Age & gender classification per speaker
- Transcription per speaker with timestamps

**Translation Engine:**
- Context-aware translation
- Cultural adaptation (optional)

**Voice Synthesis Engine:**
- Multi-voice TTS system
- Emotional tone matching
- Support for multiple voices per language
- Voice consistency per character throughout video

**Timing Alignment Engine:**
- Duration matching to original speech
- Speed adjustment (±5-10%) without chipmunking
- Strategic pause insertion
- Maximum drift: 100-150ms from mouth movement

**Video Reassembly:**
- Audio track replacement
- Subtitle muxing
- Final video export

**Storage & Infrastructure:**
- Object storage for videos
- Job queue for long-running tasks
- GPU workers for TTS/ASR processing

### 3. Critical Technical Requirements

**Handling Long Videos (2 Hours):**
- MUST split videos into 5-10 minute chunks
- Process chunks in parallel
- Reassemble at the end
- Implement retry logic for failed chunks
- Prevent memory crashes

**Speaker Detection & Character Matching:**

Step 1 - Speaker Diarization:
- Segment audio by speaker with timestamps
- Output format: [00:01:02-00:01:10 → Speaker A]

Step 2 - Gender & Age Estimation:
- Classify each speaker with gender probability
- Estimate age range (child/teen/adult)
- ⚠️ Allow manual correction in UI (this is probabilistic, not perfect)

Step 3 - Character Voice Assignment:
- Default logic: Adult male → Male voice, Adult female → Female voice, Child → Child voice
- Advanced mode: User manually assigns voices per character
- Maintain consistent voice per character across entire video

**Voice Synthesis Features:**
- Multiple voices per language
- Emotional control (neutral, angry, comedic, etc.)
- Voice style options: Standard dub, Retro kung-fu dub, Cartoon, Documentary
- Same character = same voice throughout

**Lip Sync & Timing Alignment:**
- Match sentence duration to original
- Micro speed adjustments (±5-10%)
- Strategic pause placement
- Never drift more than ~100-150ms from mouth movement

### 4. Additional Features to Implement

**YouTube API Integration (Legal & Safe):**
- Fetch captions/transcripts (if enabled by video owner)
- Translate captions for practice
- Require users to upload their own video OR link video they own rights to
- Use captions as input-only, not for downloading copyrighted content

**Public Domain Video Library:**
- Include classic films, educational footage, government archives
- Provides legal demo content
- Allows users to test without uploading
- Great for marketing demonstrations

**Creator Collaboration Platform:**
- Shared projects with role-based access (Translator, Voice selector, Editor)
- Version history tracking
- Scene-level commenting system
- Multi-user workflow support

### 5. Development Phases

**MVP (Priority - Build This First):**
- Upload videos (≤30 min initially)
- Single target language support
- Automatic gender-based voice assignment
- Subtitles + dubbed output
- Basic UI for upload and language selection

**Phase 2:**
- 2-hour video support with chunking
- Character-level voice selection
- Manual override controls for speaker detection
- YouTube captions integration
- Public domain library

**Phase 3:**
- Collaboration features
- Style packs (retro, anime, documentary, etc.)
- Monetization implementation

### 6. Monetization Model to Implement
- **Free Tier:** Short videos, watermark on output
- **Pro Tier:** Long videos, HD quality, multi-language
- **Studio Tier:** Collaboration features, API access

## What I Need You to Do

1. **Analyze the current codebase** (if any files are present) and identify what's already implemented
2. **Build the missing backend services** focusing on the MVP features first
3. **Implement the video processing pipeline** with proper chunking for long videos
4. **Set up speaker diarization and voice synthesis** with the multi-character support
5. **Create API endpoints** that the Vercel Vo frontend can integrate with
6. **Ensure scalability** - the architecture should handle 2-hour videos efficiently
7. **Implement proper error handling** and retry logic for failed processing
8. **Add progress tracking** so users can see their video processing status
9. **Build the manual correction UI** for speaker/gender classification
10. **Create comprehensive documentation** for frontend integration

## Technical Constraints
- Must be deployable on Vercel or compatible cloud infrastructure
- Must handle videos up to 2 hours long
- Must process efficiently (parallel chunk processing)
- Must maintain <150ms audio drift from video
- Must support multiple languages and voice types
- Must allow manual overrides for AI decisions

## Integration Requirements
The completed backend needs to provide clear API endpoints that my Vercel Vo frontend can call for:
- Video upload
- Processing status checking
- Language/voice selection
- Output retrieval
- User authentication (if applicable)

Please begin by reviewing any existing code, then build out the missing components starting with the MVP features. Focus on creating a robust, scalable system that can handle the complexity of 2-hour multi-character video dubbing.
