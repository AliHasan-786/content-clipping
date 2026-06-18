"use client"

import { Progress } from "@/components/ui/progress"
import { CheckCircle, AlertCircle, FileVideo, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "./button"

export interface UploadStatus {
  id: string
  file: File
  progress: number
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error'
  error?: string
  uploadedFileUrl?: string
}

interface UploadProgressProps {
  uploads: UploadStatus[]
  onCancel?: (id: string) => void
  onRetry?: (id: string) => void
  onRemove?: (id: string) => void
  className?: string
}

export function UploadProgress({ 
  uploads, 
  onCancel, 
  onRetry, 
  onRemove, 
  className 
}: UploadProgressProps) {
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const getStatusIcon = (status: UploadStatus['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-500" />
      case 'error':
        return <AlertCircle className="h-5 w-5 text-destructive" />
      default:
        return <FileVideo className="h-5 w-5 text-primary" />
    }
  }

  const getStatusText = (upload: UploadStatus) => {
    switch (upload.status) {
      case 'pending':
        return 'Pending...'
      case 'uploading':
        return `Uploading... ${upload.progress}%`
      case 'processing':
        return 'Processing...'
      case 'completed':
        return 'Upload complete'
      case 'error':
        return upload.error || 'Upload failed'
      default:
        return ''
    }
  }

  const getProgressColor = (status: UploadStatus['status']) => {
    switch (status) {
      case 'completed':
        return 'bg-green-500'
      case 'error':
        return 'bg-destructive'
      case 'processing':
        return 'bg-amber-500'
      default:
        return 'bg-primary'
    }
  }

  if (uploads.length === 0) return null

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-foreground">
          Upload Progress ({uploads.length})
        </h3>
        {uploads.some(u => u.status === 'completed' || u.status === 'error') && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              uploads
                .filter(u => u.status === 'completed' || u.status === 'error')
                .forEach(u => onRemove?.(u.id))
            }}
            className="text-xs"
          >
            Clear finished
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {uploads.map((upload) => (
          <div
            key={upload.id}
            className="bg-card border rounded-lg p-4 space-y-3 animate-in slide-in-from-bottom-2"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3 min-w-0 flex-1">
                {getStatusIcon(upload.status)}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">
                    {upload.file.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(upload.file.size)}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2 flex-shrink-0">
                {upload.status === 'uploading' && onCancel && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onCancel(upload.id)}
                    className="h-8 w-8 p-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}

                {upload.status === 'error' && onRetry && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onRetry(upload.id)}
                    className="text-xs px-3 py-1 h-auto"
                  >
                    Retry
                  </Button>
                )}

                {(upload.status === 'completed' || upload.status === 'error') && onRemove && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemove(upload.id)}
                    className="h-8 w-8 p-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className={cn(
                  "font-medium",
                  upload.status === 'completed' && "text-green-600",
                  upload.status === 'error' && "text-destructive",
                  upload.status === 'processing' && "text-amber-600"
                )}>
                  {getStatusText(upload)}
                </span>
                {upload.status === 'uploading' && (
                  <span className="text-muted-foreground">
                    {upload.progress}%
                  </span>
                )}
              </div>

              {upload.status !== 'pending' && (
                <div className="relative">
                  <Progress 
                    value={upload.status === 'completed' ? 100 : upload.progress} 
                    className="h-2"
                  />
                  <div 
                    className={cn(
                      "absolute inset-0 h-2 rounded-full transition-all duration-300",
                      getProgressColor(upload.status)
                    )}
                    style={{
                      width: `${upload.status === 'completed' ? 100 : upload.progress}%`
                    }}
                  />
                </div>
              )}
            </div>

            {upload.status === 'error' && upload.error && (
              <div className="text-xs text-destructive bg-destructive/10 p-2 rounded border border-destructive/20">
                {upload.error}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}