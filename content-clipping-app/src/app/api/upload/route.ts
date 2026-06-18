import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { 
  getVideoMetadata, 
  isValidVideoFormat, 
  generateSafeFilename, 
  ensureUploadDirectory,
  generateThumbnailPath
} from '@/lib/video-utils'
import { prisma } from '@/lib/prisma'
import { JobQueueManager } from '@/lib/job-queue'

// Configure for handling file uploads
export const runtime = 'nodejs'

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024 // 2GB
const ALLOWED_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/webm',
  'video/x-ms-wmv',
  'video/3gpp',
  'video/x-flv',
  'video/x-matroska'
]

export async function POST(request: NextRequest) {
  try {
    // Parse form data
    const formData = await request.formData()
    const file = formData.get('video') as File
    const title = formData.get('title') as string
    const description = formData.get('description') as string | null
    
    // Validate file
    if (!file) {
      return NextResponse.json(
        { error: 'No video file provided' },
        { status: 400 }
      )
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File size exceeds maximum limit (2GB)' },
        { status: 400 }
      )
    }

    // Check file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload a video file.' },
        { status: 400 }
      )
    }

    // Validate filename
    if (!isValidVideoFormat(file.name)) {
      return NextResponse.json(
        { error: 'Invalid video format' },
        { status: 400 }
      )
    }

    // Ensure upload directory exists
    const uploadDir = await ensureUploadDirectory()
    
    // Generate safe filename
    const safeFilename = generateSafeFilename(file.name)
    const filePath = path.join(uploadDir, safeFilename)
    
    // Save file to disk
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    await fs.writeFile(filePath, buffer)

    // Get video metadata
    let metadata
    try {
      metadata = await getVideoMetadata(filePath)
    } catch (error) {
      // If metadata extraction fails, use basic info
      metadata = {
        filename: safeFilename,
        originalName: file.name,
        size: file.size,
        duration: 0 // Default duration
      }
    }

    // Generate file URL
    const fileUrl = `/uploads/${safeFilename}`
    
    // Generate thumbnail path (placeholder for now)
    const thumbnailPath = generateThumbnailPath(safeFilename)

    // Save to database
    // Note: In a real app, you'd get the userId from the authenticated session
    const userId = 'temp-user-id' // Placeholder - implement proper auth
    
    const video = await prisma.video.create({
      data: {
        title: title || file.name.split('.')[0],
        description: description || null,
        url: fileUrl,
        thumbnail: thumbnailPath,
        duration: metadata.duration || 0,
        fileSize: BigInt(file.size),
        status: 'UPLOADING', // Start as UPLOADING, will be processed automatically
        processingStage: 'UPLOADED',
        processingProgress: 0,
        userId: userId,
      }
    })

    // Automatically start processing (optional - can be triggered manually)
    const autoProcess = true; // Set to false if you want manual processing
    
    if (autoProcess) {
      try {
        await JobQueueManager.addVideoProcessingJob(
          video.id,
          userId,
          filePath,
          1 // High priority for new uploads
        );
        
        // Update video status to processing
        await prisma.video.update({
          where: { id: video.id },
          data: {
            status: 'PROCESSING',
            processingStage: 'UPLOADED',
          },
        });
      } catch (error) {
        console.error('Failed to start processing:', error);
        // Don't fail the upload, just log the error
      }
    }

    // Convert BigInt to string for JSON serialization
    const responseData = {
      ...video,
      fileSize: video.fileSize.toString(),
      uploadedAt: video.uploadedAt.toISOString(),
      updatedAt: video.updatedAt.toISOString(),
      status: autoProcess ? 'PROCESSING' : video.status,
      autoProcessing: autoProcess,
    }

    return NextResponse.json(responseData, { status: 200 })

  } catch (error) {
    console.error('Upload error:', error)
    
    return NextResponse.json(
      { error: 'Internal server error during upload' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405 }
  )
}