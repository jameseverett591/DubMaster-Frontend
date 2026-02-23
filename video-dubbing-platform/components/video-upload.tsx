"use client"

import { useState, useCallback } from "react"
import { useDropzone } from "react-dropzone"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Upload, FileVideo, X, CheckCircle2, AlertCircle } from "lucide-react"
import type { VideoSource } from "@/components/dashboard"

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

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles = acceptedFiles.map((file) => ({
      file,
      id: Math.random().toString(36).substring(7),
      progress: 0,
      status: "uploading" as const,
    }))

    setUploadedFiles((prev) => [...prev, ...newFiles])

    // Simulate upload progress
    newFiles.forEach((uploadedFile) => {
      simulateUpload(uploadedFile.id)
    })
  }, [])

  const simulateUpload = (fileId: string) => {
    let progress = 0
    const interval = setInterval(() => {
      progress += Math.random() * 15
      if (progress >= 100) {
        progress = 100
        clearInterval(interval)
        setUploadedFiles((prev) =>
          prev.map((f) =>
            f.id === fileId
              ? {
                  ...f,
                  progress: 100,
                  status: "processing",
                }
              : f,
          ),
        )
        // Simulate processing
        setTimeout(() => {
          setUploadedFiles((prev) =>
            prev.map((f) =>
              f.id === fileId
                ? {
                    ...f,
                    status: "ready",
                    thumbnail: "/uploaded-video-thumbnail.png",
                    duration: formatDuration(Math.floor(Math.random() * 7200)),
                  }
                : f,
            ),
          )
        }, 2000)
      } else {
        setUploadedFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, progress } : f)))
      }
    }, 200)
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
          </CardContent>
        </Card>
      )}
    </div>
  )
}
