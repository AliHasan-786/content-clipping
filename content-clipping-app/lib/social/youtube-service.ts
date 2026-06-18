import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { PlatformAccount } from '@prisma/client';
import { BasePlatformService, PlatformConfig, VideoUploadOptions, PublishResult, AuthResult, Analytics } from './base-platform-service';
import fs from 'fs';

export class YouTubeService extends BasePlatformService {
  private oauth2Client: OAuth2Client;

  constructor(config: PlatformConfig) {
    super(config, 'youtube');
    this.validateConfig();
    
    this.oauth2Client = new OAuth2Client(
      this.config.clientId,
      this.config.clientSecret,
      this.config.redirectUri
    );
  }

  generateAuthUrl(state?: string): string {
    const scopes = [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube.force-ssl'
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      include_granted_scopes: true,
      state: state || this.generateState(),
    });
  }

  async handleAuthCallback(code: string, state?: string): Promise<AuthResult> {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      
      if (!tokens.access_token) {
        return { success: false, error: 'No access token received' };
      }

      this.oauth2Client.setCredentials(tokens);
      
      // Get user info
      const youtube = google.youtube({ version: 'v3', auth: this.oauth2Client });
      const channelResponse = await youtube.channels.list({
        part: ['snippet'],
        mine: true
      });

      const channel = channelResponse.data.items?.[0];
      if (!channel) {
        return { success: false, error: 'Could not fetch channel information' };
      }

      return {
        success: true,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        accountInfo: {
          id: channel.id || '',
          username: channel.snippet?.customUrl || channel.snippet?.title || '',
          displayName: channel.snippet?.title || '',
          profilePicture: channel.snippet?.thumbnails?.default?.url
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Authentication failed'
      };
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<AuthResult> {
    try {
      this.oauth2Client.setCredentials({
        refresh_token: refreshToken
      });

      const { credentials } = await this.oauth2Client.refreshAccessToken();
      
      return {
        success: true,
        accessToken: credentials.access_token || undefined,
        refreshToken: credentials.refresh_token || refreshToken,
        expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : undefined
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Token refresh failed'
      };
    }
  }

  async uploadVideo(
    account: PlatformAccount,
    videoPath: string,
    options: VideoUploadOptions
  ): Promise<PublishResult> {
    try {
      this.validateVideo(videoPath, options);

      // Set up OAuth client with account tokens
      this.oauth2Client.setCredentials({
        access_token: account.accessToken || undefined,
        refresh_token: account.refreshToken || undefined,
      });

      const youtube = google.youtube({ version: 'v3', auth: this.oauth2Client });

      // Prepare video metadata
      const videoMetadata = {
        snippet: {
          title: options.title.substring(0, 100), // YouTube title limit
          description: options.description?.substring(0, 5000), // YouTube description limit
          tags: options.tags?.slice(0, 30), // YouTube allows up to 30 tags
          categoryId: '22', // People & Blogs category
          defaultLanguage: 'en'
        },
        status: {
          privacyStatus: options.privacy || 'public',
          publishAt: options.scheduledPublishTime?.toISOString(),
          selfDeclaredMadeForKids: false
        }
      };

      // Upload video
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

      // Upload thumbnail if provided
      if (options.thumbnail) {
        try {
          await youtube.thumbnails.set({
            videoId: videoId,
            media: {
              body: fs.createReadStream(options.thumbnail)
            }
          });
        } catch (thumbError) {
          console.warn('Thumbnail upload failed:', thumbError);
          // Don't fail the entire upload for thumbnail issues
        }
      }

      return {
        success: true,
        platformPostId: videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        metadata: {
          channelId: response.data.snippet?.channelId,
          publishedAt: response.data.snippet?.publishedAt
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed'
      };
    }
  }

  async getAnalytics(
    account: PlatformAccount,
    postId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<Analytics> {
    try {
      this.oauth2Client.setCredentials({
        access_token: account.accessToken || undefined,
        refresh_token: account.refreshToken || undefined,
      });

      const youtube = google.youtube({ version: 'v3', auth: this.oauth2Client });
      const analytics = google.youtubeAnalytics({ version: 'v2', auth: this.oauth2Client });

      // Get video statistics
      const videoResponse = await youtube.videos.list({
        part: ['statistics'],
        id: [postId]
      });

      const stats = videoResponse.data.items?.[0]?.statistics;
      if (!stats) {
        throw new Error('Could not fetch video statistics');
      }

      // Get analytics data if dates are provided
      let analyticsData = null;
      if (startDate && endDate) {
        try {
          const analyticsResponse = await analytics.reports.query({
            ids: 'channel==MINE',
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
            metrics: 'views,likes,comments,shares,estimatedMinutesWatched,averageViewDuration',
            filters: `video==${postId}`
          });
          analyticsData = analyticsResponse.data;
        } catch (analyticsError) {
          console.warn('Analytics fetch failed:', analyticsError);
        }
      }

      const views = parseInt(stats.viewCount || '0');
      const likes = parseInt(stats.likeCount || '0');
      const comments = parseInt(stats.commentCount || '0');

      return {
        views,
        likes,
        comments,
        shares: 0, // YouTube API doesn't provide share count
        engagementRate: views > 0 ? ((likes + comments) / views) * 100 : 0,
        watchTime: analyticsData?.rows?.[0]?.[5] ? parseInt(analyticsData.rows[0][5]) * 60 : undefined,
        completionRate: analyticsData?.rows?.[0]?.[6] ? parseFloat(analyticsData.rows[0][6]) : undefined
      };
    } catch (error) {
      console.error('YouTube analytics error:', error);
      return {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        engagementRate: 0
      };
    }
  }

  getOptimizationHints() {
    return {
      maxDuration: 900, // 15 minutes for Shorts, unlimited for regular videos
      recommendedAspectRatios: ['9:16', '16:9'], // Shorts and regular
      maxFileSize: 128 * 1024 * 1024 * 1024, // 128GB
      supportedFormats: ['mp4', 'mov', 'avi', 'wmv', 'flv', 'webm'],
      maxTitleLength: 100,
      maxDescriptionLength: 5000,
      hashtagLimit: 30,
      thumbnailRequired: false
    };
  }

  async suggestHashtags(content: string, category?: string): Promise<string[]> {
    // This could be enhanced with YouTube's trending topics API
    const baseHashtags = ['#YouTube', '#Shorts'];
    
    // Add category-specific hashtags
    if (category) {
      switch (category.toLowerCase()) {
        case 'gaming':
          return [...baseHashtags, '#Gaming', '#Gamer', '#GamePlay'];
        case 'music':
          return [...baseHashtags, '#Music', '#Song', '#Cover'];
        case 'comedy':
          return [...baseHashtags, '#Comedy', '#Funny', '#Humor'];
        case 'education':
          return [...baseHashtags, '#Education', '#Learning', '#Tutorial'];
        default:
          return baseHashtags;
      }
    }

    return baseHashtags;
  }

  async getOptimalPostingTimes(accountId: string): Promise<{
    dayOfWeek: number;
    hour: number;
    engagementScore: number;
  }[]> {
    // YouTube general best times - could be personalized with analytics
    return [
      { dayOfWeek: 1, hour: 14, engagementScore: 0.8 }, // Monday 2PM
      { dayOfWeek: 1, hour: 15, engagementScore: 0.9 }, // Monday 3PM
      { dayOfWeek: 2, hour: 14, engagementScore: 0.85 }, // Tuesday 2PM
      { dayOfWeek: 2, hour: 15, engagementScore: 0.9 }, // Tuesday 3PM
      { dayOfWeek: 4, hour: 14, engagementScore: 0.8 }, // Thursday 2PM
      { dayOfWeek: 4, hour: 15, engagementScore: 0.85 }, // Thursday 3PM
      { dayOfWeek: 5, hour: 15, engagementScore: 0.75 }, // Friday 3PM
      { dayOfWeek: 6, hour: 9, engagementScore: 0.7 }, // Saturday 9AM
      { dayOfWeek: 6, hour: 11, engagementScore: 0.75 }, // Saturday 11AM
    ];
  }
}