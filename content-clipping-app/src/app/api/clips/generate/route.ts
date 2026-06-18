import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ClipDetectionService } from '@/lib/clip-detection-service';
import { FFmpegService } from '@/lib/ffmpeg-service';
import path from 'path';

export const runtime = 'nodejs';

/**
 * POST /api/clips/generate
 * Generate clips for a video
 */
export async function POST(request: NextRequest) {
  try {
    const { 
      videoId, 
      options = {},
      regenerate = false 
    } = await request.json();

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    // Get video with transcription
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      include: {
        transcription: {
          include: {
            segments: {
              orderBy: { startTime: 'asc' },
            },
          },
        },
        clips: {
          select: {
            id: true,
            score: true,
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

    if (!video.transcription || !video.transcription.segments.length) {
      return NextResponse.json(
        { error: 'Video transcription not found or empty' },
        { status: 400 }
      );
    }

    // Check if clips already exist
    if (video.clips.length > 0 && !regenerate) {
      return NextResponse.json({
        success: true,
        message: 'Clips already exist for this video',
        clipsCount: video.clips.length,
        averageScore: video.clips.reduce((sum, clip) => sum + (clip.score || 0), 0) / video.clips.length,
      });
    }

    // If regenerating, delete existing clips
    if (regenerate && video.clips.length > 0) {
      await prisma.clip.deleteMany({
        where: { videoId },
      });
    }

    // Get video file path
    const videoPath = path.join(process.cwd(), 'public', video.url);

    // Convert segments to expected format
    const segments = video.transcription.segments.map((segment, index) => ({
      id: index,
      text: segment.text,
      start: segment.startTime,
      end: segment.endTime,
      confidence: segment.confidence,
    }));

    // Set default options
    const clipOptions = {
      minClipDuration: 5,
      maxClipDuration: 60,
      maxClips: 10,
      scoreThreshold: 2.5,
      ...options,
    };

    // Update video processing status
    await prisma.video.update({
      where: { id: videoId },
      data: {
        processingStage: 'DETECTING_CLIPS',
        processingProgress: 85,
      },
    });

    // Detect clips
    const detectedClips = await ClipDetectionService.detectClips(
      videoPath,
      segments,
      clipOptions
    );

    if (detectedClips.length === 0) {
      await prisma.video.update({
        where: { id: videoId },
        data: {
          clipsGenerated: true,
          processingStage: 'COMPLETED',
          processingProgress: 100,
        },
      });

      return NextResponse.json({
        success: true,
        message: 'No suitable clips detected',
        clipsGenerated: 0,
      });
    }

    // Save clips to database
    const createdClips = await Promise.all(
      detectedClips.map(async (clip, index) => {
        return prisma.clip.create({
          data: {
            videoId,
            title: clip.title,
            description: clip.description,
            startTime: Math.floor(clip.startTime),
            endTime: Math.floor(clip.endTime),
            tags: clip.tags,
            score: clip.score,
            confidence: clip.confidence,
            reason: clip.reason,
            approved: false, // Default to not approved
          },
        });
      })
    );

    // Update video status
    await prisma.video.update({
      where: { id: videoId },
      data: {
        clipsGenerated: true,
        processingStage: 'COMPLETED',
        processingProgress: 100,
        status: 'READY',
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Clips generated successfully',
      clipsGenerated: createdClips.length,
      averageScore: createdClips.reduce((sum, clip) => sum + (clip.score || 0), 0) / createdClips.length,
      clips: createdClips.map(clip => ({
        id: clip.id,
        title: clip.title,
        description: clip.description,
        startTime: clip.startTime,
        endTime: clip.endTime,
        duration: clip.endTime - clip.startTime,
        score: clip.score,
        confidence: clip.confidence,
        reason: clip.reason,
        tags: clip.tags,
        approved: clip.approved,
      })),
    });

  } catch (error) {
    console.error('Clip generation API error:', error);
    
    // Update video status on error
    if (request.url) {
      try {
        const { videoId } = await request.clone().json();
        if (videoId) {
          await prisma.video.update({
            where: { id: videoId },
            data: {
              processingStage: 'FAILED',
              status: 'ERROR',
              errorMessage: error.message,
            },
          });
        }
      } catch {}
    }

    return NextResponse.json(
      { error: 'Clip generation failed', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/clips/generate?videoId=xxx
 * Get generated clips for a video
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const videoId = searchParams.get('videoId');
    const approved = searchParams.get('approved');
    const minScore = searchParams.get('minScore');

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    // Build where clause
    const where: any = { videoId };
    
    if (approved !== null) {
      where.approved = approved === 'true';
    }
    
    if (minScore) {
      where.score = {
        gte: parseFloat(minScore),
      };
    }

    // Get clips
    const clips = await prisma.clip.findMany({
      where,
      orderBy: [
        { score: 'desc' },
        { createdAt: 'asc' },
      ],
      include: {
        video: {
          select: {
            id: true,
            title: true,
            url: true,
            thumbnail: true,
            duration: true,
          },
        },
      },
    });

    const stats = await prisma.clip.aggregate({
      where: { videoId },
      _count: { _all: true },
      _avg: { score: true },
    });

    return NextResponse.json({
      success: true,
      clips: clips.map(clip => ({
        id: clip.id,
        title: clip.title,
        description: clip.description,
        startTime: clip.startTime,
        endTime: clip.endTime,
        duration: clip.endTime - clip.startTime,
        score: clip.score,
        confidence: clip.confidence,
        reason: clip.reason,
        tags: clip.tags,
        approved: clip.approved,
        exported: clip.exported,
        exportUrl: clip.exportUrl,
        createdAt: clip.createdAt,
        video: clip.video,
      })),
      stats: {
        totalClips: stats._count._all,
        averageScore: stats._avg.score || 0,
        approvedClips: clips.filter(c => c.approved).length,
        exportedClips: clips.filter(c => c.exported).length,
      },
    });

  } catch (error) {
    console.error('Get clips API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/clips/generate
 * Update clip approval status
 */
export async function PUT(request: NextRequest) {
  try {
    const { clipId, approved, title, description, tags } = await request.json();

    if (!clipId) {
      return NextResponse.json(
        { error: 'Clip ID is required' },
        { status: 400 }
      );
    }

    // Build update data
    const updateData: any = {};
    
    if (typeof approved === 'boolean') {
      updateData.approved = approved;
    }
    
    if (title) {
      updateData.title = title;
    }
    
    if (description) {
      updateData.description = description;
    }
    
    if (tags) {
      updateData.tags = tags;
    }

    updateData.updatedAt = new Date();

    // Update clip
    const updatedClip = await prisma.clip.update({
      where: { id: clipId },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      message: 'Clip updated successfully',
      clip: {
        id: updatedClip.id,
        title: updatedClip.title,
        description: updatedClip.description,
        approved: updatedClip.approved,
        tags: updatedClip.tags,
        updatedAt: updatedClip.updatedAt,
      },
    });

  } catch (error) {
    console.error('Update clip API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}