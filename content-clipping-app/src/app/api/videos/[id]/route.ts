import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { prisma } from '@/lib/prisma'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    
    const video = await prisma.video.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        clips: {
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        _count: {
          select: {
            clips: true
          }
        }
      }
    })
    
    if (!video) {
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      )
    }
    
    // Convert BigInt to string for JSON serialization
    const responseData = {
      ...video,
      fileSize: video.fileSize.toString(),
      uploadedAt: video.uploadedAt.toISOString(),
      updatedAt: video.updatedAt.toISOString(),
      clips: video.clips.map(clip => ({
        ...clip,
        createdAt: clip.createdAt.toISOString(),
        updatedAt: clip.updatedAt.toISOString(),
      }))
    }
    
    return NextResponse.json(responseData)
    
  } catch (error) {
    console.error('Error fetching video:', error)
    return NextResponse.json(
      { error: 'Failed to fetch video' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const body = await request.json()
    const { title, description, status } = body
    
    // Check if video exists
    const existingVideo = await prisma.video.findUnique({
      where: { id }
    })
    
    if (!existingVideo) {
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      )
    }
    
    // Update video
    const video = await prisma.video.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(status && { status }),
        updatedAt: new Date()
      }
    })
    
    // Convert BigInt to string for JSON serialization
    const responseData = {
      ...video,
      fileSize: video.fileSize.toString(),
      uploadedAt: video.uploadedAt.toISOString(),
      updatedAt: video.updatedAt.toISOString(),
    }
    
    return NextResponse.json(responseData)
    
  } catch (error) {
    console.error('Error updating video:', error)
    return NextResponse.json(
      { error: 'Failed to update video' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    
    // Get video details before deletion
    const video = await prisma.video.findUnique({
      where: { id }
    })
    
    if (!video) {
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      )
    }
    
    // Delete associated clips first (due to foreign key constraints)
    await prisma.clip.deleteMany({
      where: { videoId: id }
    })
    
    // Delete video record from database
    await prisma.video.delete({
      where: { id }
    })
    
    // Delete file from filesystem
    if (video.url) {
      try {
        const filename = path.basename(video.url)
        const filePath = path.join(process.cwd(), 'public', 'uploads', filename)
        await fs.unlink(filePath)
      } catch (fileError) {
        console.error('Error deleting file:', fileError)
        // Don't fail the entire operation if file deletion fails
      }
    }
    
    // Delete thumbnail if it exists
    if (video.thumbnail) {
      try {
        const thumbnailPath = path.join(process.cwd(), 'public', video.thumbnail)
        await fs.unlink(thumbnailPath)
      } catch (thumbnailError) {
        console.error('Error deleting thumbnail:', thumbnailError)
        // Don't fail the entire operation if thumbnail deletion fails
      }
    }
    
    return NextResponse.json({ 
      message: 'Video deleted successfully',
      deletedId: id
    })
    
  } catch (error) {
    console.error('Error deleting video:', error)
    return NextResponse.json(
      { error: 'Failed to delete video' },
      { status: 500 }
    )
  }
}
