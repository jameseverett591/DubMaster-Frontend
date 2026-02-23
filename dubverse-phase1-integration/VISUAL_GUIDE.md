# 🎬 DubVerse Integration Workflow - Visual Guide

## 📊 Complete System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER BROWSER                             │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              DubVerse Frontend (v0/Next.js)              │  │
│  │                                                           │  │
│  │  ┌─────────────────┐  ┌──────────────────┐             │  │
│  │  │  VideoUpload    │  │ DubbingWorkspace │             │  │
│  │  │  Component      │  │   Component      │             │  │
│  │  │                 │  │                  │             │  │
│  │  │  - Drag & Drop  │  │  - Video Player  │             │  │
│  │  │  - File Select  │  │  - Status View   │             │  │
│  │  │  - Progress Bar │  │  - Progress Bar  │             │  │
│  │  └────────┬────────┘  └────────┬─────────┘             │  │
│  │           │                     │                        │  │
│  │           │    ┌────────────────┴──────────────┐        │  │
│  │           └───→│      apiClient.ts             │←───────┘  │
│  │                │                                │           │
│  │                │  - uploadVideo()               │           │
│  │                │  - getJobStatus()              │           │
│  │                │  - getChunks()                 │           │
│  │                └────────────┬───────────────────┘           │
│  │                             │                                │
│  └─────────────────────────────┼────────────────────────────────┘
│                                 │                                │
└─────────────────────────────────┼────────────────────────────────┘
                                  │
                         HTTP/REST API
                                  │
