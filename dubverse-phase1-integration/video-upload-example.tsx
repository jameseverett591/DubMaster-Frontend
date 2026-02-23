/**
 * EXAMPLE: Updated Video Upload Component
 * This shows how to integrate your existing video-upload.tsx with the real backend API
 * 
 * INSTRUCTIONS FOR INTEGRATION:
 * 1. Copy the handleUpload function to your actual video-upload.tsx
 * 2. Add the imports at the top
 * 3. Replace the mock upload logic with this real implementation
 * 4. Keep your existing UI components (drag & drop, progress bar, etc.)
 */

"use client"

import { useState, useCallback } from "react"
import { apiClient, validateVideoFile, formatFileSize } from "@/lib/api-client"
import { VideoSource } from "@/app/dashboard"
import { useToast } from "@/hooks/use-toast"

interface VideoUploadProps {
  onVideoSelect: (video: VideoSource) => void
}

export function VideoUpload({ onVideoSelect }: VideoUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const { toast } = useToast()

  /**
   * Handle video file upload to backend
   * This replaces your mock upload function
   */
  const handleUpload = useCallback(async (file: File) => {
    // Step 1: Validate the file
    const validation = validateVideoFile(file)
    if (!validation.valid) {
      toast({
        title: "Invalid File",
        description: validation.error,
        variant: "destructive",
      })
      return
    }

    try {
      setUploading(true)
      setUploadProgress(0)
      setSelectedFile(file)

      // Step 2: Upload to backend with progress tracking
      const response = await apiClient.uploadVideo(file, (progress) => {
        setUploadProgress(progress)
      })

      // Step 3: Upload complete! Navigate to dubbing workspace
      toast({
        title: "Upload Complete",
        description: `${file.name} uploaded successfully`,
      })

      // Step 4: Pass the job to the workspace
      const videoSource: VideoSource = {
        id: response.job_id, // This is the key - the backend's job ID
        title: file.name,
        url: URL.createObjectURL(file), // For local preview
        thumbnail: "", // Could generate thumbnail later
        duration: "Processing...", // Will be determined during processing
        source: "upload",
      }

      onVideoSelect(videoSource)

    } catch (error) {
      console.error("Upload failed:", error)
      
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive",
      })
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }, [onVideoSelect, toast])

  /**
   * Handle file drop
   */
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) {
      handleUpload(file)
    }
  }, [handleUpload])

  /**
   * Handle file input change
   */
  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleUpload(file)
    }
  }, [handleUpload])

  return (
    <div className="space-y-6">
      {/* YOUR EXISTING UI COMPONENTS GO HERE */}
      {/* Keep your current drag & drop UI, styling, etc. */}
      
      <div
        className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer hover:border-primary transition"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => document.getElementById('file-input')?.click()}
      >
        {uploading ? (
          <div className="space-y-4">
            <p className="text-lg">Uploading {selectedFile?.name}...</p>
            <div className="w-full bg-secondary rounded-full h-2">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <p className="text-sm text-muted-foreground">{uploadProgress}%</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xl font-semibold">Drop your video here</p>
            <p className="text-muted-foreground">
              or click to browse from your computer
            </p>
            <p className="text-sm text-muted-foreground">
              Max 2 hours • Up to 10GB • 4K supported
            </p>
          </div>
        )}
      </div>

      <input
        id="file-input"
        type="file"
        accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm"
        onChange={handleFileInput}
        className="hidden"
      />

      {/* Info section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-lg bg-muted">
          <h3 className="font-semibold mb-2">Supported Formats</h3>
          <p className="text-sm text-muted-foreground">MP4, MOV, AVI, MKV, WebM</p>
        </div>
        <div className="p-4 rounded-lg bg-muted">
          <h3 className="font-semibold mb-2">Maximum Duration</h3>
          <p className="text-sm text-muted-foreground">Up to 2 hours</p>
        </div>
        <div className="p-4 rounded-lg bg-muted">
          <h3 className="font-semibold mb-2">File Size Limit</h3>
          <p className="text-sm text-muted-foreground">Up to 10GB</p>
        </div>
      </div>
    </div>
  )
}

/**
 * KEY CHANGES FROM MOCK TO REAL:
 * 
 * BEFORE (Mock):
 * - setTimeout(() => { setProgress(100); onVideoSelect(mockVideo) }, 2000)
 * 
 * AFTER (Real):
 * - const response = await apiClient.uploadVideo(file, onProgress)
 * - onVideoSelect({ id: response.job_id, ... })
 * 
 * The video.id is now the backend's job_id, which is used to:
 * - Poll for status updates
 * - Fetch processing results
 * - Download the final dubbed video
 */
