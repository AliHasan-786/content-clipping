import { YouTubeService } from './youtube-service';
import { PlatformAccount } from '@prisma/client';
import { VideoUploadOptions, PublishResult } from './base-platform-service';
import fs from 'fs';
import { google } from 'googleapis';

export class YouTubeShortsService extends YouTubeService {
  constructor(config: any) {
    super(config);
  }

  async uploadShort(
    account: PlatformAccount,
    videoPath: string,
    options: VideoUploadOptions
  ): Promise<PublishResult> {
    try {
      // Validate that video is suitable for Shorts
      const shortsValidation = this.validateShortsFormat(videoPath, options);
      if (!shortsValidation.isValid) {
        return { 
          success: false, 
          error: `Video not suitable for YouTube Shorts: ${shortsValidation.errors.join(', ')}` 
        };
      }

      // Set up OAuth client with account tokens
      const oauth2Client = this.oauth2Client;
      oauth2Client.setCredentials({
        access_token: account.accessToken || undefined,
        refresh_token: account.refreshToken || undefined,
      });

      const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

      // Prepare Shorts-optimized metadata
      const videoMetadata = {
        snippet: {
          title: this.optimizeShortsTitle(options.title),
          description: this.optimizeShortsDescription(options.description || '', options.tags || []),
          tags: this.optimizeShortsTags(options.tags || []),
          categoryId: '24', // Entertainment category works well for Shorts
          defaultLanguage: 'en'
        },
        status: {
          privacyStatus: options.privacy || 'public',
          publishAt: options.scheduledPublishTime?.toISOString(),
          selfDeclaredMadeForKids: false,
          madeForKids: false
        }
      };

      // Upload the video
      const response = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: videoMetadata,
        media: {
          body: fs.createReadStream(videoPath)
        }
      });

      const videoId = response.data.id;
      if (!videoId) {
        return { success: false, error: 'No video ID returned from YouTube' };
      }

      // Upload Shorts-optimized thumbnail if provided
      if (options.thumbnail) {
        try {
          await this.uploadShortsOptimizedThumbnail(videoId, options.thumbnail);
        } catch (thumbError) {
          console.warn('Shorts thumbnail upload failed:', thumbError);
        }
      }

