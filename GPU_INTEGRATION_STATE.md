# DubVerse GPU Integration — Session State (2026-03-19)

## What Was Built This Session

### 1. RunPod Serverless Handler
- File: `C:\DEV\Dubverse\Dubverse Backend\handler.py`
- Accepts video URL, runs Demucs + Whisper/Paraformer + pyannote on GPU
- Returns transcript segments with speaker labels + diarization + speaker genders

### 2. RunPod Client Service
- File: `C:\DEV\Dubverse\Dubverse Backend\app\services\runpod_service.py`
- Async client: submit_job, check_status, poll_until_complete, run_gpu_pipeline
- API base: `https://api.runpod.ai/v2`

### 3. Routes Integration
- File: `C:\DEV\Dubverse\Dubverse Backend\app\api\routes.py`
- Added: `_should_use_gpu()`, `_run_runpod_gpu_pipeline()`, `/gpu-status` endpoint
- GPU path auto-falls back to CPU on failure
- Uses `/api/media/{job_id}/video` endpoint for RunPod to download files

### 4. GPU Docker Image
- Dockerfile: `C:\DEV\Dubverse\Dubverse Backend\Dockerfile.gpu` (updated for serverless)
- Requirements: `C:\DEV\Dubverse\Dubverse Backend\requirements.gpu.txt` (added funasr, modelscope, openai-whisper)
- Image: `jameseverett591/dubverse-backend:gpu-serverless` (16.6GB, on Docker Hub)
- Docker Hub user: `jameseverett591`

### 5. RunPod Configuration
- Endpoint ID: `mbjktrbdi22aw1`
- Template ID: `m5q9puning`
- API Key: `<REDACTED — was committed in plaintext since 2026-05-31 (17c73b97); rotate in RunPod dashboard, do not restore the value here>`
- GPUs: A40, A5000, RTX 4090
- Workers: 0-1, 60s idle timeout, 10min execution timeout, flashboot on
- Env vars set on template: HF_TOKEN, WHISPER_MODEL=medium, WHISPER_LANGUAGE=yue, diarization settings

### 6. .env Updates (C:\DEV\Dubverse\.env)
- `RUNPOD_API_KEY=<REDACTED — see note above; set the real value only in .env, never in a tracked file>`
- `RUNPOD_ENDPOINT_ID=mbjktrbdi22aw1`
- `PUBLIC_BASE_URL=` (EMPTY — needs ngrok URL)
- `PROCESSING_MODE=cpu` (needs changing to `gpu` or `auto`)

### 7. ngrok
- Downloaded to: `C:\DEV\ngrok\ngrok.exe`
- Needs auth token from ngrok.com dashboard
- Run: `C:\DEV\ngrok\ngrok.exe http 8000`
- Copy the https URL to PUBLIC_BASE_URL in .env

## Remaining Steps
1. Get ngrok auth token from https://dashboard.ngrok.com/get-started/your-authtoken
2. Run: `C:\DEV\ngrok\ngrok.exe config add-authtoken YOUR_TOKEN`
3. Run: `C:\DEV\ngrok\ngrok.exe http 8000`
4. Copy ngrok https URL to PUBLIC_BASE_URL in .env
5. Set PROCESSING_MODE=gpu in .env
6. Rebuild containers: `cd C:\DEV\Dubverse && docker compose up -d --build`
7. Upload video at http://localhost:3001 — should route to RunPod GPU
8. Future: smart routing (PROCESSING_MODE=auto) — free=CPU, paid=GPU

## Known Issues Still Open
- Paraformer merges fight scenes into 1 segment (needs diarization split)
- Cached transcript rehydration skips diarization (speaker_genders lost on restart)
- Tencent ASR 10MB limit (needs chunking)
- Root .env vs Backend .env diverge on some keys (only matters non-Docker)
