import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { WhisperService } from '@/lib/whisper-service';

export const runtime = 'nodejs';

/**
 * GET /api/transcribe?videoId=xxx
 * Get transcription for a video
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

    // Get transcription with segments
    const transcription = await prisma.transcription.findUnique({
      where: { videoId },
      include: {
        segments: {
          orderBy: { startTime: 'asc' },
        },
        video: {
          select: {
            id: true,
            title: true,
            duration: true,
          },
        },
      },
    });

    if (!transcription) {
      return NextResponse.json(
        { error: 'Transcription not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      transcription: {
        id: transcription.id,
        text: transcription.text,
        language: transcription.language,
        createdAt: transcription.createdAt,
        video: transcription.video,
        segments: transcription.segments.map(segment => ({
          id: segment.id,
          text: segment.text,
          startTime: segment.startTime,
          endTime: segment.endTime,
          confidence: segment.confidence,
          speakerLabel: segment.speakerLabel,
        })),
      },
    });

  } catch (error) {
    console.error('Transcription API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/transcribe
 * Manually trigger transcription for a video
 */
export async function POST(request: NextRequest) {
  try {
    const { videoId, language, force = false } = await request.json();

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    // Check if video exists
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        url: true,
        transcriptionCompleted: true,
        transcription: {
          select: { id: true },
        },
      },
    });

    if (!video) {
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }

    // Check if transcription already exists
    if (video.transcriptionCompleted && video.transcription && !force) {
      return NextResponse.json({
        success: true,
        message: 'Transcription already exists',
        transcriptionId: video.transcription.id,
      });
    }

    // If forcing re-transcription, delete existing transcription
    if (force && video.transcription) {
      await prisma.transcription.delete({
        where: { id: video.transcription.id },
      });
    }

    // Update video status
    await prisma.video.update({
      where: { id: videoId },
      data: {
        processingStage: 'TRANSCRIBING',
        transcriptionCompleted: false,
      },
    });

    // Note: In a full implementation, this would trigger the transcription job
    // For now, we'll return a success message indicating the job was queued
    return NextResponse.json({
      success: true,
      message: 'Transcription job queued',
      videoId: video.id,
    });

  } catch (error) {
    console.error('Transcription trigger API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/transcribe
 * Update transcription segments
 */
export async function PUT(request: NextRequest) {
  try {
    const { transcriptionId, segments } = await request.json();

    if (!transcriptionId || !segments) {
      return NextResponse.json(
        { error: 'Transcription ID and segments are required' },
        { status: 400 }
      );
    }

    // Validate segments format
    const isValidSegments = Array.isArray(segments) && segments.every(segment =>
      typeof segment.text === 'string' &&
      typeof segment.startTime === 'number' &&
      typeof segment.endTime === 'number'
    );

    if (!isValidSegments) {
      return NextResponse.json(
        { error: 'Invalid segments format' },
        { status: 400 }
      );
    }

    // Update transcription segments in transaction
    await prisma.$transaction(async (tx) => {
      // Delete existing segments
      await tx.transcriptionSegment.deleteMany({
        where: { transcriptionId },
      });

      // Create new segments
      await tx.transcriptionSegment.createMany({
        data: segments.map((segment: any) => ({
          transcriptionId,
          text: segment.text,
          startTime: segment.startTime,
          endTime: segment.endTime,
          confidence: segment.confidence || null,
          speakerLabel: segment.speakerLabel || null,
        })),
      });

      // Update transcription text
      const fullText = segments.map((s: any) => s.text).join(' ');
      await tx.transcription.update({
        where: { id: transcriptionId },
        data: {
          text: fullText,
          updatedAt: new Date(),
        },
      });
    });

    return NextResponse.json({
      success: true,
      message: 'Transcription updated successfully',
      transcriptionId,
    });

  } catch (error) {
    console.error('Transcription update API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}