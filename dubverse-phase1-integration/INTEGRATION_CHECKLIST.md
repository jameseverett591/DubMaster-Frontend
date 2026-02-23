# 🚀 DubVerse Frontend-Backend Integration Checklist

## When Verdant Delivers Phase 1

### ✅ Step-by-Step Integration Process

---

## 📦 STEP 1: Receive & Setup Backend (5 minutes)

**When Verdant sends you the Phase 1 code:**

1. **Download/Clone the backend repository**
   ```bash
   git clone [verdant-repo-url]
   cd dubverse-backend
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   # OR
   pip install fastapi uvicorn python-multipart ffmpeg-python
   ```

3. **Run the backend locally**
   ```bash
   python main.py
   # OR
   uvicorn main:app --reload
   ```

4. **Verify it's running**
   - Open browser: `http://localhost:8000/docs`
   - You should see FastAPI documentation
   - Note the port number (probably 8000)

✅ **Checkpoint:** Backend is running and accessible

---

## 🧪 STEP 2: Test Backend (5 minutes)

1. **Run the test script I provided**
   ```bash
   cd [your-frontend-directory]
   node test-backend.js
   ```

2. **Expected results:**
   - ✅ Health check passes
   - ✅ Upload endpoint exists
   - ✅ Status endpoint exists
   - ⚠️ CORS might show warning (we'll fix this)

3. **If CORS fails:**
   - Ask Verdant to add CORS middleware
   - Share this code with them:
   ```python
   from fastapi.middleware.cors import CORSMiddleware
   
   app.add_middleware(
       CORSMiddleware,
       allow_origins=["http://localhost:3000"],
       allow_credentials=True,
       allow_methods=["*"],
       allow_headers=["*"],
   )
   ```

✅ **Checkpoint:** All backend tests pass

---

## 📁 STEP 3: Add Integration Files to Your Project (10 minutes)

**Copy these files from what I created:**

```
your-dubverse-project/
├── lib/
│   └── api-client.ts          ← Copy from my files
├── hooks/
│   └── use-job-status.ts      ← Copy from my files
├── .env.local.example         ← Copy from my files
└── .env.local                 ← Create this (don't commit!)
```

1. **Create the directories if they don't exist:**
   ```bash
   mkdir -p lib hooks
   ```

2. **Copy api-client.ts:**
   - Copy the entire file I created
   - Place it at: `lib/api-client.ts`

3. **Copy use-job-status.ts:**
   - Copy the entire file I created
   - Place it at: `hooks/use-job-status.ts`

4. **Setup environment variables:**
   ```bash
   cp .env.local.example .env.local
   ```
   
   Edit `.env.local`:
   ```env
   NEXT_PUBLIC_API_URL=http://localhost:8000
   ```

5. **Restart your Next.js dev server:**
   ```bash
   npm run dev
   # OR
   yarn dev
   ```

✅ **Checkpoint:** Integration files are in place

---

## 🔧 STEP 4: Update Video Upload Component (15 minutes)

**File: `components/video-upload.tsx`**

### What to Change:

1. **Add imports at the top:**
   ```typescript
   import { apiClient, validateVideoFile } from "@/lib/api-client"
   import { useToast } from "@/hooks/use-toast"
   ```

2. **Find your handleUpload function** (currently has mock/setTimeout logic)

3. **Replace it with the real implementation:**
   - Copy the `handleUpload` function from `video-upload-example.tsx` I created
   - Paste it into your actual `video-upload.tsx`
   
4. **Keep everything else the same:**
   - Your drag & drop UI
   - Your styling
   - Your progress bar component
   - Just change the upload logic

### Before vs After:

**BEFORE (Mock):**
```typescript
const handleUpload = (file: File) => {
  setTimeout(() => {
    setProgress(100)
    onVideoSelect({ id: 'mock-id', ... })
  }, 2000)
}
```

**AFTER (Real):**
```typescript
const handleUpload = async (file: File) => {
  const validation = validateVideoFile(file)
  if (!validation.valid) {
    toast({ title: "Error", description: validation.error })
    return
  }
  
  const response = await apiClient.uploadVideo(file, setProgress)
  onVideoSelect({ id: response.job_id, ... })
}
```

✅ **Checkpoint:** Upload component uses real API

---

## 📊 STEP 5: Update Dubbing Workspace Component (20 minutes)

**File: `components/dubbing-workspace.tsx`**

### What to Change:

1. **Add imports at the top:**
   ```typescript
   import { useJobStatus } from "@/hooks/use-job-status"
   import { getStatusMessage } from "@/lib/api-client"
   ```

2. **Add the polling hook inside your component:**
   ```typescript
   const { status, loading, error } = useJobStatus({
     jobId: video.id,
     pollInterval: 2000,
     onComplete: (finalStatus) => {
       console.log('Processing complete!', finalStatus)
     }
   })
   ```

3. **Replace mock speaker detection with real status display:**
   - Use the example from `dubbing-workspace-example.tsx` I created
   - Show different UI based on `status.status`:
     - `pending` → "Waiting to process..."
     - `extracting` → "Extracting audio..." + progress bar
     - `chunking` → "Splitting video..." + progress bar
     - `completed` → Show chunks ready message
     - `failed` → Show error message

4. **Keep your existing:**
   - Video player
   - Voice selector UI (it won't have data yet - that's Phase 2)
   - Timeline visualization
   - Transcript editor

### What You'll See After Integration:

- Upload a video → Real progress bar
- Navigate to workspace → See "Extracting audio..."
- Progress updates every 2 seconds automatically
- When complete → "Ready! 12 chunks created"

✅ **Checkpoint:** Workspace shows real processing status

---

## 🎯 STEP 6: Test End-to-End (30 minutes)

### Test 1: Small Video (Quick Test)
1. Find a small video file (< 100MB, ~1-2 minutes)
2. Upload it through your UI
3. Watch the progress bar
4. Verify you reach the workspace
5. Verify status updates appear
6. Check backend console for logs
7. Wait for "completed" status
8. Verify chunk count matches expectations

### Test 2: Medium Video (Real Test)
1. Use a 5-10 minute video
2. Upload and verify all steps work
3. Check that chunking creates multiple chunks
4. Verify progress updates smoothly

### Test 3: Error Handling
1. Try uploading an invalid file (PDF, image, etc.)
2. Verify error message appears
3. Try uploading too large file (>10GB)
4. Verify size validation works

### Common Issues & Solutions:

**Issue: "CORS error" in browser console**
- Solution: Backend needs CORS headers (see Step 2)

**Issue: "Network error during upload"**
- Solution: Check backend is still running
- Solution: Verify API_URL in .env.local is correct

**Issue: "Failed to fetch status"**
- Solution: Check job_id is being passed correctly
- Solution: Verify status endpoint exists

**Issue: Progress stuck at 0%**
- Solution: Check backend is processing the file
- Solution: Look at backend console logs

✅ **Checkpoint:** Full upload → process → status workflow works

---

## 📸 STEP 7: Document & Share Progress (10 minutes)

**Take screenshots showing:**
1. Video upload with progress bar
2. Dubbing workspace with "Extracting audio..." status
3. Completed status with chunk count
4. Browser console showing API calls (Network tab)

**Come back to Claude and share:**
```
Claude! Phase 1 integration is complete! 🎉

✅ Backend is running
✅ Upload works with real API
✅ Status polling works
✅ Can see chunk information

Here's what I'm seeing:
[paste screenshots or describe what you see]

Ready for Phase 2!
```

✅ **Checkpoint:** Phase 1 integration complete!

---

## 🚨 Troubleshooting Guide

### Problem: Backend won't start
**Symptoms:** Can't access http://localhost:8000
**Solutions:**
1. Check if port 8000 is already in use
2. Verify all dependencies installed
3. Check for Python errors in terminal
4. Ask Verdant for setup instructions

### Problem: Upload fails immediately
**Symptoms:** Error message right after selecting file
**Solutions:**
1. Check file size (< 10GB)
2. Check file format (MP4, MOV, AVI, MKV, WebM)
3. Check browser console for error details
4. Verify API URL in .env.local

### Problem: Status never updates
**Symptoms:** Stuck at "Connecting to server..."
**Solutions:**
1. Verify backend is processing (check console logs)
2. Confirm job_id is correct
3. Check status endpoint manually: `curl http://localhost:8000/api/status/[job_id]`
4. Verify polling is enabled (check useJobStatus hook)

### Problem: Upload shows 100% but workspace errors
**Symptoms:** Upload completes, then workspace shows error
**Solutions:**
1. Upload might have succeeded but processing failed
2. Check backend logs for errors
3. Verify video file isn't corrupted
4. Try a different video file

---

## 📞 When to Ask for Help

**Ask Verdant if:**
- Backend won't start after following their instructions
- API endpoints don't match expected format
- CORS errors persist after adding middleware
- Processing never completes (hangs forever)

**Ask Claude if:**
- Integration files aren't working as expected
- TypeScript errors in your components
- Need help debugging React/Next.js issues
- Want to add additional features

---

## 🎉 Success Criteria

Phase 1 integration is complete when:

- ✅ You can upload a video through the UI
- ✅ Upload progress bar shows real progress (0-100%)
- ✅ After upload, you see "Extracting audio..." status
- ✅ Status automatically updates without refresh
- ✅ Eventually see "Chunking video..." status
- ✅ Finally see "Processing complete! X chunks created"
- ✅ Can upload multiple videos in succession
- ✅ Error messages appear for invalid files

**When all ✅ are checked, you're ready for Phase 2!**

---

## 📅 What Happens Next (Phase 2)

Once Phase 1 is solid, Verdant will build:
- Speaker diarization (detect who's speaking)
- Gender/age classification (male, female, child)
- Transcription per speaker
- New API endpoints for speaker data

Then we'll integrate:
- Real speaker detection in workspace
- Voice selection based on detected speakers
- Translation preparation
- And more!

**Estimated time for Phase 1 integration: 2-3 hours**
**After that, you have a working video upload & processing pipeline!**
