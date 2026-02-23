# DubVerse Frontend-Backend Integration Plan

## Overview
Your v0 frontend is well-structured using Next.js 14 with App Router, TypeScript, and shadcn/ui. This guide shows exactly how to connect it to Verdant's Phase 1 backend.

## Current Frontend Architecture

```
DubVerse Frontend (v0)
├── dashboard.tsx (main orchestrator)
├── components/
│   ├── video-upload.tsx (drag & drop UI)
│   ├── dubbing-workspace.tsx (processing view)
│   ├── youtube-integration.tsx
│   ├── public-domain-library.tsx
│   └── recent-projects.tsx
└── types/
    ├── VideoSource (upload metadata)
    └── DetectedVoice (speaker data)
```

## Phase 1 Backend API (What Verdant is Building)

```
Backend Endpoints (FastAPI)
├── POST /api/upload          → Upload video, get job_id
├── GET /api/status/{job_id}  → Check processing status
├── GET /api/chunks/{job_id}  → Get chunk manifest
└── DELETE /api/job/{job_id}  → Cancel/cleanup job
```

---

## 🔧 Integration Steps

### Step 1: Create API Client Service

**File: `lib/api-client.ts`** (NEW FILE - I'll create this for you)

This centralizes all backend communication and handles:
- Base URL configuration
- Error handling
- Type safety
- Request/response formatting

### Step 2: Update Environment Variables

**File: `.env.local`** (NEW FILE)

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
# Will change to production URL later
```

### Step 3: Modify Video Upload Component

**File: `components/video-upload.tsx`** (UPDATE)

Current behavior: Mock upload simulation
New behavior: Real API call to backend

Changes needed:
1. Import API client
2. Replace mock upload with real `POST /api/upload`
3. Store job_id from response
4. Poll `GET /api/status/{job_id}` for progress

### Step 4: Update Dubbing Workspace

**File: `components/dubbing-workspace.tsx`** (UPDATE)

Current behavior: Simulated speaker detection
New behavior: Real data from backend

Changes needed:
1. Fetch real processing status
2. Display actual chunk progress
3. Show real file metadata

### Step 5: Add Progress Tracking Hook

**File: `hooks/use-job-status.ts`** (NEW FILE)

Custom React hook for polling job status with:
- Auto-refresh every 2 seconds
- Cleanup on unmount
- Error handling
- Status state management

---

## 📝 Type Definitions Needed

### Backend Response Types

```typescript
// Types matching Verdant's API responses

interface UploadResponse {
  job_id: string
  filename: string
  size: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
}

interface JobStatus {
  job_id: string
  status: 'pending' | 'extracting' | 'chunking' | 'completed' | 'failed'
  progress: number // 0-100
  current_step: string
  chunks?: ChunkManifest[]
  error?: string
}

interface ChunkManifest {
  chunk_id: string
  sequence: number
  start_time: number
  end_time: number
  duration: number
  file_path: string
}
```

---

## 🚀 Integration Workflow

### When User Uploads Video:

```
User drops video file
    ↓
Frontend: Show upload progress bar
    ↓
API Call: POST /api/upload (send FormData)
    ↓
Backend: Returns { job_id, status: 'pending' }
    ↓
Frontend: Store job_id, navigate to workspace
    ↓
Frontend: Start polling GET /api/status/{job_id}
    ↓
Backend: Returns status updates:
  - "extracting" (extracting audio)
  - "chunking" (splitting video)
  - "completed" (ready for next phase)
    ↓
Frontend: Display progress to user
    ↓
When completed: Show chunks ready message
```

---

## 🔌 Key Integration Points

### 1. Video Upload Component

**Before (Mock):**
```typescript
const handleUpload = (file: File) => {
  // Simulated upload
  setTimeout(() => {
    setProgress(100)
    onVideoSelect(mockVideo)
  }, 2000)
}
```

**After (Real):**
```typescript
const handleUpload = async (file: File) => {
  const formData = new FormData()
  formData.append('video', file)
  
  const response = await apiClient.uploadVideo(formData, (progress) => {
    setProgress(progress)
  })
  
  // Navigate to workspace with job_id
  onVideoSelect({
    id: response.job_id,
    title: file.name,
    source: 'upload'
  })
}
```

### 2. Dubbing Workspace Component

**Before (Mock):**
```typescript
const detectedVoices = [
  { id: '1', type: 'male', characterName: 'Speaker 1' },
  { id: '2', type: 'female', characterName: 'Speaker 2' }
]
```

**After (Real):**
```typescript
const { data: jobStatus, loading } = useJobStatus(video.id)

// Display real status
{jobStatus.status === 'extracting' && <p>Extracting audio...</p>}
{jobStatus.status === 'chunking' && <p>Processing chunks: {jobStatus.progress}%</p>}
{jobStatus.status === 'completed' && <p>Ready! {jobStatus.chunks.length} chunks created</p>}
```

---

## 🎯 Files I'll Create for You

Once Verdant delivers Phase 1 backend, I'll create these files to integrate it:

1. **`lib/api-client.ts`** - Complete API client with all endpoints
2. **`hooks/use-job-status.ts`** - Polling hook for status updates
3. **`types/backend.ts`** - TypeScript types for API responses
4. **`.env.local.example`** - Environment variable template
5. **Updated `components/video-upload.tsx`** - Real upload integration
6. **Updated `components/dubbing-workspace.tsx`** - Real status display

---

## ⚠️ Important Notes

### CORS Configuration Needed
Verdant's backend MUST include these CORS headers:
```python
# In FastAPI backend
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### File Size Limits
- Frontend: 10GB max (as per your current UI)
- Backend: Must match or handle appropriately
- Use chunked uploads for large files (>1GB)

### Error Handling Strategy
1. Network errors → Retry with exponential backoff
2. Upload fails → Allow resume/retry
3. Processing fails → Clear error message + support link

---

## 🧪 Testing Checklist (After Integration)

- [ ] Upload small video (<100MB) - should complete quickly
- [ ] Upload large video (2GB+) - should show progress smoothly
- [ ] Cancel upload mid-way - should cleanup properly
- [ ] Upload same file twice - should handle appropriately
- [ ] Network disconnect during upload - should error gracefully
- [ ] Check status polling stops after completion
- [ ] Verify chunk manifest displays correctly

---

## 📞 Next Steps - What You Need to Do

1. **Wait for Verdant to deliver Phase 1 code**
   - They should give you: FastAPI backend, endpoints, documentation

2. **Share with me immediately:**
   ```
   Claude, Verdant finished Phase 1!
   
   Backend repo: [link or code]
   API documentation: [endpoints list]
   Local URL: http://localhost:8000
   
   I'm able to run it: YES/NO
   Any errors: [describe if any]
   ```

3. **I'll then provide:**
   - Complete API client code
   - Updated components with real integration
   - Testing script to verify everything works
   - Deployment instructions

---

## 🎉 Why This Will Work Smoothly

✅ Your frontend is clean and well-structured
✅ State management is simple (useState, no complex Redux)
✅ Component separation is excellent
✅ TypeScript ensures type safety
✅ You have me (Claude) to guide every step

**Estimated integration time once Verdant delivers: 2-4 hours of work**

Most of it is straightforward find-and-replace of mock data with real API calls.

---

## Questions I'll Ask When Verdant Delivers:

1. What port is the backend running on? (probably 8000)
2. Does it include CORS headers?
3. What's the exact response format for each endpoint?
4. Any authentication needed (API keys, tokens)?
5. How are errors formatted?
6. Is there file upload progress callback?

Be ready to answer these or get them from Verdant!
