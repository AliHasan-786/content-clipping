import { BasePlatformService, PlatformConfig, VideoUploadOptions, PublishResult, AuthResult, Analytics } from './base-platform-service';
import { PlatformAccount } from '@prisma/client';
import fs from 'fs';
import FormData from 'form-data';
import axios from 'axios';

export class TikTokService extends BasePlatformService {
  private readonly baseUrl = 'https://open.tiktokapis.com';
  private readonly authUrl = 'https://www.tiktok.com/v2/auth/authorize';

  constructor(config: PlatformConfig) {
    super(config, 'tiktok');
    this.validateConfig();
  }

  generateAuthUrl(state?: string): string {
    const params = new URLSearchParams({
      client_key: this.config.clientId!,
      scope: 'user.info.basic,video.upload,video.publish',
      response_type: 'code',
      redirect_uri: this.config.redirectUri!,
      state: state || this.generateState(),
    });

    return `${this.authUrl}?${params.toString()}`;
  }

  async handleAuthCallback(code: string, state?: string): Promise<AuthResult> {
    try {
      const tokenResponse = await axios.post(`${this.baseUrl}/v2/oauth/token/`, {
        client_key: this.config.clientId,
        client_secret: this.config.clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: this.config.redirectUri,
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      if (!tokenResponse.data.access_token) {
        return { success: false, error: 'No access token received' };
      }

      // Get user info
      const userResponse = await axios.get(`${this.baseUrl}/v2/user/info/`, {
        headers: {
          'Authorization': `Bearer ${tokenResponse.data.access_token}`,
        },
      });

      const userInfo = userResponse.data.data.user;

      return {
        success: true,
        accessToken: tokenResponse.data.access_token,
        refreshToken: tokenResponse.data.refresh_token,
        expiresAt: new Date(Date.now() + (tokenResponse.data.expires_in * 1000)),
        accountInfo: {
          id: userInfo.open_id,
          username: userInfo.username,
          displayName: userInfo.display_name,
          profilePicture: userInfo.avatar_url
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'TikTok authentication failed'
      };
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<AuthResult> {
    try {
      const response = await axios.post(`${this.baseUrl}/v2/oauth/token/`, {
        client_key: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      return {
        success: true,
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token || refreshToken,
        expiresAt: new Date(Date.now() + (response.data.expires_in * 1000))
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'TikTok token refresh failed'
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

      // Step 1: Initialize upload
      const uploadInit = await this.initializeUpload(account.accessToken!);
      if (!uploadInit.success) {
        return { success: false, error: uploadInit.error };
      }

      // Step 2: Upload video file
      const uploadResult = await this.uploadVideoFile(
        uploadInit.uploadUrl!,
        videoPath,
        uploadInit.uploadId!
      );
      if (!uploadResult.success) {
        return { success: false, error: uploadResult.error };
      }

      // Step 3: Create post
      const publishResult = await this.createPost(
        account.accessToken!,
        uploadInit.uploadId!,
        options
      );

      return publishResult;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'TikTok upload failed'
      };
    }
  }

  private async initializeUpload(accessToken: string): Promise<{
    success: boolean;
    uploadUrl?: string;
    uploadId?: string;
    error?: string;
  }> {
    try {
      const response = await axios.post(`${this.baseUrl}/v2/post/publish/inbox/video/init/`, {
        source_info: {
          source: 'PULL_FROM_URL',
          video_size: 0, // Will be set when uploading
          chunk_size: 10000000, // 10MB chunks
          total_chunk_count: 1
        }
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      const data = response.data.data;
      return {
        success: true,
        uploadUrl: data.upload_url,
        uploadId: data.publish_id
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to initialize upload'
      };
    }
  }

  private async uploadVideoFile(
    uploadUrl: string,
    videoPath: string,
    publishId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const videoBuffer = fs.readFileSync(videoPath);
      const formData = new FormData();
      
      formData.append('video', videoBuffer, {
        filename: 'video.mp4',
        contentType: 'video/mp4',
      });

      await axios.put(uploadUrl, formData, {
        headers: {
          ...formData.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to upload video file'
      };
    }
  }

  private async createPost(
    accessToken: string,
    publishId: string,
    options: VideoUploadOptions
  ): Promise<PublishResult> {
    try {
      const postData = {
        post_info: {
          title: this.optimizeTikTokCaption(options.title, options.description, options.tags),
          privacy_level: options.privacy === 'private' ? 'MUTUAL_FOLLOW_FRIEND' : 'PUBLIC_TO_EVERYONE',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
          video_cover_timestamp_ms: 1000,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: 0,
          chunk_size: 0,
          total_chunk_count: 1
        }
      };

      // Add scheduled publish time if provided
      if (options.scheduledPublishTime) {
        // Note: TikTok API may not support scheduled publishing for all accounts
        // This would depend on the specific API permissions
        console.warn('TikTok scheduled publishing may not be available for all accounts');
      }

      const response = await axios.post(`${this.baseUrl}/v2/post/publish/`, {
        post_id: publishId,
        ...postData
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      return {
        success: true,
        platformPostId: response.data.data.publish_id,
        url: `https://www.tiktok.com/@user/video/${response.data.data.publish_id}`, // Placeholder URL format
        metadata: {
          publishId: response.data.data.publish_id,
          status: response.data.data.status
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create TikTok post'
      };
    }
  }

  private optimizeTikTokCaption(title: string, description?: string, tags?: string[]): string {
    let caption = title.trim();
    
    // Add description if provided and there's room
    if (description && caption.length < 1000) {
      caption += '\n\n' + description;
    }

    // Add hashtags (TikTok allows up to 100 hashtags but recommend 3-5 for best performance)
    if (tags && tags.length > 0) {
      const hashtagText = '\n\n' + tags.slice(0, 5).map(tag => 
        tag.startsWith('#') ? tag : '#' + tag
      ).join(' ');
      
      if (caption.length + hashtagText.length <= 2200) { // TikTok caption limit
        caption += hashtagText;
      }
    }

    // Ensure we don't exceed TikTok's caption limit
    if (caption.length > 2200) {
      caption = caption.substring(0, 2197) + '...';
    }

    return caption;
  }

  async getAnalytics(
    account: PlatformAccount,
    postId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<Analytics> {
    try {
      // Note: TikTok Analytics API access is limited
      // This is a simplified implementation
      const response = await axios.get(`${this.baseUrl}/v2/video/query/`, {
        headers: {
          'Authorization': `Bearer ${account.accessToken}`,
        },
        params: {
          fields: 'id,video_description,create_time,cover_image_url,share_url,view_count,like_count,comment_count,share_count',
          video_ids: postId
        }
      });

      const video = response.data.data.videos[0];
      if (!video) {
        throw new Error('Video not found');
      }

      const views = video.view_count || 0;
      const likes = video.like_count || 0;
      const comments = video.comment_count || 0;
      const shares = video.share_count || 0;

      return {
        views,
        likes,
        comments,
        shares,
        engagementRate: views > 0 ? ((likes + comments + shares) / views) * 100 : 0
      };
    } catch (error) {
      console.error('TikTok analytics error:', error);
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
      maxDuration: 180, // 3 minutes (recently increased from 60 seconds)
      recommendedAspectRatios: ['9:16'], // Vertical video only
      maxFileSize: 287 * 1024 * 1024, // 287MB
      supportedFormats: ['mp4', 'mov'],
      maxTitleLength: 2200, // TikTok caption limit
      maxDescriptionLength: 2200, // Combined with title
      hashtagLimit: 100, // TikTok allows many hashtags but recommend 3-5
      thumbnailRequired: false, // TikTok auto-generates cover
      tiktokSpecific: {
        minResolution: '540x960',
        recommendedResolution: '1080x1920',
        minDuration: 3, // 3 seconds minimum
        maxDuration: 180, // 3 minutes maximum
        verticalOnly: true,
        autoGeneratedCovers: true,
        maxHashtagsRecommended: 5
      }
    };
  }

  async suggestHashtags(content: string, category?: string): Promise<string[]> {
    const baseHashtags = ['#fyp', '#viral', '#trending'];
    
    // Add category-specific hashtags optimized for TikTok
    if (category) {
      switch (category.toLowerCase()) {
        case 'gaming':
          return [...baseHashtags, '#gaming', '#gamer', '#gameplay', '#gamingcommunity'];
        case 'music':
          return [...baseHashtags, '#music', '#song', '#audio', '#sound'];
        case 'comedy':
          return [...baseHashtags, '#comedy', '#funny', '#humor', '#laugh'];
        case 'dance':
          return [...baseHashtags, '#dance', '#dancing', '#choreography', '#moves'];
        case 'food':
          return [...baseHashtags, '#food', '#cooking', '#recipe', '#foodtok'];
        case 'diy':
          return [...baseHashtags, '#diy', '#crafts', '#tutorial', '#howto'];
        case 'beauty':
          return [...baseHashtags, '#beauty', '#makeup', '#skincare', '#beautytok'];
        case 'fitness':
          return [...baseHashtags, '#fitness', '#workout', '#gym', '#health'];
        default:
          return [...baseHashtags, '#content', '#video'];
      }
    }

    // Analyze content for trending hashtags
    const contentLower = content.toLowerCase();
    const contextHashtags: string[] = [];
    
    if (contentLower.includes('tutorial') || contentLower.includes('how to')) {
      contextHashtags.push('#tutorial', '#howto', '#learn');
    }
    if (contentLower.includes('quick') || contentLower.includes('fast')) {
      contextHashtags.push('#quick', '#fast', '#hack');
    }
    if (contentLower.includes('asmr')) {
      contextHashtags.push('#asmr', '#satisfying', '#relaxing');
    }

    return [...baseHashtags, ...contextHashtags].slice(0, 5);
  }

  async getOptimalPostingTimes(accountId: string): Promise<{
    dayOfWeek: number;
    hour: number;
    engagementScore: number;
  }[]> {
    // TikTok optimal posting times (generally higher engagement in evenings)
    return [
      { dayOfWeek: 0, hour: 19, engagementScore: 0.85 }, // Sunday 7PM
      { dayOfWeek: 0, hour: 20, engagementScore: 0.9 },  // Sunday 8PM
      { dayOfWeek: 1, hour: 18, engagementScore: 0.8 },  // Monday 6PM
      { dayOfWeek: 2, hour: 18, engagementScore: 0.85 }, // Tuesday 6PM
      { dayOfWeek: 2, hour: 19, engagementScore: 0.9 },  // Tuesday 7PM
      { dayOfWeek: 3, hour: 19, engagementScore: 0.85 }, // Wednesday 7PM
      { dayOfWeek: 4, hour: 18, engagementScore: 0.9 },  // Thursday 6PM
      { dayOfWeek: 4, hour: 19, engagementScore: 0.95 }, // Thursday 7PM (peak)
      { dayOfWeek: 5, hour: 17, engagementScore: 0.85 }, // Friday 5PM
      { dayOfWeek: 5, hour: 19, engagementScore: 0.9 },  // Friday 7PM
      { dayOfWeek: 6, hour: 11, engagementScore: 0.75 }, // Saturday 11AM
      { dayOfWeek: 6, hour: 19, engagementScore: 0.8 },  // Saturday 7PM
    ];
  }

  // Get trending hashtags for TikTok
  async getTrendingHashtags(category?: string): Promise<string[]> {
    // In a real implementation, you'd call TikTok's trending API
    // For now, return common trending hashtags
    const trending = [
      '#fyp', '#viral', '#trending', '#foryou', '#foryoupage',
      '#tiktokmademebuyit', '#learnontiktok', '#smallbusiness',
      '#pov', '#storytime', '#dayinmylife', '#getready', '#ootd'
    ];

    if (category) {
      // Add category-specific trending hashtags
      switch (category.toLowerCase()) {
        case 'beauty':
          return [...trending, '#beautytok', '#skincare', '#makeup', '#selfcare'];
        case 'food':
          return [...trending, '#foodtok', '#cooking', '#recipe', '#foodie'];
        case 'fashion':
          return [...trending, '#fashion', '#style', '#ootd', '#outfit'];
        case 'pets':
          return [...trending, '#petsoftiktok', '#dogsoftiktok', '#catsoftiktok'];
      }
    }

    return trending;
  }
}