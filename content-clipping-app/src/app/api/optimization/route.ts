import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { VideoOptimizationService } from '@/lib/social/video-optimization-service';
import { CaptionOptimizationService } from '@/lib/social/caption-optimization-service';
import { HashtagService } from '@/lib/social/hashtag-service';
import { ThumbnailService } from '@/lib/social/thumbnail-service';
import { z } from 'zod';

const videoOptimizer = new VideoOptimizationService();
const captionOptimizer = new CaptionOptimizationService();
const hashtagService = new HashtagService();
const thumbnailService = new ThumbnailService();

// POST /api/optimization - Get content optimization recommendations
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await req.json();
    
    const OptimizationSchema = z.object({
      type: z.enum(['video', 'caption', 'hashtags', 'thumbnail', 'all']),
      content: z.object({
        title: z.string(),
        description: z.string().optional(),
        videoPath: z.string().optional(),
        platform: z.string(),
        category: z.string().optional(),
        targetAudience: z.string().optional(),
      }),
    });

    const validation = OptimizationSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { 
          error: 'Invalid request data',
          details: validation.error.errors 
        },
        { status: 400 }
      );
    }

    const { type, content } = validation.data;
    const results: any = {};

    // Video optimization
    if (type === 'video' || type === 'all') {
      if (content.videoPath) {
        try {
          const estimate = await videoOptimizer.getOptimizationEstimate(
            content.videoPath,
            {
              targetPlatform: content.platform,
              targetAspectRatio: '9:16', // Default for shorts
              quality: 'high'
            }
          );
          results.video = estimate;
        } catch (error) {
          results.video = { error: 'Video optimization estimate failed' };
        }
      } else {
        results.video = { error: 'Video path required for video optimization' };
      }
    }

    // Caption optimization
    if (type === 'caption' || type === 'all') {
      try {
        const optimizedCaption = await captionOptimizer.optimizeCaption(
          content.title,
          content.description,
          {
            platform: content.platform,
            tone: 'engaging',
            includeHashtags: true,
            includeCallToAction: true,
            targetAudience: content.targetAudience
          }
        );
        results.caption = optimizedCaption;
      } catch (error) {
        results.caption = { error: 'Caption optimization failed' };
      }
    }

    // Hashtag suggestions
    if (type === 'hashtags' || type === 'all') {
      try {
        const hashtags = await hashtagService.suggestHashtags(
          content.title + ' ' + (content.description || ''),
          content.platform,
          content.category,
          content.targetAudience
        );
        results.hashtags = hashtags;
      } catch (error) {
        results.hashtags = { error: 'Hashtag suggestions failed' };
      }
    }

    // Thumbnail optimization
    if (type === 'thumbnail' || type === 'all') {
      if (content.videoPath) {
        try {
          const thumbnailVariations = await thumbnailService.generateThumbnailVariations(
            content.videoPath,
            content.platform,
            3
          );
          results.thumbnail = {
            variations: thumbnailVariations.map(variation => ({
              outputPath: variation.outputPath,
              width: variation.width,
              height: variation.height,
              fileSize: variation.fileSize,
              success: variation.success,
            }))
          };
        } catch (error) {
          results.thumbnail = { error: 'Thumbnail generation failed' };
        }
      } else {
        results.thumbnail = { error: 'Video path required for thumbnail generation' };
      }
    }

    return NextResponse.json(results);

  } catch (error) {
    console.error('Optimization API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
