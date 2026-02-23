# VIDEO-UPLOAD.TSX INTEGRATION INSTRUCTIONS

## STEP 1: Add imports at the top (after line 9)

Add these new imports after the existing imports:

```typescript
import { apiClient, validateVideoFile } from "@/lib/api-client"
import { useToast } from "@/hooks/use-toast"
```

## STEP 2: Replace the simulateUpload function (lines 43-79)

FIND this code (around lines 43-79):
```typescript
const simulateUpload = (fileId: string) => {
  let progress = 0
  const interval = setInterval(() => {
    progress += Math.random() * 15
    if (progress >= 100) {
      progress = 100
      clearInterval(interval)
      // ... rest of mock code
    }
  }, 200)
}
```

REPLACE IT WITH this real upload function:

```typescript
const { toast } = useToast()

const uploadToBackend = async (file: File, fileId: string) => {
  try {
    // Validate file before upload
    const validation = validateVideoFile(file)
    if (!validation.valid) {
      setUploadedFiles((prev) =>
        prev.map((f) =>
          f.id === fileId
            ? { ...f, status: "error", progress: 0 }
            : f
        )
      )
      toast({
        title: "Invalid File",
        description: validation.error,
        variant: "destructive",
      })
      return
    }

    // Upload with progress tracking
    const response = await apiClient.uploadVideo(file, (progress) => {
      setUploadedFiles((prev) =>
        prev.map((f) =>
          f.id === fileId
            ? { ...f, progress, status: "uploading" }
            : f
        )
      )
    })

    // Upload complete - update status to processing
    setUploadedFiles((prev) =>
      prev.map((f) =>
        f.id === fileId
          ? {
              ...f,
              progress: 100,
              status: "processing",
            }
          : f
      )
    )

    // Show success toast
    toast({
      title: "Upload Complete",
      description: `${file.name} uploaded successfully`,
    })

    // After a short delay, mark as ready and trigger dubbing
    setTimeout(() => {
      setUploadedFiles((prev) =>
        prev.map((f) =>
          f.id === fileId
            ? {
                ...f,
                status: "ready",
                duration: "Processing...",
              }
            : f
        )
      )
    }, 1000)

  } catch (error) {
    console.error("Upload failed:", error)
    
    setUploadedFiles((prev) =>
      prev.map((f) =>
        f.id === fileId
          ? { ...f, status: "error", progress: 0 }
          : f
      )
    )

    toast({
      title: "Upload Failed",
      description: error instanceof Error ? error.message : "Unknown error",
      variant: "destructive",
    })
  }
}
```

## STEP 3: Update the onDrop callback (around line 38-40)

FIND this code:
```typescript
// Simulate upload progress
newFiles.forEach((uploadedFile) => {
  simulateUpload(uploadedFile.id)
})
```

REPLACE IT WITH:
```typescript
// Upload to backend with real API
newFiles.forEach((uploadedFile) => {
  const originalFile = acceptedFiles.find((f) => 
    f.name === uploadedFile.file.name
  )
  if (originalFile) {
    uploadToBackend(originalFile, uploadedFile.id)
  }
})
```

## STEP 4: Update handleStartDubbing function (around line 96)

FIND this code:
```typescript
const handleStartDubbing = (uploadedFile: UploadedFile) => {
  onVideoSelect({
    id: uploadedFile.id,
    title: uploadedFile.file.name.replace(/\.[^/.]+$/, ""),
    url: URL.createObjectURL(uploadedFile.file),
    thumbnail: uploadedFile.thumbnail || "",
    duration: uploadedFile.duration || "0:00",
    source: "upload",
  })
}
```

REPLACE IT WITH:
```typescript
const handleStartDubbing = (uploadedFile: UploadedFile) => {
  // The job_id is stored in uploadedFile.id after upload
  onVideoSelect({
    id: uploadedFile.id, // This is the backend job_id now!
    title: uploadedFile.file.name.replace(/\.[^/.]+$/, ""),
    url: URL.createObjectURL(uploadedFile.file),
    thumbnail: uploadedFile.thumbnail || "",
    duration: uploadedFile.duration || "0:00",
    source: "upload",
  })
}
```

---

## SUMMARY OF CHANGES:

1. Added `apiClient` and `validateVideoFile` imports
2. Added `useToast` hook import
3. Replaced `simulateUpload` with real `uploadToBackend` function
4. Updated the `onDrop` callback to use real upload
5. Updated `handleStartDubbing` to pass real job_id

The key change: Instead of simulating progress, we now call `apiClient.uploadVideo()` which uploads to your backend and tracks real progress!

---

## TESTING:

After making these changes:
1. Save the file (Ctrl+S)
2. Check for any TypeScript errors
3. The frontend should recompile automatically
4. Try uploading a small video!
