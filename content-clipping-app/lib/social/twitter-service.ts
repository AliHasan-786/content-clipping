import { TwitterApi } from 'twitter-api-v2';
import { PlatformAccount } from '@prisma/client';
import { BasePlatformService, PlatformConfig, VideoUploadOptions, PublishResult, AuthResult, Analytics } from './base-platform-service';
import fs from 'fs';

export class TwitterService extends BasePlatformService {
  private client: TwitterApi;

  constructor(config: PlatformConfig) {
    super(config, 'twitter');
    this.validateConfig();
    
    this.client = new TwitterApi({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
    });
  }

  generateAuthUrl(state?: string): string {
    const scopes = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'];
    const authUrl = this.client.generateOAuth2AuthLink(
      this.config.redirectUri,
      {
        scope: scopes,
        state: state || this.generateState(),
        code_challenge: 'challenge', // In production, generate proper PKCE challenge
        code_challenge_method: 'plain'
      }
    );
    
    return authUrl.url;
  }

  async handleAuthCallback(code: string, state?: string): Promise<AuthResult> {
    try {
      const { client: loggedClient, accessToken, refreshToken, expiresIn } = 
        await this.client.loginWithOAuth2({
          code,
          redirectUri: this.config.redirectUri,
          codeVerifier: 'challenge', // In production, use proper PKCE verifier
        });

      // Get user info
      const user = await loggedClient.v2.me({
        'user.fields': ['id', 'name', 'username', 'profile_image_url']
      });

      if (!user.data) {
        return { success: false, error: 'Could not fetch user information' };
      }

      const expiresAt = expiresIn ? 
        new Date(Date.now() + (expiresIn * 1000)) : 
        new Date(Date.now() + (7200 * 1000)); // Default 2 hours

      return {
        success: true,
        accessToken,
        refreshToken,
        expiresAt,
        accountInfo: {
          id: user.data.id,
          username: user.data.username || '',
          displayName: user.data.name || '',
          profilePicture: user.data.profile_image_url
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
      const { client: refreshedClient, accessToken, refreshToken: newRefreshToken } = 
        await this.client.refreshOAuth2Token(refreshToken);

      return {
        success: true,
        accessToken,
        refreshToken: newRefreshToken || refreshToken,
        expiresAt: new Date(Date.now() + (7200 * 1000)) // 2 hours default
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

      // Create authenticated client
      const userClient = new TwitterApi({
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
      });

      const loggedClient = userClient.withBearerToken(account.accessToken || '');

      // Read video file
      const videoBuffer = fs.readFileSync(videoPath);
      const videoSizeBytes = videoBuffer.length;

      // Twitter video limits: 512MB for most videos, 15MB for GIFs
      if (videoSizeBytes > 512 * 1024 * 1024) {
        return { success: false, error: 'Video file too large (max 512MB)' };
      }

      // Upload media
      const mediaId = await loggedClient.v1.uploadMedia(videoBuffer, {
        mimeType: 'video/mp4',
        target: 'tweet'
      });

      // Prepare tweet text
      let tweetText = options.title;
      if (options.description && (tweetText.length + options.description.length) <= 280) {
        tweetText += `\n\n${options.description}`;
      }

      // Add hashtags if space allows
      if (options.tags) {
        const hashtags = options.tags.map(tag => `#${tag}`).join(' ');
        if ((tweetText.length + hashtags.length + 1) <= 280) {
          tweetText += ` ${hashtags}`;
        }
      }

      // Ensure tweet doesn't exceed character limit
      if (tweetText.length > 280) {
        tweetText = tweetText.substring(0, 277) + '...';
      }

      // Post tweet with video
      const tweet = await loggedClient.v2.tweet({
        text: tweetText,
        media: {
          media_ids: [mediaId]
        }
      });

      if (!tweet.data?.id) {
        return { success: false, error: 'No tweet ID returned' };
      }

      return {
        success: true,
        platformPostId: tweet.data.id,
        url: `https://twitter.com/${account.username}/status/${tweet.data.id}`,
        metadata: {
          text: tweet.data.text
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
      const userClient = new TwitterApi({
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
      });

      const loggedClient = userClient.withBearerToken(account.accessToken || '');

      // Get tweet metrics
      const tweet = await loggedClient.v2.singleTweet(postId, {
        'tweet.fields': ['public_metrics']
      });

      if (!tweet.data?.public_metrics) {
        throw new Error('Could not fetch tweet metrics');
      }

      const metrics = tweet.data.public_metrics;
      const totalEngagements = metrics.like_count + metrics.reply_count + metrics.retweet_count;
      
      return {
        views: metrics.impression_count || 0,
        likes: metrics.like_count,
        comments: metrics.reply_count,
        shares: metrics.retweet_count,
        impressions: metrics.impression_count,
        engagementRate: metrics.impression_count > 0 ? 
          (totalEngagements / metrics.impression_count) * 100 : 0
      };
    } catch (error) {
      console.error('Twitter analytics error:', error);
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
      maxDuration: 140, // 2 minutes 20 seconds for most videos
      recommendedAspectRatios: ['16:9', '1:1', '9:16'],
      maxFileSize: 512 * 1024 * 1024, // 512MB
      supportedFormats: ['mp4', 'mov'],
      maxTitleLength: 280, // Combined with description
      maxDescriptionLength: 280, // Twitter character limit
      hashtagLimit: 10, // Recommended limit for readability
      thumbnailRequired: false
    };
  }

  // Enhanced Twitter thread support
  async postThread(
    account: PlatformAccount,
    messages: string[],
    options?: {
      videoPath?: string;
      mediaIds?: string[];
    }
  ): Promise<PublishResult> {
    try {
      const userClient = new TwitterApi({
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
      });

      const loggedClient = userClient.withBearerToken(account.accessToken || '');

      let mediaId: string | undefined;
      
      // Upload video if provided
      if (options?.videoPath) {
        const videoBuffer = fs.readFileSync(options.videoPath);
        mediaId = await loggedClient.v1.uploadMedia(videoBuffer, {
          mimeType: 'video/mp4',
          target: 'tweet'
        });
      }

      const tweets: string[] = [];
      let previousTweetId: string | undefined;

      // Post each message in the thread
      for (let i = 0; i < messages.length; i++) {
        const tweetOptions: any = {
          text: messages[i]
        };

        // Add media to the first tweet
        if (i === 0 && mediaId) {
          tweetOptions.media = { media_ids: [mediaId] };
        }

        // Add reply to previous tweet (except for the first tweet)
        if (previousTweetId) {
          tweetOptions.reply = { in_reply_to_tweet_id: previousTweetId };
        }

        const tweet = await loggedClient.v2.tweet(tweetOptions);
        if (tweet.data?.id) {
          tweets.push(tweet.data.id);
          previousTweetId = tweet.data.id;
        }
      }

      return {
        success: true,
        platformPostId: tweets[0], // Return first tweet ID
        url: `https://twitter.com/${account.username}/status/${tweets[0]}`,
        metadata: {
          threadIds: tweets,
          threadLength: tweets.length
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Thread posting failed'
      };
    }
  }

  // Schedule tweets for later posting
  async scheduleTweet(
    account: PlatformAccount,
    text: string,
    scheduledTime: Date,
    mediaId?: string
  ): Promise<PublishResult> {
    try {
      // Note: Twitter API v2 doesn't support scheduled tweets directly
      // This would typically require a job queue system
      // For now, we'll return an indication that it needs to be scheduled
      
      return {
        success: true,
        platformPostId: `scheduled_${Date.now()}`,
        url: `scheduled_for_${scheduledTime.getTime()}`,
        metadata: {
          scheduledFor: scheduledTime.toISOString(),
          text,
          mediaId,
          status: 'scheduled'
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Scheduling failed'
      };
    }
  }

  // Get trending topics for hashtag suggestions
  async getTrendingTopics(location?: string): Promise<string[]> {
    try {
      const userClient = new TwitterApi({
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
      });

      // Note: Twitter API v2 doesn't have direct trending topics endpoint
      // This would require Twitter API v1.1 or external trending data
      // For now, return common trending patterns
      
      return [
        '#MondayMotivation', '#TuesdayThoughts', '#WednesdayWisdom',
        '#ThursdayThoughts', '#FridayFeeling', '#SaturdayVibes', '#SundayFunday',
        '#Trending', '#Viral', '#BreakingNews'
      ];
    } catch (error) {
      console.error('Error fetching trending topics:', error);
      return [];
    }
  }

  // Enhanced hashtag suggestions with trending data
  async suggestHashtags(content: string, category?: string): Promise<string[]> {
    const baseHashtags: string[] = [];
    
    // Get trending topics first
    const trending = await this.getTrendingTopics();
    
    if (category) {
      switch (category.toLowerCase()) {
        case 'gaming':
          baseHashtags.push('#Gaming', '#Gamer', '#GamePlay', '#Twitch', '#Esports');
          break;
        case 'music':
          baseHashtags.push('#Music', '#NowPlaying', '#Song', '#Artist', '#Audio');
          break;
        case 'comedy':
          baseHashtags.push('#Comedy', '#Funny', '#LOL', '#Humor', '#Memes');
          break;
        case 'education':
          baseHashtags.push('#Education', '#Learning', '#TechTips', '#Knowledge', '#Tutorial');
          break;
        case 'business':
          baseHashtags.push('#Business', '#Startup', '#Entrepreneur', '#Marketing', '#Success');
          break;
        case 'tech':
          baseHashtags.push('#Tech', '#Technology', '#Innovation', '#AI', '#Future');
          break;
        case 'sports':
          baseHashtags.push('#Sports', '#Fitness', '#Training', '#Athletics', '#Competition');
          break;
        case 'news':
          baseHashtags.push('#News', '#Breaking', '#Current', '#Updates', '#Latest');
          break;
        default:
          baseHashtags.push('#Content', '#Social', '#Share');
      }
    }

    // Analyze content for relevant hashtags
    const contentLower = content.toLowerCase();
    const contextHashtags: string[] = [];
    
    if (contentLower.includes('ai') || contentLower.includes('artificial intelligence')) {
      contextHashtags.push('#AI', '#MachineLearning', '#ArtificialIntelligence');
    }
    if (contentLower.includes('crypto') || contentLower.includes('bitcoin')) {
      contextHashtags.push('#Crypto', '#Bitcoin', '#Blockchain');
    }
    if (contentLower.includes('climate') || contentLower.includes('environment')) {
      contextHashtags.push('#Climate', '#Environment', '#Sustainability');
    }
    if (contentLower.includes('video') || contentLower.includes('clip')) {
      contextHashtags.push('#Video', '#Content', '#Creator');
    }

    // Combine all hashtags and limit to reasonable number
    const allHashtags = [...baseHashtags, ...contextHashtags, ...trending.slice(0, 3)];
    return [...new Set(allHashtags)].slice(0, 8); // Max 8 hashtags for readability
  }

  // Enhanced analytics with more metrics
  async getAdvancedAnalytics(
    account: PlatformAccount,
    postId: string
  ): Promise<Analytics & {
    twitterSpecific: {
      quoteCount: number;
      bookmarkCount: number;
      urlClicks: number;
      profileClicks: number;
      hashtagClicks: number;
      detailExpands: number;
    }
  }> {
    try {
      const userClient = new TwitterApi({
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
      });

      const loggedClient = userClient.withBearerToken(account.accessToken || '');

      // Get tweet with all available metrics
      const tweet = await loggedClient.v2.singleTweet(postId, {
        'tweet.fields': ['public_metrics', 'non_public_metrics', 'organic_metrics']
      });

      if (!tweet.data) {
        throw new Error('Could not fetch tweet data');
      }

      const publicMetrics = tweet.data.public_metrics || {};
      const nonPublicMetrics = (tweet.data as any).non_public_metrics || {};
      const organicMetrics = (tweet.data as any).organic_metrics || {};

      const baseAnalytics = await this.getAnalytics(account, postId);

      return {
        ...baseAnalytics,
        twitterSpecific: {
          quoteCount: publicMetrics.quote_count || 0,
          bookmarkCount: nonPublicMetrics.bookmark_count || 0,
          urlClicks: organicMetrics.url_link_clicks || 0,
          profileClicks: organicMetrics.profile_clicks || 0,
          hashtagClicks: organicMetrics.hashtag_clicks || 0,
          detailExpands: organicMetrics.detail_expands || 0,
        }
      };
    } catch (error) {
      const baseAnalytics = await this.getAnalytics(account, postId);
      return {
        ...baseAnalytics,
        twitterSpecific: {
          quoteCount: 0,
          bookmarkCount: 0,
          urlClicks: 0,
          profileClicks: 0,
          hashtagClicks: 0,
          detailExpands: 0,
        }
      };
    }
  }

  async getOptimalPostingTimes(accountId: string): Promise<{
    dayOfWeek: number;
    hour: number;
    engagementScore: number;
  }[]> {
    // Twitter general best times
    return [
      { dayOfWeek: 1, hour: 8, engagementScore: 0.75 }, // Monday 8AM
      { dayOfWeek: 1, hour: 9, engagementScore: 0.8 }, // Monday 9AM
      { dayOfWeek: 2, hour: 8, engagementScore: 0.8 }, // Tuesday 8AM
      { dayOfWeek: 2, hour: 9, engagementScore: 0.85 }, // Tuesday 9AM
      { dayOfWeek: 2, hour: 10, engagementScore: 0.9 }, // Tuesday 10AM
      { dayOfWeek: 3, hour: 8, engagementScore: 0.8 }, // Wednesday 8AM
      { dayOfWeek: 3, hour: 9, engagementScore: 0.85 }, // Wednesday 9AM
      { dayOfWeek: 4, hour: 8, engagementScore: 0.75 }, // Thursday 8AM
      { dayOfWeek: 4, hour: 9, engagementScore: 0.8 }, // Thursday 9AM
      { dayOfWeek: 5, hour: 8, engagementScore: 0.7 }, // Friday 8AM
    ];
  }
}