┌─────────────────────────────────┼────────────────────────────────┐
│                                 ↓                                 │
│              Backend Server (Verdant's FastAPI)                   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    API Endpoints                          │   │
│  │                                                           │   │
│  │  POST /api/upload          → Upload video file           │   │
│  │  GET  /api/status/{id}     → Get processing status       │   │
│  │  GET  /api/chunks/{id}     → Get chunk manifest          │   │
│  │  DELETE /api/job/{id}      → Cancel job                  │   │
│  │  GET  /health              → Health check                │   │
│  └─────────────────────┬──────────────────────────────────────┘   │
│                        │                                          │
│  ┌────────────────────┴───────────────────────────────────┐      │
│  │           Video Processing Pipeline                     │      │
│  │                                                          │      │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │      │
│  │  │   FFmpeg     │  │   Chunking   │  │   Storage    │ │      │
│  │  │  Extraction  │→→│   Service    │→→│   Manager    │ │      │
│  │  │              │  │              │  │              │ │      │
│  │  │ Extract      │  │ Split into   │  │ Save chunks  │ │      │
│  │  │ audio from   │  │ 5-10 min     │  │ Track        │ │      │
│  │  │ video        │  │ segments     │  │ metadata     │ │      │
│  │  └──────────────┘  └──────────────┘  └──────────────┘ │      │
│  └──────────────────────────────────────────────────────────┘      │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                  Job Queue & Status                       │   │
│  │                                                           │   │
│  │  job_12345: { status: "extracting", progress: 45% }     │   │
│  │  job_67890: { status: "chunking", progress: 78% }       │   │
│  │  job_abcde: { status: "completed", chunks: [...] }      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   File Storage                            │   │
│  │                                                           │   │
│  │  /uploads/      → Original video files                   │   │
│  │  /processed/    → Extracted audio files                  │   │
│  │  /chunks/       → Video chunks (5-10 min each)           │   │
│  │  /output/       → Final dubbed videos (Phase 2+)         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

---

## 🔄 User Upload Flow (Step-by-Step)

```
Step 1: User selects video
┌────────────────┐
│     User       │
│  drops video   │
│   into UI      │
└───────┬────────┘
        │
        ↓
┌────────────────────────────────┐
│  VideoUpload Component         │
│  - Validates file              │
│  - Shows upload progress       │
└───────┬────────────────────────┘
        │
        ↓ apiClient.uploadVideo(file, onProgress)
        │
┌───────┴────────────────────────┐
│  Backend receives file         │
│  - Saves to /uploads/          │
│  - Creates job_id              │
│  - Returns: { job_id, status } │
└───────┬────────────────────────┘
        │
        ↓
┌───────────────────────────────┐
│  Frontend receives job_id     │
│  - Navigates to workspace     │
│  - Starts polling for status  │
└───────────────────────────────┘
```

---

## ⏱️ Status Polling Flow

```
┌─────────────────────────────────────────────────────────────┐
│                   DubbingWorkspace                          │
│                                                              │
│  const { status } = useJobStatus({ jobId: video.id })      │
│                                                              │
│  Polling starts automatically                                │
└────────────────┬────────────────────────────────────────────┘
                 │
                 │ Every 2 seconds
                 ↓
     ┌──────────────────────────┐
     │ GET /api/status/{job_id} │
     └─────────┬────────────────┘
               │
               ↓
     ┌─────────────────────────────────────┐
     │ Backend returns current status:     │
     │                                     │
     │ { status: "extracting",             │
     │   progress: 45,                     │
     │   current_step: "Extracting audio"  │
     │ }                                   │
     └─────────┬───────────────────────────┘
               │
               ↓
     ┌─────────────────────────────┐
     │ Frontend updates UI         │
     │ - Progress bar: 45%         │
     │ - Message: "Extracting..."  │
     └─────────────────────────────┘
               │
               │ Continue polling...
               ↓
     ┌──────────────────────────────┐
     │ Status changes to "chunking" │
     └─────────┬────────────────────┘
               │
               ↓
     ┌─────────────────────────────┐
     │ UI updates automatically    │
     │ - New message               │
     │ - Updated progress          │
     └─────────────────────────────┘
               │
               │ Keep polling...
               ↓
     ┌──────────────────────────────┐
     │ Status: "completed"          │
     │ Chunks: [12 chunks created]  │
     └─────────┬────────────────────┘
               │
               ↓
     ┌─────────────────────────────┐
     │ Polling STOPS automatically │
     │ Shows success message       │
     │ Ready for Phase 2!          │
     └─────────────────────────────┘
```

---

## 📦 File Structure After Integration

```
your-dubverse-project/
│
├── app/
│   ├── dashboard.tsx              ← Your existing file
│   └── ...
│
├── components/
│   ├── video-upload.tsx           ← UPDATE THIS (add API calls)
│   ├── dubbing-workspace.tsx      ← UPDATE THIS (add polling)
│   ├── youtube-integration.tsx    ← Keep as-is (Phase 2)
│   └── ...
│
├── lib/
│   └── api-client.ts              ← NEW FILE (copy from package)
│
├── hooks/
│   └── use-job-status.ts          ← NEW FILE (copy from package)
│
├── .env.local                      ← NEW FILE (create from example)
├── .env.local.example              ← NEW FILE (copy from package)
│
└── package.json
```

---

## 🔌 API Endpoint Details

### POST /api/upload

**Request:**
```javascript
const formData = new FormData()
formData.append('video', file)

fetch('http://localhost:8000/api/upload', {
  method: 'POST',
  body: formData
})
```

**Response:**
```json
{
  "job_id": "abc-123-def-456",
  "filename": "my-video.mp4",
  "size": 125829120,
  "status": "pending"
}
```

---

### GET /api/status/{job_id}

**Request:**
```javascript
fetch('http://localhost:8000/api/status/abc-123-def-456')
```

**Response (Extracting):**
```json
{
  "job_id": "abc-123-def-456",
  "status": "extracting",
  "progress": 45,
  "current_step": "Extracting audio from video"
}
```

**Response (Completed):**
```json
{
  "job_id": "abc-123-def-456",
  "status": "completed",
  "progress": 100,
  "current_step": "Processing complete",
  "chunks": [
    {
      "chunk_id": "chunk-1",
      "sequence": 1,
      "start_time": 0,
      "end_time": 600,
      "duration": 600
    },
    {
      "chunk_id": "chunk-2",
      "sequence": 2,
      "start_time": 600,
      "end_time": 1200,
      "duration": 600
    }
  ]
}
```

---

## 🎨 UI States to Implement

### State 1: Upload in Progress
```
┌────────────────────────────────┐
│  Uploading my-video.mp4...     │
│                                 │
│  ████████████░░░░░░░  65%      │
│                                 │
│  Uploaded 815 MB / 1.2 GB      │
└────────────────────────────────┘
```

### State 2: Processing (Extracting)
```
┌────────────────────────────────┐
│  Processing Video              │
│                                 │
│  ⟳ Extracting audio...         │
│                                 │
│  ████████░░░░░░░░░░  45%       │
│                                 │
│  This may take a few minutes   │
└────────────────────────────────┘
```

### State 3: Processing (Chunking)
```
┌────────────────────────────────┐
│  Processing Video              │
│                                 │
│  ⟳ Splitting into segments...  │
│                                 │
│  ████████████████░░  85%       │
│                                 │
│  Almost done!                  │
└────────────────────────────────┘
```

### State 4: Complete
```
┌────────────────────────────────┐
│  ✓ Processing Complete!        │
│                                 │
│  Your video has been processed │
│  into 12 segments.             │
│                                 │
│  Ready for dubbing!            │
│                                 │
│  [View Segments]  [Start Over] │
└────────────────────────────────┘
```

### State 5: Error
```
┌────────────────────────────────┐
│  ✗ Processing Failed           │
│                                 │
│  Error: Unable to extract      │
│  audio from video file         │
│                                 │
│  Please try:                   │
│  • Different video format      │
│  • Smaller file size           │
│  • Contact support             │
│                                 │
│  [Try Again]  [Go Back]        │
└────────────────────────────────┘
```

---

## 🚦 Integration Checkpoints

```
START
  │
  ↓
✓ Backend running at http://localhost:8000
  │
  ↓
✓ test-backend.js passes all tests
  │
  ↓
✓ Integration files copied to project
  │
  ↓
✓ .env.local created with API URL
  │
  ↓
✓ video-upload.tsx updated with real API
  │
  ↓
✓ dubbing-workspace.tsx updated with polling
  │
  ↓
✓ Small video upload test succeeds
  │
  ↓
✓ Status updates appear automatically
  │
  ↓
✓ Processing completes successfully
  │
  ↓
✓ Chunk information displays
  │
  ↓
SUCCESS! Phase 1 Complete! 🎉
  │
  ↓
Ready for Phase 2 (Speaker Detection)
```

---

## 💡 Key Concepts

### Job ID
- Unique identifier for each video processing job
- Returned from upload, used for all subsequent requests
- Example: `"abc-123-def-456"`
- Store it in your VideoSource.id field

### Status Polling
- Check processing status every 2 seconds
- Automatically stops when complete or failed
- Prevents overwhelming the server
- Provides smooth progress updates

### Chunking
- Videos split into 5-10 minute segments
- Enables parallel processing
- Required for 2-hour videos
- Each chunk has: start time, end time, duration

### Progress Tracking
- Upload: 0-100% (file transfer)
- Extracting: 0-100% (audio extraction)
- Chunking: 0-100% (video splitting)
- Shows user where things are

---

*This visual guide complements the integration checklist and plan.*
*Use it as a reference while integrating!*