      return {
        success: true,
        platformPostId: videoId,
        url: `https://www.youtube.com/shorts/${videoId}`,
        metadata: {
          channelId: response.data.snippet?.channelId,
          publishedAt: response.data.snippet?.publishedAt,
          isShorts: true,
          duration: shortsValidation.duration
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Shorts upload failed'
      };
    }
  }

  private validateShortsFormat(videoPath: string, options: VideoUploadOptions): {
    isValid: boolean;
    errors: string[];
    duration?: number;
  } {
    const errors: string[] = [];
    
    // Check if file exists
    if (!fs.existsSync(videoPath)) {
      errors.push('Video file does not exist');
      return { isValid: false, errors };
    }

    // For now, we'll do basic validation. In a real implementation,
    // you'd use ffprobe to get video metadata
    const stats = fs.statSync(videoPath);
    
    // YouTube Shorts requirements:
    // - Must be vertical (9:16) or square (1:1)
    // - Duration must be ≤ 60 seconds
    // - File size reasonable (we'll check basic size)
    
    if (stats.size > 500 * 1024 * 1024) { // 500MB max for Shorts
      errors.push('File size too large for YouTube Shorts (max 500MB)');
    }

    // Note: In a production environment, you'd use ffprobe to check:
    // - Aspect ratio (should be 9:16 or 1:1)
    // - Duration (should be ≤ 60 seconds)
    // - Resolution (minimum 720p recommended)
    
    return {
      isValid: errors.length === 0,
      errors,
      duration: 60 // Placeholder - would get from ffprobe
    };
  }

  private optimizeShortsTitle(title: string): string {
    // YouTube Shorts title optimization
    let optimized = title.trim();
    
    // Keep titles under 100 characters (YouTube limit)
    if (optimized.length > 70) {
      optimized = optimized.substring(0, 67) + '...';
    }
    
    // Add #Shorts tag if not present and there's room
    if (!optimized.toLowerCase().includes('#shorts') && optimized.length < 90) {
      optimized = optimized + ' #Shorts';
    }
    
    return optimized;
  }

  private optimizeShortsDescription(description: string, tags: string[]): string {
    let optimized = description.trim();
    
    // Add Shorts-specific call to action if description is short
    if (optimized.length < 100) {
      optimized += '\n\n🔥 Like and subscribe for more Shorts!';
    }
    
    // Add hashtags to description
    const relevantHashtags = tags.slice(0, 3); // Use first 3 tags
    if (relevantHashtags.length > 0) {
      optimized += '\n\n' + relevantHashtags.map(tag => 
        tag.startsWith('#') ? tag : '#' + tag
      ).join(' ');
    }
    
    // Ensure we don't exceed YouTube's description limit
    if (optimized.length > 4900) {
      optimized = optimized.substring(0, 4897) + '...';
    }
    
    return optimized;
  }

  private optimizeShortsTags(tags: string[]): string[] {
    const shortsSpecificTags = ['Shorts', 'YouTubeShorts', 'Vertical', 'QuickVideo'];
    
    // Combine user tags with Shorts-specific tags
    const allTags = [...new Set([...tags, ...shortsSpecificTags])];
    
    // YouTube allows up to 30 tags
    return allTags.slice(0, 30);
  }

  private async uploadShortsOptimizedThumbnail(videoId: string, thumbnailPath: string): Promise<void> {
    const youtube = google.youtube({ version: 'v3', auth: this.oauth2Client });
    
    // For Shorts, thumbnails are less critical since they auto-generate,
    // but we'll still upload if provided
    await youtube.thumbnails.set({
      videoId: videoId,
      media: {
        body: fs.createReadStream(thumbnailPath)
      }
    });
  }

  getOptimizationHints() {
    return {
      maxDuration: 60, // 60 seconds for Shorts
      recommendedAspectRatios: ['9:16', '1:1'], // Vertical or square
      maxFileSize: 500 * 1024 * 1024, // 500MB for Shorts
      supportedFormats: ['mp4', 'mov', 'webm'],
      maxTitleLength: 100,
      maxDescriptionLength: 5000,
      hashtagLimit: 30,
      thumbnailRequired: false, // Shorts auto-generate thumbnails
      shortsSpecific: {
        minVerticalResolution: '720x1280',
        recommendedResolution: '1080x1920',
        maxDurationSeconds: 60,
        autoGeneratedThumbnails: true,
        verticalOptimized: true
      }
    };
  }

  async suggestShortsHashtags(content: string, category?: string): Promise<string[]> {
    const baseHashtags = ['#Shorts', '#YouTubeShorts', '#Viral', '#Trending'];
    
    // Add category-specific hashtags optimized for Shorts
    if (category) {
      switch (category.toLowerCase()) {
        case 'gaming':
          return [...baseHashtags, '#GamingShorts', '#GameClips', '#Gaming', '#Gamer'];
        case 'music':
          return [...baseHashtags, '#MusicShorts', '#Song', '#Music', '#Audio'];
        case 'comedy':
          return [...baseHashtags, '#ComedyShorts', '#Funny', '#Comedy', '#Humor'];
        case 'dance':
          return [...baseHashtags, '#DanceShorts', '#Dance', '#Moves', '#Choreography'];
        case 'food':
          return [...baseHashtags, '#FoodShorts', '#Cooking', '#Recipe', '#Food'];
        case 'diy':
          return [...baseHashtags, '#DIYShorts', '#DIY', '#Crafts', '#Tutorial'];
        case 'pets':
          return [...baseHashtags, '#PetShorts', '#Pets', '#Animals', '#Cute'];
        default:
          return [...baseHashtags, '#Content', '#Video'];
      }
    }

    // Analyze content for context-specific hashtags
    const contentLower = content.toLowerCase();
    const contextHashtags: string[] = [];
    
    if (contentLower.includes('tutorial') || contentLower.includes('how to')) {
      contextHashtags.push('#Tutorial', '#HowTo', '#Learn');
    }
    if (contentLower.includes('quick') || contentLower.includes('fast')) {
      contextHashtags.push('#Quick', '#Fast', '#Instant');
    }
    if (contentLower.includes('tip') || contentLower.includes('hack')) {
      contextHashtags.push('#Tips', '#Hacks', '#LifeHacks');
    }

    return [...baseHashtags, ...contextHashtags].slice(0, 15);
  }

  async getOptimalShortsPostingTimes(accountId: string): Promise<{
    dayOfWeek: number;
    hour: number;
    engagementScore: number;
  }[]> {
    // YouTube Shorts optimal posting times (generally higher engagement)
    return [
      { dayOfWeek: 0, hour: 15, engagementScore: 0.85 }, // Sunday 3PM
      { dayOfWeek: 0, hour: 19, engagementScore: 0.9 },  // Sunday 7PM
      { dayOfWeek: 1, hour: 18, engagementScore: 0.8 },  // Monday 6PM
      { dayOfWeek: 2, hour: 18, engagementScore: 0.85 }, // Tuesday 6PM
      { dayOfWeek: 3, hour: 17, engagementScore: 0.9 },  // Wednesday 5PM
      { dayOfWeek: 4, hour: 17, engagementScore: 0.85 }, // Thursday 5PM
      { dayOfWeek: 5, hour: 16, engagementScore: 0.95 }, // Friday 4PM
      { dayOfWeek: 5, hour: 19, engagementScore: 0.9 },  // Friday 7PM
      { dayOfWeek: 6, hour: 11, engagementScore: 0.8 },  // Saturday 11AM
      { dayOfWeek: 6, hour: 19, engagementScore: 0.85 }, // Saturday 7PM
    ];
  }

  // Analytics specific to Shorts performance
  async getShortsAnalytics(
    account: PlatformAccount,
    postId: string,
    startDate?: Date,
    endDate?: Date
  ) {
    const baseAnalytics = await this.getAnalytics(account, postId, startDate, endDate);
    
    // Add Shorts-specific metrics when available
    // Note: YouTube Analytics API provides additional Shorts-specific data
    return {
      ...baseAnalytics,
      shortsSpecific: {
        averageViewDuration: baseAnalytics.watchTime && baseAnalytics.views > 0 
          ? (baseAnalytics.watchTime / baseAnalytics.views) 
          : 0,
        swipeUpRate: 0, // Would get from Analytics API
        swipeAwayRate: 0, // Would get from Analytics API
        verticalPlaytimePercentage: 0, // Shorts-specific metric
        discoverabilityScore: 0, // Based on algorithm pickup
      }
    };
  }
}