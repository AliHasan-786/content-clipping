"use client"

import { useCallback, useState } from "react"
import { useDropzone } from "react-dropzone"
import { Upload, FileVideo, X, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "./button"

interface FileWithPreview extends File {
  preview?: string
}

interface FileDropzoneProps {
  onFilesSelected: (files: FileWithPreview[]) => void
  maxFiles?: number
  maxSize?: number // in bytes
  className?: string
}

const ACCEPTED_VIDEO_TYPES = {
  'video/mp4': ['.mp4'],
  'video/quicktime': ['.mov'],
  'video/x-msvideo': ['.avi'],
  'video/webm': ['.webm'],
  'video/x-ms-wmv': ['.wmv'],
  'video/3gpp': ['.3gp'],
  'video/x-flv': ['.flv'],
  'video/x-matroska': ['.mkv']
}

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024 // 2GB

export function FileDropzone({ 
  onFilesSelected, 
  maxFiles = 10,
  maxSize = MAX_FILE_SIZE,
  className 
}: FileDropzoneProps) {
  const [rejectedFiles, setRejectedFiles] = useState<any[]>([])

  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: any[]) => {
    setRejectedFiles(rejectedFiles)
    
    const filesWithPreview = acceptedFiles.map(file => 
      Object.assign(file, {
        preview: URL.createObjectURL(file)
      })
    )
    
    onFilesSelected(filesWithPreview)
  }, [onFilesSelected])

  const { getRootProps, getInputProps, isDragActive, isDragAccept, isDragReject } = useDropzone({
    onDrop,
    accept: ACCEPTED_VIDEO_TYPES,
    maxFiles,
    maxSize,
    multiple: maxFiles > 1
  })

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <div className={cn("w-full", className)}>
      <div
        {...getRootProps()}
        className={cn(
          "relative cursor-pointer transition-all duration-200 ease-in-out",
          "border-2 border-dashed rounded-lg p-4 sm:p-6 lg:p-8 text-center",
          "hover:border-primary hover:bg-primary/5",
          "touch-none", // Prevent iOS touch callouts
          isDragActive && "border-primary bg-primary/5 scale-[1.02]",
          isDragAccept && "border-green-500 bg-green-50",
          isDragReject && "border-destructive bg-destructive/5"
        )}
      >
        <input {...getInputProps()} />
        
        <div className="flex flex-col items-center space-y-3 sm:space-y-4">
          <div className={cn(
            "rounded-full p-4 sm:p-6 transition-colors duration-200",
            isDragAccept ? "bg-green-100 text-green-600" : 
            isDragReject ? "bg-red-100 text-destructive" :
            "bg-primary/10 text-primary"
          )}>
            {isDragAccept ? (
              <FileVideo className="h-6 w-6 sm:h-8 sm:w-8" />
            ) : isDragReject ? (
              <AlertCircle className="h-6 w-6 sm:h-8 sm:w-8" />
            ) : (
              <Upload className="h-6 w-6 sm:h-8 sm:w-8" />
            )}
          </div>
          
          <div className="space-y-1 sm:space-y-2">
            <p className="text-base sm:text-lg font-medium text-foreground">
              {isDragActive ? (
                isDragAccept ? (
                  "Drop your videos here"
                ) : (
                  "Some files are not supported"
                )
              ) : (
                <>
                  <span className="hidden sm:inline">Drag and drop your videos here</span>
                  <span className="sm:hidden">Tap to select videos</span>
                </>
              )}
            </p>
            <p className="text-xs sm:text-sm text-muted-foreground">
              <span className="hidden sm:inline">or </span>
              <span className="text-primary font-medium">
                <span className="hidden sm:inline">browse files</span>
                <span className="sm:hidden">Select files</span>
              </span> to upload
            </p>
            <p className="text-xs text-muted-foreground">
              <span className="hidden sm:inline">Supports: MP4, MOV, AVI, WebM, WMV, 3GP, FLV, MKV</span>
              <span className="sm:hidden">Supports video files</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Max: {formatFileSize(maxSize)} • Up to {maxFiles} files
            </p>
          </div>
        </div>
      </div>

      {/* Rejected Files */}
      {rejectedFiles.length > 0 && (
        <div className="mt-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
          <div className="flex items-center space-x-2 mb-2">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <span className="font-medium text-destructive text-sm">
              Some files were rejected:
            </span>
          </div>
          <ul className="space-y-1">
            {rejectedFiles.map((fileRejection, index) => (
              <li key={index} className="text-xs text-destructive/80">
                <span className="font-medium">{fileRejection.file.name}</span>
                {fileRejection.errors.map((error: any, errorIndex: number) => (
                  <span key={errorIndex} className="ml-2">
                    - {error.message}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
