import axios from 'axios';
import FormData from 'form-data';
import { PlatformAccount } from '@prisma/client';
import { BasePlatformService, PlatformConfig, VideoUploadOptions, PublishResult, AuthResult, Analytics } from './base-platform-service';
import fs from 'fs';
import path from 'path';

export class InstagramService extends BasePlatformService {
  private readonly baseUrl = 'https://graph.facebook.com/v18.0';

  constructor(config: PlatformConfig) {
    super(config, 'instagram');
    this.validateConfig();
  }

  generateAuthUrl(state?: string): string {
    const scopes = [
      'instagram_basic',
      'instagram_content_publish',
      'pages_show_list',
      'pages_read_engagement'
    ];

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: scopes.join(','),
      response_type: 'code',
      state: state || this.generateState(),
    });

    return `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`;
  }

  async handleAuthCallback(code: string, state?: string): Promise<AuthResult> {
    try {
      // Exchange code for access token
      const tokenResponse = await axios.post(`${this.baseUrl}/oauth/access_token`, {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        code
      });

      const { access_token } = tokenResponse.data;

      // Get user pages (Instagram Business accounts)
      const pagesResponse = await axios.get(`${this.baseUrl}/me/accounts`, {
        params: {
          access_token,
          fields: 'id,name,instagram_business_account'
        }
      });

      const page = pagesResponse.data.data?.[0];
      if (!page?.instagram_business_account) {
        return { 
          success: false, 
          error: 'No Instagram Business account found. Please connect an Instagram Business account to your Facebook page.' 
        };
      }

      const instagramAccountId = page.instagram_business_account.id;

      // Get Instagram account info
      const instagramResponse = await axios.get(`${this.baseUrl}/${instagramAccountId}`, {
        params: {
          access_token,
          fields: 'id,username,account_type,profile_picture_url'
        }
      });

      const instagramData = instagramResponse.data;

      return {
        success: true,
        accessToken: access_token,
        accountInfo: {
          id: instagramData.id,
          username: instagramData.username,
          displayName: instagramData.username,
          profilePicture: instagramData.profile_picture_url
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
      // Instagram uses long-lived tokens that need to be exchanged
      const response = await axios.get(`${this.baseUrl}/oauth/access_token`, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          fb_exchange_token: refreshToken
        }
      });

      return {
        success: true,
        accessToken: response.data.access_token,
        expiresAt: new Date(Date.now() + (response.data.expires_in * 1000))
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

      // Determine if this is a Reel based on video characteristics and options
      const isReel = this.isReelsContent(videoPath, options);

      // Step 1: Create media container
      const containerParams: any = {
        access_token: account.accessToken,
        media_type: isReel ? 'REELS' : 'VIDEO'
      };

      // Upload video file first and get URL (Instagram requires hosted video URLs)
      // In production, you'd upload to your own CDN/storage first
      const videoUrl = await this.uploadVideoToHosting(videoPath);
      containerParams.video_url = videoUrl;

      if (options.title || options.description) {
        containerParams.caption = this.formatCaption(options);
      }

      if (options.location) {
        containerParams.location_id = await this.findLocationId(
          options.location.latitude, 
          options.location.longitude
        );
      }

      const containerResponse = await axios.post(
        `${this.baseUrl}/${account.accountId}/media`,
        containerParams
      );

      const creationId = containerResponse.data.id;

      // Step 2: Check upload status
      let uploadComplete = false;
      let attempts = 0;
      const maxAttempts = 30; // 5 minutes with 10-second intervals

      while (!uploadComplete && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds

        const statusResponse = await axios.get(`${this.baseUrl}/${creationId}`, {
          params: {
            access_token: account.accessToken,
            fields: 'status_code'
          }
        });

        const statusCode = statusResponse.data.status_code;
        
        if (statusCode === 'FINISHED') {
          uploadComplete = true;
        } else if (statusCode === 'ERROR') {
          throw new Error('Video processing failed on Instagram');
        }

        attempts++;
      }

      if (!uploadComplete) {
        throw new Error('Video upload timed out');
      }

      // Step 3: Publish the media
      const publishResponse = await axios.post(
        `${this.baseUrl}/${account.accountId}/media_publish`,
        {
          access_token: account.accessToken,
          creation_id: creationId
        }
      );

      const mediaId = publishResponse.data.id;

      return {
        success: true,
        platformPostId: mediaId,
        url: `https://www.instagram.com/p/${mediaId}`,
        metadata: {
          mediaType: isReel ? 'REELS' : 'VIDEO',
          creationId
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
      const response = await axios.get(`${this.baseUrl}/${postId}/insights`, {
        params: {
          access_token: account.accessToken,
          metric: 'impressions,reach,likes,comments,shares,saves,video_views'
        }
      });

      const insights = response.data.data;
      const metricsMap = insights.reduce((acc: any, insight: any) => {
        acc[insight.name] = insight.values[0].value;
        return acc;
      }, {});

      const impressions = metricsMap.impressions || 0;
      const likes = metricsMap.likes || 0;
      const comments = metricsMap.comments || 0;
      const shares = metricsMap.shares || 0;
      const saves = metricsMap.saves || 0;

      return {
        views: metricsMap.video_views || metricsMap.impressions || 0,
        likes,
        comments,
        shares,
        saves,
        impressions,
        reach: metricsMap.reach || 0,
        engagementRate: impressions > 0 ? 
          ((likes + comments + shares + saves) / impressions) * 100 : 0
      };
    } catch (error) {
      console.error('Instagram analytics error:', error);
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
      maxDuration: 90, // 90 seconds for Reels, 60 minutes for IGTV
      recommendedAspectRatios: ['9:16', '1:1'], // Reels and square posts
      maxFileSize: 4 * 1024 * 1024 * 1024, // 4GB
      supportedFormats: ['mp4', 'mov'],
      maxTitleLength: 2200, // Instagram caption limit
      maxDescriptionLength: 2200,
      hashtagLimit: 30,
      thumbnailRequired: false
    };
  }

  async suggestHashtags(content: string, category?: string): Promise<string[]> {
    const baseHashtags = ['#Instagram', '#Reels'];
    
    if (category) {
      switch (category.toLowerCase()) {
        case 'gaming':
          return [...baseHashtags, '#Gaming', '#Gamer', '#GamingCommunity', '#GameOn'];
        case 'music':
          return [...baseHashtags, '#Music', '#Song', '#Audio', '#Trending'];
        case 'comedy':
          return [...baseHashtags, '#Comedy', '#Funny', '#Humor', '#Viral'];
        case 'education':
          return [...baseHashtags, '#Education', '#Learning', '#Tutorial', '#Tips'];
        case 'lifestyle':
          return [...baseHashtags, '#Lifestyle', '#Daily', '#Life', '#Inspiration'];
        case 'fitness':
          return [...baseHashtags, '#Fitness', '#Workout', '#Health', '#Motivation'];
        case 'food':
          return [...baseHashtags, '#Food', '#Foodie', '#Recipe', '#Cooking'];
        default:
          return [...baseHashtags, '#Content', '#Creative'];
      }
    }

    return baseHashtags;
  }

  async getOptimalPostingTimes(accountId: string): Promise<{
    dayOfWeek: number;
    hour: number;
    engagementScore: number;
  }[]> {
    // Instagram general best times
    return [
      { dayOfWeek: 1, hour: 11, engagementScore: 0.8 }, // Monday 11AM
      { dayOfWeek: 1, hour: 13, engagementScore: 0.75 }, // Monday 1PM
      { dayOfWeek: 2, hour: 11, engagementScore: 0.85 }, // Tuesday 11AM
      { dayOfWeek: 2, hour: 13, engagementScore: 0.9 }, // Tuesday 1PM
      { dayOfWeek: 2, hour: 17, engagementScore: 0.8 }, // Tuesday 5PM
      { dayOfWeek: 3, hour: 11, engagementScore: 0.8 }, // Wednesday 11AM
      { dayOfWeek: 3, hour: 13, engagementScore: 0.85 }, // Wednesday 1PM
      { dayOfWeek: 4, hour: 11, engagementScore: 0.8 }, // Thursday 11AM
      { dayOfWeek: 4, hour: 13, engagementScore: 0.85 }, // Thursday 1PM
      { dayOfWeek: 5, hour: 13, engagementScore: 0.75 }, // Friday 1PM
    ];
  }

  private formatCaption(options: VideoUploadOptions): string {
    let caption = options.title;
    
    if (options.description) {
      caption += `\n\n${options.description}`;
    }

    if (options.tags) {
      const hashtags = options.tags.map(tag => `#${tag}`).join(' ');
      caption += `\n\n${hashtags}`;
    }

    return caption.substring(0, 2200); // Instagram limit
  }

  private async uploadVideoToHosting(videoPath: string): Promise<string> {
    // This is a placeholder - in production you would upload to your CDN/storage
    // and return the public URL
    throw new Error('Video hosting upload not implemented. Please implement video CDN upload.');
  }

  private async findLocationId(latitude: number, longitude: number): Promise<string | undefined> {
    // This would use Instagram's location search API
    // For now, return undefined (no location)
    return undefined;
  }

  private isReelsContent(videoPath: string, options: VideoUploadOptions): boolean {
    // Check if explicitly marked as Reel
    if (options.title.toLowerCase().includes('reel') || 
        options.description?.toLowerCase().includes('reel')) {
      return true;
    }

    // Check video characteristics (this would be enhanced with ffprobe in production)
    // For now, assume vertical videos < 90 seconds are Reels
    try {
      const stats = fs.statSync(videoPath);
      // In production, you'd use ffprobe to check duration and aspect ratio
      // Assuming duration check would be done here
      return true; // Placeholder - assume Reels for now
    } catch {
      return false;
    }
  }

  // Instagram Reels specific upload method
  async uploadReels(
    account: PlatformAccount,
    videoPath: string,
    options: VideoUploadOptions & {
      coverUrl?: string;
      audioName?: string;
      shareToFeed?: boolean;
    }
  ): Promise<PublishResult> {
    try {
      this.validateVideo(videoPath, options);
      
      const reelsParams: any = {
        access_token: account.accessToken,
        media_type: 'REELS',
        video_url: await this.uploadVideoToHosting(videoPath),
        caption: this.formatReelsCaption(options),
        share_to_feed: options.shareToFeed !== false, // Default to true
      };

      if (options.coverUrl) {
        reelsParams.cover_url = options.coverUrl;
      }

      if (options.audioName) {
        reelsParams.audio_name = options.audioName;
      }

      const containerResponse = await axios.post(
        `${this.baseUrl}/${account.accountId}/media`,
        reelsParams
      );

      const creationId = containerResponse.data.id;

      // Wait for processing and publish
      await this.waitForProcessing(creationId, account.accessToken!);

      const publishResponse = await axios.post(
        `${this.baseUrl}/${account.accountId}/media_publish`,
        {
          access_token: account.accessToken,
          creation_id: creationId
        }
      );

      return {
        success: true,
        platformPostId: publishResponse.data.id,
        url: `https://www.instagram.com/reel/${publishResponse.data.id}`,
        metadata: {
          mediaType: 'REELS',
          creationId,
          shareToFeed: options.shareToFeed
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Reels upload failed'
      };
    }
  }

  // Instagram Stories upload method
  async uploadStory(
    account: PlatformAccount,
    mediaPath: string,
    options: VideoUploadOptions & {
      isVideo?: boolean;
      link?: string;
      linkText?: string;
    }
  ): Promise<PublishResult> {
    try {
      const storyParams: any = {
        access_token: account.accessToken,
        media_type: options.isVideo ? 'STORIES_VIDEO' : 'STORIES_PHOTO',
      };

      if (options.isVideo) {
        storyParams.video_url = await this.uploadVideoToHosting(mediaPath);
      } else {
        storyParams.image_url = await this.uploadVideoToHosting(mediaPath); // Would be image upload
      }

      if (options.link) {
        storyParams.action_buttons = [{
          type: 'LEARN_MORE',
          text: options.linkText || 'Learn More',
          action: {
            type: 'LINK',
            url: options.link
          }
        }];
      }

      const containerResponse = await axios.post(
        `${this.baseUrl}/${account.accountId}/media`,
        storyParams
      );

      const creationId = containerResponse.data.id;
      
      // Stories don't need processing wait typically
      const publishResponse = await axios.post(
        `${this.baseUrl}/${account.accountId}/media_publish`,
        {
          access_token: account.accessToken,
          creation_id: creationId
        }
      );

      return {
        success: true,
        platformPostId: publishResponse.data.id,
        url: `https://www.instagram.com/stories/${account.username}`,
        metadata: {
          mediaType: options.isVideo ? 'STORIES_VIDEO' : 'STORIES_PHOTO',
          creationId
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Story upload failed'
      };
    }
  }

  private async waitForProcessing(creationId: string, accessToken: string): Promise<void> {
    let uploadComplete = false;
    let attempts = 0;
    const maxAttempts = 30;

    while (!uploadComplete && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 10000));

      const statusResponse = await axios.get(`${this.baseUrl}/${creationId}`, {
        params: {
          access_token: accessToken,
          fields: 'status_code'
        }
      });

      const statusCode = statusResponse.data.status_code;
      
      if (statusCode === 'FINISHED') {
        uploadComplete = true;
      } else if (statusCode === 'ERROR') {
        throw new Error('Video processing failed on Instagram');
      }

      attempts++;
    }

    if (!uploadComplete) {
      throw new Error('Video upload timed out');
    }
  }

  private formatReelsCaption(options: VideoUploadOptions): string {
    let caption = options.title || '';
    
    if (options.description) {
      caption += caption ? `\n\n${options.description}` : options.description;
    }

    // Add Reels-specific hashtags if not present
    if (!caption.toLowerCase().includes('#reels')) {
      caption += ' #Reels';
    }

    if (options.tags) {
      const hashtags = options.tags.map(tag => 
        tag.startsWith('#') ? tag : `#${tag}`
      ).join(' ');
      caption += `\n\n${hashtags}`;
    }

    return caption.substring(0, 2200);
  }

  // Get trending hashtags for Instagram
  async getTrendingHashtags(category?: string): Promise<string[]> {
    // In production, you'd call Instagram's hashtag API
    const trending = [
      '#reels', '#viral', '#trending', '#explore', '#instagram',
      '#instagood', '#love', '#photooftheday', '#fashion', '#beautiful'
    ];

    if (category) {
      switch (category.toLowerCase()) {
        case 'fashion':
          return [...trending, '#fashion', '#style', '#ootd', '#outfit', '#fashionista'];
        case 'food':
          return [...trending, '#food', '#foodie', '#instafood', '#delicious', '#yummy'];
        case 'travel':
          return [...trending, '#travel', '#wanderlust', '#adventure', '#vacation', '#explore'];
        case 'fitness':
          return [...trending, '#fitness', '#workout', '#health', '#motivation', '#gym'];
        case 'beauty':
          return [...trending, '#beauty', '#makeup', '#skincare', '#selfcare', '#glam'];
      }
    }

    return trending;
  }

  // Get Instagram Reels analytics
  async getReelsAnalytics(
    account: PlatformAccount,
    postId: string
  ): Promise<Analytics & {
    reelsSpecific: {
      plays: number;
      reach: number;
      accountsEngaged: number;
      averageWatchTime: number;
      totalWatchTime: number;
    }
  }> {
    try {
      const response = await axios.get(`${this.baseUrl}/${postId}/insights`, {
        params: {
          access_token: account.accessToken,
          metric: 'impressions,reach,likes,comments,shares,saves,plays,total_interactions,accounts_engaged'
        }
      });

      const insights = response.data.data;
      const metricsMap = insights.reduce((acc: any, insight: any) => {
        acc[insight.name] = insight.values[0].value;
        return acc;
      }, {});

      const baseAnalytics = await this.getAnalytics(account, postId);

      return {
        ...baseAnalytics,
        reelsSpecific: {
          plays: metricsMap.plays || 0,
          reach: metricsMap.reach || 0,
          accountsEngaged: metricsMap.accounts_engaged || 0,
          averageWatchTime: 0, // Would calculate from detailed metrics
          totalWatchTime: 0, // Would get from detailed analytics
        }
      };
    } catch (error) {
      const baseAnalytics = await this.getAnalytics(account, postId);
      return {
        ...baseAnalytics,
        reelsSpecific: {
          plays: 0,
          reach: 0,
          accountsEngaged: 0,
          averageWatchTime: 0,
          totalWatchTime: 0,
        }
      };
    }
  }

  // Enhanced optimization hints for different Instagram content types
  getOptimizationHints() {
    return {
      maxDuration: 90, // 90 seconds for Reels, 60 minutes for IGTV
      recommendedAspectRatios: ['9:16', '1:1'], // Reels and square posts
      maxFileSize: 4 * 1024 * 1024 * 1024, // 4GB
      supportedFormats: ['mp4', 'mov'],
      maxTitleLength: 2200, // Instagram caption limit
      maxDescriptionLength: 2200,
      hashtagLimit: 30,
      thumbnailRequired: false,
      reels: {
        maxDuration: 90,
        minDuration: 3,
        aspectRatio: '9:16',
        recommendedResolution: '1080x1920',
        maxFileSize: 4 * 1024 * 1024 * 1024,
        audioRequired: false,
        coverImageOptional: true
      },
      stories: {
        maxDuration: 60,
        aspectRatio: '9:16',
        recommendedResolution: '1080x1920',
        maxFileSize: 4 * 1024 * 1024 * 1024,
        ephemeral: true, // 24-hour lifespan
        interactiveElements: true
      },
      feed: {
        maxDuration: 3600, // 60 minutes
        aspectRatios: ['1:1', '4:5', '9:16'],
        recommendedResolution: '1080x1080',
        maxFileSize: 4 * 1024 * 1024 * 1024
      }
    };
  }
}