import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const status = searchParams.get('status')
    const search = searchParams.get('search')
    
    // Calculate offset
    const offset = (page - 1) * limit
    
    // Build where clause
    const where: any = {
      // Note: In a real app, filter by authenticated user
      // userId: userId
    }
    
    if (status) {
      where.status = status
    }
    
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ]
    }
    
    // Get videos with pagination
    const [videos, total] = await Promise.all([
      prisma.video.findMany({
        where,
        orderBy: { uploadedAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          _count: {
            select: {
              clips: true
            }
          }
        }
      }),
      prisma.video.count({ where })
    ])
    
    // Convert BigInt fields to strings for JSON serialization
    const serializedVideos = videos.map(video => ({
      ...video,
      fileSize: video.fileSize.toString(),
      uploadedAt: video.uploadedAt.toISOString(),
      updatedAt: video.updatedAt.toISOString(),
    }))
    
    return NextResponse.json({
      videos: serializedVideos,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    })
    
  } catch (error) {
    console.error('Error fetching videos:', error)
    return NextResponse.json(
      { error: 'Failed to fetch videos' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { title, description } = body
    
    if (!title) {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      )
    }
    
    // Note: In a real app, get userId from authenticated session
    const userId = 'temp-user-id'
    
    const video = await prisma.video.create({
      data: {
        title,
        description: description || null,
        url: '', // This would be set during file upload
        duration: 0,
        fileSize: BigInt(0),
        status: 'UPLOADING',
        userId: userId,
      }
    })
    
    // Convert BigInt to string for JSON serialization
    const responseData = {
      ...video,
      fileSize: video.fileSize.toString(),
      uploadedAt: video.uploadedAt.toISOString(),
      updatedAt: video.updatedAt.toISOString(),
    }
    
    return NextResponse.json(responseData, { status: 201 })
    
  } catch (error) {
    console.error('Error creating video:', error)
    return NextResponse.json(
      { error: 'Failed to create video' },
      { status: 500 }
    )
  }
}