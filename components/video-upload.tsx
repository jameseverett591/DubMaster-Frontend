"use client"

import { useState, useCallback } from "react"
import { useDropzone } from "react-dropzone"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Upload, FileVideo, X, CheckCircle2, AlertCircle } from "lucide-react"
import type { VideoSource } from "@/components/dashboard"
import { apiClient, validateVideoFile } from "@/lib/api-client"
import { useToast } from "@/hooks/use-toast"
interface VideoUploadProps {
  onVideoSelect: (video: VideoSource) => void
}

type UploadedFile = {
  file: File
  id: string
  progress: number
  status: "uploading" | "processing" | "ready" | "error"
  thumbnail?: string
  duration?: string
}

export function VideoUpload({ onVideoSelect }: VideoUploadProps) {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
const { toast } = useToast()
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles = acceptedFiles.map((file) => ({
      file,
      id: Math.random().toString(36).substring(7),
      progress: 0,
      status: "uploading" as const,
    }))

    setUploadedFiles((prev) => [...prev, ...newFiles])

// Upload to backend with real API
newFiles.forEach((uploadedFile) => {
  const originalFile = acceptedFiles.find((f) => 
    f.name === uploadedFile.file.name
  )
  if (originalFile) {
    uploadToBackend(originalFile, uploadedFile.id)
  }
})
  }, []    )

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

    // Upload complete - update with backend job_id and set to processing
    setUploadedFiles((prev) =>
      prev.map((f) =>
        f.id === fileId
          ? {
              ...f,
              id: response.job_id,
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

    // After a short delay, mark as ready
    setTimeout(() => {
      setUploadedFiles((prev) =>
        prev.map((f) =>
          f.id === response.job_id
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
  const formatDuration = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const removeFile = (fileId: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId))
  }

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

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "video/*": [".mp4", ".mov", ".avi", ".mkv", ".webm"],
    },
    maxSize: 10 * 1024 * 1024 * 1024, // 10GB max
  })

  return (
    <div className="space-y-8">
      <Card className="border-dashed backdrop-blur-md bg-card/50 border-border/50">
        <CardHeader>
          <CardTitle>Upload Your Video</CardTitle>
          <CardDescription>
            Upload videos up to 2 hours long. Supported formats: MP4, MOV, AVI, MKV, WebM
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            {...getRootProps()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 transition-colors ${
              isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/50"
            }`}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="rounded-full bg-primary/10 p-4">
                <Upload className="h-8 w-8 text-primary" />
              </div>
              <div>
                <p className="text-lg font-medium text-foreground">
                  {isDragActive ? "Drop your video here" : "Drag and drop your video"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">or click to browse from your computer</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-full bg-muted px-3 py-1">Max 2 hours</span>
                <span className="rounded-full bg-muted px-3 py-1">Up to 10GB</span>
                <span className="rounded-full bg-muted px-3 py-1">4K supported</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {uploadedFiles.length > 0 && (
        <Card className="backdrop-blur-md bg-card/50 border-border/50">
          <CardHeader>
            <CardTitle>Uploaded Videos</CardTitle>
            <CardDescription>Your videos are ready for dubbing</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {uploadedFiles.map((uploadedFile) => (
                <div
                  key={uploadedFile.id}
                  className="flex items-center gap-4 rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex h-16 w-24 items-center justify-center rounded-lg bg-muted">
                    {uploadedFile.status === "ready" && uploadedFile.thumbnail ? (
                      <img
                        src={uploadedFile.thumbnail || "/placeholder.svg"}
                        alt={uploadedFile.file.name}
                        className="h-full w-full rounded-lg object-cover"
                      />
                    ) : (
                      <FileVideo className="h-8 w-8 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-foreground">{uploadedFile.file.name}</p>
                      <Button variant="ghost" size="icon" onClick={() => removeFile(uploadedFile.id)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                      <span>{(uploadedFile.file.size / (1024 * 1024)).toFixed(1)} MB</span>
                      {uploadedFile.duration && (
                        <>
                          <span>•</span>
                          <span>{uploadedFile.duration}</span>
                        </>
                      )}
                    </div>
                    {uploadedFile.status === "uploading" && (
                      <div className="mt-2">
                        <Progress value={uploadedFile.progress} className="h-1.5" />
                        <p className="mt-1 text-xs text-muted-foreground">
                          Uploading... {Math.round(uploadedFile.progress)}%
                        </p>
                      </div>
                    )}
                    {uploadedFile.status === "processing" && (
                      <div className="mt-2 flex items-center gap-2 text-sm text-amber-500">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
                        Processing video...
                      </div>
                    )}
                    {uploadedFile.status === "ready" && (
                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm text-green-500">
                          <CheckCircle2 className="h-4 w-4" />
                          Ready for dubbing
                        </div>
                        <Button size="sm" onClick={() => handleStartDubbing(uploadedFile)}>
                          Start Dubbing
                        </Button>
                      </div>
                    )}
                    {uploadedFile.status === "error" && (
                      <div className="mt-2 flex items-center gap-2 text-sm text-destructive">
                        <AlertCircle className="h-4 w-4" />
                        Upload failed. Please try again.
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
       