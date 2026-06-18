"use client"

import { useState, useCallback, useEffect } from "react"
import { FileDropzone } from "./file-dropzone"
import { UploadProgress, UploadStatus } from "./upload-progress"
import { VideoCard, VideoMetadata } from "./video-card"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card"
import { Button } from "./button"
import { RefreshCw, Grid3X3, List, Upload } from "lucide-react"
import { cn } from "@/lib/utils"

interface FileWithPreview extends File {
  preview?: string
}

interface VideoUploaderProps {
  onUploadComplete?: (video: VideoMetadata) => void
  onVideoSelect?: (video: VideoMetadata) => void
  className?: string
  maxFiles?: number
  maxFileSize?: number
}

type ViewMode = 'grid' | 'list'

export function VideoUploader({
  onUploadComplete,
  onVideoSelect,
  className,
  maxFiles = 10,
  maxFileSize = 2 * 1024 * 1024 * 1024 // 2GB
}: VideoUploaderProps) {
  const [uploads, setUploads] = useState<UploadStatus[]>([])
  const [videos, setVideos] = useState<VideoMetadata[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')

  // Fetch existing videos
  const fetchVideos = useCallback(async () => {
    try {
      setIsLoading(true)
      const response = await fetch('/api/videos')
      if (response.ok) {
        const data = await response.json()
        setVideos(data.videos || [])
      }
    } catch (error) {
      console.error('Failed to fetch videos:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchVideos()
  }, [fetchVideos])

  // Handle file selection from dropzone
  const handleFilesSelected = useCallback((files: FileWithPreview[]) => {
    const newUploads: UploadStatus[] = files.map(file => ({
      id: Math.random().toString(36).substring(7),
      file,
      progress: 0,
      status: 'pending'
    }))

    setUploads(prev => [...prev, ...newUploads])

    // Start uploading each file
    newUploads.forEach(upload => {
      uploadFile(upload)
    })
  }, [])

  // Upload file function
  const uploadFile = async (upload: UploadStatus) => {
    try {
      // Update status to uploading
      setUploads(prev => prev.map(u => 
        u.id === upload.id ? { ...u, status: 'uploading' as const } : u
      ))

      const formData = new FormData()
      formData.append('video', upload.file)
      formData.append('title', upload.file.name.split('.')[0])

      const xhr = new XMLHttpRequest()

      // Track upload progress
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100)
          setUploads(prev => prev.map(u => 
            u.id === upload.id ? { ...u, progress } : u
          ))
        }
      }

      // Handle completion
      xhr.onload = () => {
        if (xhr.status === 200) {
          const response = JSON.parse(xhr.responseText)
          setUploads(prev => prev.map(u => 
            u.id === upload.id 
              ? { ...u, status: 'processing' as const, progress: 100 }
              : u
          ))

          // Simulate processing time
          setTimeout(() => {
            const newVideo: VideoMetadata = {
              id: response.id,
              title: response.title,
              description: response.description,
              url: response.url,
              thumbnail: response.thumbnail,
              duration: response.duration || 0,
              fileSize: upload.file.size,
              uploadedAt: new Date(response.uploadedAt),
              status: 'READY'
            }

            setUploads(prev => prev.map(u => 
              u.id === upload.id 
                ? { ...u, status: 'completed' as const, uploadedFileUrl: response.url }
                : u
            ))

            setVideos(prev => [newVideo, ...prev])
            onUploadComplete?.(newVideo)
          }, 2000)
        } else {
          const error = JSON.parse(xhr.responseText).error || 'Upload failed'
          setUploads(prev => prev.map(u => 
            u.id === upload.id 
              ? { ...u, status: 'error' as const, error }
              : u
          ))
        }
      }

      xhr.onerror = () => {
        setUploads(prev => prev.map(u => 
          u.id === upload.id 
            ? { ...u, status: 'error' as const, error: 'Network error occurred' }
            : u
        ))
      }

      xhr.open('POST', '/api/upload')
      xhr.send(formData)

    } catch (error) {
      setUploads(prev => prev.map(u => 
        u.id === upload.id 
          ? { ...u, status: 'error' as const, error: 'Upload failed' }
          : u
      ))
    }
  }

  // Handle upload actions
  const handleCancelUpload = (id: string) => {
    setUploads(prev => prev.filter(u => u.id !== id))
  }

  const handleRetryUpload = (id: string) => {
    const upload = uploads.find(u => u.id === id)
    if (upload) {
      setUploads(prev => prev.map(u => 
        u.id === id 
          ? { ...u, status: 'pending', progress: 0, error: undefined }
          : u
      ))
      uploadFile(upload)
    }
  }

  const handleRemoveUpload = (id: string) => {
    setUploads(prev => prev.filter(u => u.id !== id))
  }

  // Handle video actions
  const handleVideoPlay = (video: VideoMetadata) => {
    onVideoSelect?.(video)
  }

  const handleVideoEdit = (video: VideoMetadata) => {
    // Handle edit action - could open a modal or navigate to edit page
    console.log('Edit video:', video.id)
  }

  const handleVideoDelete = async (video: VideoMetadata) => {
    if (confirm('Are you sure you want to delete this video?')) {
      try {
        const response = await fetch(`/api/videos/${video.id}`, {
          method: 'DELETE'
        })
        
        if (response.ok) {
          setVideos(prev => prev.filter(v => v.id !== video.id))
        }
      } catch (error) {
        console.error('Failed to delete video:', error)
      }
    }
  }

  const handleVideoDownload = (video: VideoMetadata) => {
    // Create download link
    const link = document.createElement('a')
    link.href = video.url
    link.download = video.title
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const activeUploads = uploads.filter(u => u.status !== 'completed')

  return (
    <div className={cn("space-y-8", className)}>
      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Upload className="h-5 w-5" />
            <span>Upload Videos</span>
          </CardTitle>
          <CardDescription>
            Upload your videos to start creating clips. Supports multiple formats and up to {maxFiles} files.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FileDropzone
            onFilesSelected={handleFilesSelected}
            maxFiles={maxFiles}
            maxSize={maxFileSize}
          />
        </CardContent>
      </Card>

      {/* Upload Progress */}
      {uploads.length > 0 && (
        <UploadProgress
          uploads={uploads}
          onCancel={handleCancelUpload}
          onRetry={handleRetryUpload}
          onRemove={handleRemoveUpload}
        />
      )}

      {/* Videos Library */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Your Videos</h2>
            <p className="text-muted-foreground">
              {videos.length} video{videos.length !== 1 ? 's' : ''} uploaded
            </p>
          </div>
          
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchVideos}
              disabled={isLoading}
            >
              <RefreshCw className={cn("h-4 w-4 mr-2", isLoading && "animate-spin")} />
              Refresh
            </Button>
            
            <div className="flex border rounded-lg p-1">
              <Button
                variant={viewMode === 'grid' ? 'default' : 'ghost'}
                size="sm"
                className="h-8 px-3"
                onClick={() => setViewMode('grid')}
              >
                <Grid3X3 className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'ghost'}
                size="sm"
                className="h-8 px-3"
                onClick={() => setViewMode('list')}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Videos Grid/List */}
        {videos.length === 0 ? (
          <Card>
            <CardContent className="py-8 sm:py-12 lg:py-16 text-center">
              <div className="flex flex-col items-center space-y-4">
                <div className="rounded-full bg-muted p-6">
                  <Upload className="h-8 w-8 text-muted-foreground" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-medium">No videos uploaded yet</h3>
                  <p className="text-muted-foreground">
                    Upload your first video to get started with creating clips.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className={cn(
            viewMode === 'grid' 
              ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
              : "space-y-4"
          )}>
            {videos.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                onPlay={handleVideoPlay}
                onEdit={handleVideoEdit}
                onDelete={handleVideoDelete}
                onDownload={handleVideoDownload}
                className={viewMode === 'list' ? "flex flex-row" : ""}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}