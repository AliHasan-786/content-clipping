"use client"

import { useState } from "react"
import Image from "next/image"
import { Card, CardContent, CardHeader, CardTitle } from "./card"
import { Button } from "./button"
import { 
  Play, 
  Clock, 
  FileVideo, 
  MoreVertical, 
  Download, 
  Trash2, 
  Edit,
  Copy,
  ExternalLink 
} from "lucide-react"
import { cn } from "@/lib/utils"

export interface VideoMetadata {
  id: string
  title: string
  description?: string
  url: string
  thumbnail?: string
  duration: number // in seconds
  fileSize: number // in bytes
  uploadedAt: Date
  status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'ERROR'
}

interface VideoCardProps {
  video: VideoMetadata
  onPlay?: (video: VideoMetadata) => void
  onEdit?: (video: VideoMetadata) => void
  onDelete?: (video: VideoMetadata) => void
  onDownload?: (video: VideoMetadata) => void
  className?: string
  showActions?: boolean
}

export function VideoCard({
  video,
  onPlay,
  onEdit,
  onDelete,
  onDownload,
  className,
  showActions = true
}: VideoCardProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [imageError, setImageError] = useState(false)

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const remainingSeconds = seconds % 60

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
    }
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date)
  }

  const getStatusBadge = () => {
    switch (video.status) {
      case 'UPLOADING':
        return (
          <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
            Uploading
          </span>
        )
      case 'PROCESSING':
        return (
          <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-amber-100 text-amber-800 rounded-full">
            Processing
          </span>
        )
      case 'READY':
        return (
          <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
            Ready
          </span>
        )
      case 'ERROR':
        return (
          <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">
            Error
          </span>
        )
    }
  }

  return (
    <Card className={cn(
      "group hover:shadow-lg transition-all duration-200 overflow-hidden",
      "hover:border-primary/50 sm:hover:scale-[1.02]", // Disable scale on mobile
      className
    )}>
      {/* Thumbnail */}
      <div className="relative aspect-video bg-muted overflow-hidden">
        {video.thumbnail && !imageError ? (
          <Image
            src={video.thumbnail}
            alt={video.title}
            fill
            className="object-cover transition-transform duration-200 group-hover:scale-105"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="flex items-center justify-center h-full bg-muted">
            <FileVideo className="h-12 w-12 text-muted-foreground" />
          </div>
        )}
        
        {/* Duration overlay */}
        <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
          {formatDuration(video.duration)}
        </div>

        {/* Play button overlay */}
        {video.status === 'READY' && onPlay && (
          <button
            onClick={() => onPlay(video)}
            className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          >
            <div className="bg-white/90 rounded-full p-3 hover:bg-white transition-colors">
              <Play className="h-6 w-6 text-primary ml-1" />
            </div>
          </button>
        )}

        {/* Status badge */}
        <div className="absolute top-2 left-2">
          {getStatusBadge()}
        </div>
      </div>

      {/* Content */}
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base truncate" title={video.title}>
              {video.title}
            </CardTitle>
            {video.description && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                {video.description}
              </p>
            )}
          </div>
          
          {showActions && (
            <div className="relative flex-shrink-0 ml-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
              
              {/* Dropdown menu */}
              {isMenuOpen && (
                <div className="absolute right-0 top-8 z-10 w-48 bg-card border rounded-lg shadow-lg py-1">
                  {onPlay && video.status === 'READY' && (
                    <button
                      onClick={() => {
                        onPlay(video)
                        setIsMenuOpen(false)
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center space-x-2"
                    >
                      <Play className="h-4 w-4" />
                      <span>Play</span>
                    </button>
                  )}
                  
                  {onEdit && (
                    <button
                      onClick={() => {
                        onEdit(video)
                        setIsMenuOpen(false)
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center space-x-2"
                    >
                      <Edit className="h-4 w-4" />
                      <span>Edit</span>
                    </button>
                  )}
                  
                  {onDownload && video.status === 'READY' && (
                    <button
                      onClick={() => {
                        onDownload(video)
                        setIsMenuOpen(false)
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center space-x-2"
                    >
                      <Download className="h-4 w-4" />
                      <span>Download</span>
                    </button>
                  )}
                  
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(video.url)
                      setIsMenuOpen(false)
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center space-x-2"
                  >
                    <Copy className="h-4 w-4" />
                    <span>Copy link</span>
                  </button>
                  
                  <button
                    onClick={() => {
                      window.open(video.url, '_blank')
                      setIsMenuOpen(false)
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center space-x-2"
                  >
                    <ExternalLink className="h-4 w-4" />
                    <span>Open in new tab</span>
                  </button>

                  {onDelete && (
                    <>
                      <div className="border-t my-1" />
                      <button
                        onClick={() => {
                          onDelete(video)
                          setIsMenuOpen(false)
                        }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center space-x-2 text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span>Delete</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-1">
              <Clock className="h-3 w-3" />
              <span>{formatDuration(video.duration)}</span>
            </div>
            <span>{formatFileSize(video.fileSize)}</span>
          </div>
          <span>{formatDate(video.uploadedAt)}</span>
        </div>
      </CardContent>

      {/* Click outside to close menu */}
      {isMenuOpen && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setIsMenuOpen(false)}
        />
      )}
    </Card>
  )
}