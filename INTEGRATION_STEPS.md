# 🔌 FRONTEND INTEGRATION - STEP BY STEP

## 📥 STEP 1: Add the Integration Files

You need to add 3 files to your frontend project:

### File 1: `lib/api-client.ts`
**Location:** `C:\Users\james\dubverse-frontend\lib\api-client.ts`

1. In VS Code (with dubverse-frontend open)
2. Right-click on the `lib` folder
3. Select "New File"
4. Name it: `api-client.ts`
5. Copy the contents from `api-client-for-frontend.ts` (I created this for you)
6. Paste into the new file
7. Save (Ctrl+S)

### File 2: `hooks/use-job-status.ts`
**Location:** `C:\Users\james\dubverse-frontend\hooks\use-job-status.ts`

1. Right-click on the `hooks` folder
2. Select "New File"
3. Name it: `use-job-status.ts`
4. Copy the contents from `use-job-status-for-frontend.ts`
5. Paste into the new file
6. Save (Ctrl+S)

### File 3: `.env.local`
**Location:** `C:\Users\james\dubverse-frontend\.env.local`

1. Right-click on the root folder (DUBVERSE-FRONTEND)
2. Select "New File"
3. Name it: `.env.local` (yes, with the dot at the beginning!)
4. Copy the contents from `env.local`
5. Paste into the new file
6. Save (Ctrl+S)

---

## 📝 STEP 2: Update video-upload.tsx

**Location:** `components/video-upload.tsx`

### What to add at the top of the file:

```typescript
import { apiClient, validateVideoFile } from "@/lib/api-client"
import { useToast } from "@/hooks/use-toast"
```

### Find your current upload handler (probably looks like this):

```typescript
const handleUpload = (file: File) => {
  // Mock/simulated upload
  setTimeout(() => {
    onVideoSelect(mockVideo)
  }, 2000)
}
```

### Replace it with this REAL implementation:

```typescript
const [uploading, setUploading] = useState(false)
const [uploadProgress, setUploadProgress] = useState(0)
const { toast } = useToast()

const handleUpload = async (file: File) => {
  // Validate file
  const validation = validateVideoFile(file)
  if (!validation.valid) {
    toast({
      title: "Invalid File",
      description: validation.error,
      variant: "destructive"
    })
    return
  }

  try {
    setUploading(true)
    setUploadProgress(0)

    // Upload to backend with progress tracking
    const response = await apiClient.uploadVideo(file, (progress) => {
      setUploadProgress(progress)
    })

    // Success!
    toast({
      title: "Upload Complete",
      description: `${file.name} uploaded successfully`
    })

    // Navigate to workspace with real job_id
    onVideoSelect({
      id: response.job_id,  // THIS IS THE KEY - real backend job ID
      title: file.name,
      url: URL.createObjectURL(file),
      thumbnail: "",
      duration: "Processing...",
      source: 'upload'
    })

  } catch (error) {
    console.error("Upload failed:", error)
    
    toast({
      title: "Upload Failed",
      description: error instanceof Error ? error.message : "Unknown error",
      variant: "destructive"
    })
  } finally {
    setUploading(false)
    setUploadProgress(0)
  }
}
```

---

## 📝 STEP 3: Update dubbing-workspace.tsx

**Location:** `components/dubbing-workspace.tsx`

### Add these imports at the top:

```typescript
import { useJobStatus } from "@/hooks/use-job-status"
import { getStatusMessage } from "@/lib/api-client"
```

### Inside your component, add the polling hook:

