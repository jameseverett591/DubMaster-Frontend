# DubVerse – System Context

## Project Overview
DubVerse is an AI-powered video dubbing platform focused on **natural, expressive, culturally authentic voice dubbing**.

The goal is NOT robotic TTS.
The goal IS:
- Emotion
- Personality
- Cultural accents
- Natural pacing
- Correct age/gender voices
- High-quality preview before export

## Core Requirements
1. Voices must sound HUMAN, not monotone or generic
2. Jamaican voices must sound Jamaican
3. Spanish voices must sound Spanish (regional accents matter)
4. Children must NEVER be assigned adult voices
5. Voice preview must match final export audio
6. Target language selection must be respected everywhere (UI, preview, backend, export)

## Architecture
Frontend:
- Next.js (App Router)
- Port: 3001
- Tailwind CSS
- Preview must use real synthesized audio, not placeholders

Backend:
- FastAPI
- Port: 8000
- Background job processing
- Explicit voice_id per speaker
- Explicit language_code per job
- Translation MUST occur before TTS

## Known Problems to Actively Guard Against
- Preview audio using a default voice instead of selected voice
- Export working while preview is incorrect
- Language dropdown not affecting backend requests
- Child voice mapped to adult voice
- UI panels overflowing or being cut off
- Fake progress indicators

## Rules for AI Assistance
- NEVER assume preview == export
- ALWAYS trace voice_id from UI → API → TTS
- ALWAYS trace language_code from UI → translation → TTS
- Prefer correctness over speed
- No placeholder logic in production paths

## Current Priority Tasks
1. Fix preview audio to use selected voice_id
2. Fix language propagation end-to-end
3. Add real preview player for dubbed output
4. Add pitch / speed / timing controls
5. Fix layout overflow and clipped panels
