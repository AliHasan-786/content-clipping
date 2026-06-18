import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { FFmpegService } from '@/lib/ffmpeg-service';
import path from 'path';
import fs from 'fs/promises';

export const runtime = 'nodejs';

/**
 * POST /api/clips/export
 * Export a clip as a video file
 */
export async function POST(request: NextRequest) {
  try {
    const { clipId, format = 'mp4', quality = 'medium' } = await request.json();

    if (!clipId) {
      return NextResponse.json(
        { error: 'Clip ID is required' },
        { status: 400 }
      );
    }

    // Get clip with video information
    const clip = await prisma.clip.findUnique({
      where: { id: clipId },
      include: {
        video: {
          select: {
            id: true,
            url: true,
            title: true,
          },
        },
      },
    });

    if (!clip) {
      return NextResponse.json(
        { error: 'Clip not found' },
        { status: 404 }
      );
    }

    // Check if clip is already exported
    if (clip.exported && clip.exportUrl) {
      const exportPath = path.join(process.cwd(), 'public', clip.exportUrl);
      try {
        await fs.access(exportPath);
        return NextResponse.json({
          success: true,
          message: 'Clip already exported',
          exportUrl: clip.exportUrl,
        });
      } catch {
        // File doesn't exist, continue with export
      }
    }

    // Get source video path
    const sourceVideoPath = path.join(process.cwd(), 'public', clip.video.url);

    // Create exports directory
    const exportsDir = path.join(process.cwd(), 'public', 'exports');
    await fs.mkdir(exportsDir, { recursive: true });

    // Generate export filename
    const safeTitle = clip.title
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 30);
    
    const exportFilename = `${clip.video.id}_${safeTitle}_${clip.id}.${format}`;
    const exportPath = path.join(exportsDir, exportFilename);
    const exportUrl = `/exports/${exportFilename}`;

    // Export the clip using FFmpeg
    await FFmpegService.trimVideo(sourceVideoPath, {
      startTime: clip.startTime,
      endTime: clip.endTime,
      outputPath: exportPath,
    });

    // Convert if different format or quality requested
    if (format !== 'mp4' || quality !== 'medium') {
      const convertedPath = path.join(
        exportsDir, 
        `${clip.video.id}_${safeTitle}_${clip.id}_converted.${format}`
      );
      
      await FFmpegService.convertVideo(exportPath, convertedPath, {
        format,
        quality,
      });

      // Replace original with converted
      await fs.unlink(exportPath);
      await fs.rename(convertedPath, exportPath);
    }

    // Update clip in database
    await prisma.clip.update({
      where: { id: clipId },
      data: {
        exported: true,
        exportUrl,
        updatedAt: new Date(),
      },
    });

    // Get file stats
    const stats = await fs.stat(exportPath);

    return NextResponse.json({
      success: true,
      message: 'Clip exported successfully',
      clip: {
        id: clip.id,
        title: clip.title,
        exportUrl,
        format,
        quality,
        fileSize: stats.size,
        duration: clip.endTime - clip.startTime,
      },
    });

  } catch (error) {
    console.error('Clip export API error:', error);
    return NextResponse.json(
      { error: 'Clip export failed', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/clips/export?clipId=xxx
 * Get export status and download link for a clip
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const clipId = searchParams.get('clipId');

    if (!clipId) {
      return NextResponse.json(
        { error: 'Clip ID is required' },
        { status: 400 }
      );
    }

    // Get clip export information
    const clip = await prisma.clip.findUnique({
      where: { id: clipId },
      select: {
        id: true,
        title: true,
        startTime: true,
        endTime: true,
        exported: true,
        exportUrl: true,
        updatedAt: true,
        video: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    if (!clip) {
      return NextResponse.json(
        { error: 'Clip not found' },
        { status: 404 }
      );
    }

    let fileExists = false;
    let fileSize = 0;

    if (clip.exported && clip.exportUrl) {
      try {
        const exportPath = path.join(process.cwd(), 'public', clip.exportUrl);
        const stats = await fs.stat(exportPath);
        fileExists = true;
        fileSize = stats.size;
      } catch {
        // File doesn't exist
      }
    }

    return NextResponse.json({
      success: true,
      clip: {
        id: clip.id,
        title: clip.title,
        duration: clip.endTime - clip.startTime,
        exported: clip.exported,
        exportUrl: clip.exportUrl,
        fileExists,
        fileSize,
        lastExported: clip.updatedAt,
        video: clip.video,
      },
    });

  } catch (error) {
    console.error('Get clip export API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/clips/export
 * Delete exported clip file
 */
export async function DELETE(request: NextRequest) {
  try {
    const { clipId } = await request.json();

    if (!clipId) {
      return NextResponse.json(
        { error: 'Clip ID is required' },
        { status: 400 }
      );
    }

    // Get clip export information
    const clip = await prisma.clip.findUnique({
      where: { id: clipId },
      select: {
        id: true,
        exportUrl: true,
        exported: true,
      },
    });

    if (!clip) {
      return NextResponse.json(
        { error: 'Clip not found' },
        { status: 404 }
      );
    }

    if (!clip.exported || !clip.exportUrl) {
      return NextResponse.json(
        { error: 'Clip is not exported' },
        { status: 400 }
      );
    }

    // Delete the file
    const exportPath = path.join(process.cwd(), 'public', clip.exportUrl);
    try {
      await fs.unlink(exportPath);
    } catch (error) {
      console.warn('Failed to delete export file:', error);
      // Continue even if file deletion fails
    }

    // Update clip in database
    await prisma.clip.update({
      where: { id: clipId },
      data: {
        exported: false,
        exportUrl: null,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Exported clip file deleted successfully',
    });

  } catch (error) {
    console.error('Delete clip export API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}