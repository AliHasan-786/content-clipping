import { PlatformAccount, ContentVariation, PublishedContent } from '@prisma/client';

export interface PlatformConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export interface VideoUploadOptions {
  title: string;
  description?: string;
  tags?: string[];
  privacy?: 'public' | 'private' | 'unlisted';
  scheduledPublishTime?: Date;
  location?: {
    latitude: number;
    longitude: number;
  };
  thumbnail?: string;
}

export interface PublishResult {
  success: boolean;
  platformPostId?: string;
  url?: string;
  error?: string;
  metadata?: any;
}

export interface AuthResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
  error?: string;
  accountInfo?: {
    id: string;
    username: string;
    displayName: string;
    profilePicture?: string;
  };
}

export interface Analytics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  impressions?: number;
  reach?: number;
  engagementRate: number;
  watchTime?: number;
  completionRate?: number;
}

export abstract class BasePlatformService {
  protected config: PlatformConfig;
  protected platformName: string;

  constructor(config: PlatformConfig, platformName: string) {
    this.config = config;
    this.platformName = platformName;
  }

  // Abstract methods that each platform must implement
  abstract generateAuthUrl(state?: string): string;
  abstract handleAuthCallback(code: string, state?: string): Promise<AuthResult>;
  abstract refreshAccessToken(refreshToken: string): Promise<AuthResult>;
  abstract uploadVideo(
    account: PlatformAccount,
    videoPath: string,
    options: VideoUploadOptions
  ): Promise<PublishResult>;
  abstract getAnalytics(
    account: PlatformAccount,
    postId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<Analytics>;

  // Common utility methods
  protected validateConfig(): void {
    if (!this.config.clientId || !this.config.clientSecret || !this.config.redirectUri) {
      throw new Error(`Invalid ${this.platformName} configuration`);
    }
  }

  protected isTokenExpired(expiresAt?: Date): boolean {
    if (!expiresAt) return false;
    return new Date() >= new Date(expiresAt.getTime() - 5 * 60 * 1000); // 5 minutes buffer
  }

  protected generateState(): string {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }

  // Common video validation
  protected validateVideo(videoPath: string, options: VideoUploadOptions): void {
    if (!videoPath) {
      throw new Error('Video path is required');
    }
    if (!options.title || options.title.trim().length === 0) {
      throw new Error('Video title is required');
    }
  }

  // Platform-specific content optimization hints
  abstract getOptimizationHints(): {
    maxDuration: number; // in seconds
    recommendedAspectRatios: string[];
    maxFileSize: number; // in bytes
    supportedFormats: string[];
    maxTitleLength: number;
    maxDescriptionLength: number;
    hashtagLimit: number;
    thumbnailRequired: boolean;
  };

  // Platform-specific hashtag suggestions
  abstract suggestHashtags(content: string, category?: string): Promise<string[]>;

  // Platform-specific optimal posting times
  abstract getOptimalPostingTimes(accountId: string): Promise<{
    dayOfWeek: number;
    hour: number;
    engagementScore: number;
  }[]>;
}

export interface PlatformServiceRegistry {
  youtube: BasePlatformService;
  tiktok: BasePlatformService;
  instagram: BasePlatformService;
  twitter: BasePlatformService;
}