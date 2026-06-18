import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { JobQueueManager } from '@/lib/job-queue';
import path from 'path';

export const runtime = 'nodejs';

/**
 * POST /api/process
 * Start processing a video that was already uploaded
 */
export async function POST(request: NextRequest) {
  try {
    const { videoId } = await request.json();

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    // Get video from database
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        url: true,
        userId: true,
        status: true,
        processingStage: true,
      },
    });

    if (!video) {
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }

    // Check if video is already processing or completed
    if (video.status === 'PROCESSING' || video.status === 'READY') {
      return NextResponse.json({
        message: 'Video is already processing or completed',
        videoId: video.id,
        status: video.status,
        processingStage: video.processingStage,
      });
    }

    // Get full path to video file
    const videoPath = path.join(process.cwd(), 'public', video.url);

    // Update video status to processing
    await prisma.video.update({
      where: { id: videoId },
      data: {
        status: 'PROCESSING',
        processingStage: 'UPLOADED',
        processingProgress: 0,
        errorMessage: null,
      },
    });

    // Add to processing queue
    const job = await JobQueueManager.addVideoProcessingJob(
      video.id,
      video.userId,
      videoPath
    );

    return NextResponse.json({
      success: true,
      message: 'Video processing started',
      videoId: video.id,
      jobId: job.id,
      status: 'PROCESSING',
    });

  } catch (error) {
    console.error('Processing API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/process?videoId=xxx
 * Get processing status for a video
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const videoId = searchParams.get('videoId');

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    // Get video with processing status
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        title: true,
        status: true,
        processingStage: true,
        processingProgress: true,
        errorMessage: true,
        metadataExtracted: true,
        thumbnailGenerated: true,
        audioExtracted: true,
        transcriptionCompleted: true,
        clipsGenerated: true,
        updatedAt: true,
        transcription: {
          select: {
            id: true,
            language: true,
          },
        },
        clips: {
          select: {
            id: true,
            title: true,
            score: true,
            approved: true,
          },
          orderBy: {
            score: 'desc',
          },
        },
      },
    });

    if (!video) {
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      video: {
        id: video.id,
        title: video.title,
        status: video.status,
        processingStage: video.processingStage,
        processingProgress: video.processingProgress,
        errorMessage: video.errorMessage,
        stages: {
          metadataExtracted: video.metadataExtracted,
          thumbnailGenerated: video.thumbnailGenerated,
          audioExtracted: video.audioExtracted,
          transcriptionCompleted: video.transcriptionCompleted,
          clipsGenerated: video.clipsGenerated,
        },
        transcription: video.transcription,
        clipsCount: video.clips.length,
        approvedClipsCount: video.clips.filter(c => c.approved).length,
        lastUpdated: video.updatedAt,
      },
    });

  } catch (error) {
    console.error('Processing status API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}