```typescript
export function DubbingWorkspace({ video, onClose }) {
  // This hook automatically polls the backend every 2 seconds
  const { status, loading, error } = useJobStatus({
    jobId: video.id,  // This is the job_id from upload
    pollInterval: 2000,
    onComplete: (finalStatus) => {
      console.log('Processing complete!', finalStatus)
      // You can show a success toast here
    },
    onError: (errorMessage) => {
      console.error('Processing failed:', errorMessage)
      // You can show an error toast here
    }
  })

  // Show loading state
  if (loading && !status) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p>Connecting to server...</p>
        </div>
      </div>
    )
  }

  // Show error state
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-red-500 mb-4">Error: {error}</p>
          <button onClick={onClose}>Back to Dashboard</button>
        </div>
      </div>
    )
  }

  // Show processing state
  if (status && (status.status === 'pending' || status.status === 'processing')) {
    return (
      <div className="p-8">
        <h2 className="text-2xl font-bold mb-4">Processing Video</h2>
        <div className="bg-muted rounded-lg p-6 mb-4">
          <p className="font-semibold mb-2">{getStatusMessage(status.status)}</p>
          <p className="text-sm text-muted-foreground mb-4">{status.current_step}</p>
          
          {/* Progress bar */}
          <div className="w-full bg-secondary rounded-full h-2 mb-2">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${status.progress}%` }}
            />
          </div>
          <p className="text-sm text-right">{status.progress}%</p>
        </div>
        
        {/* Video preview if available */}
        {video.url && (
          <video src={video.url} controls className="w-full rounded-lg" />
        )}
      </div>
    )
  }

  // Show completed state
  if (status && status.status === 'completed') {
    return (
      <div className="p-8">
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-6 mb-4">
          <h2 className="text-2xl font-bold text-green-500 mb-2">✓ Processing Complete!</h2>
          <p>Your video has been processed into {status.chunks?.length || 0} chunks</p>
        </div>
        
        {/* Show chunk information */}
        {status.chunks && status.chunks.length > 0 && (
          <div className="bg-muted rounded-lg p-6">
            <h3 className="font-semibold mb-4">Video Segments</h3>
            <div className="space-y-2">
              {status.chunks.map((chunk, index) => (
                <div key={chunk.chunk_id} className="flex justify-between text-sm">
                  <span>Chunk {index + 1}</span>
                  <span className="text-muted-foreground">
                    {Math.floor(chunk.start_time)}s - {Math.floor(chunk.end_time)}s
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Keep your existing UI for other states
  return (
    <div>{/* Your existing workspace UI */}</div>
  )
}
```

---

## 🔄 STEP 4: Restart Your Frontend Dev Server

1. In VS Code terminal (open a NEW terminal, not the backend one)
2. Make sure you're in the dubverse-frontend directory
3. Run:
   ```bash
   npm run dev
   ```
4. Wait for it to start
5. Should open at `http://localhost:3000`

---

## ✅ STEP 5: TEST IT!

### Test Flow:
1. Backend running at `localhost:8000` ✓ (already done!)
2. Frontend running at `localhost:3000` (about to start)
3. Open browser to `http://localhost:3000`
4. Upload a small video (2-3 minutes)
5. Watch the progress bar (real progress!)
6. See the workspace open
7. Status should update automatically every 2 seconds
8. Eventually see "Processing complete!" with chunk count

---

## 🐛 TROUBLESHOOTING

### Issue: "Cannot find module '@/lib/api-client'"
**Solution:** Make sure you saved the file as `api-client.ts` in the `lib/` folder

### Issue: "CORS error" in browser console
**Solution:** Backend needs CORS enabled (should already be there from Verdant)

### Issue: Upload button doesn't work
**Solution:** Check browser console (F12) for errors, share them with Claude

### Issue: Status doesn't update
**Solution:** 
- Check backend is still running
- Check browser Network tab (F12) for API calls
- Make sure job_id is being passed correctly

---

## 📸 NEXT STEPS FOR YOU:

1. Create the 3 files (api-client.ts, use-job-status.ts, .env.local)
2. Update video-upload.tsx
3. Update dubbing-workspace.tsx
4. Start frontend dev server
5. Test upload!

**Let me know when you're ready to start or if you need help with any step!**
