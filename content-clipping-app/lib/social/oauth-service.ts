import { YouTubeService } from './youtube-service';
import { TikTokService } from './tiktok-service';
import { InstagramService } from './instagram-service';
import { TwitterService } from './twitter-service';
import { PlatformConfig, AuthResult } from './base-platform-service';
import { prisma } from '../prisma';
import crypto from 'crypto';

export interface PlatformServices {
  youtube: YouTubeService;
  tiktok: TikTokService;
  instagram: InstagramService;
  twitter: TwitterService;
}

export class OAuthService {
  private services: Partial<PlatformServices> = {};
  private pendingStates = new Map<string, {
    platform: string;
    userId: string;
    timestamp: number;
    redirectUrl?: string;
  }>();

  constructor() {
    // Clean up expired states every hour
    setInterval(() => this.cleanExpiredStates(), 60 * 60 * 1000);
  }

  private getBaseUrl(): string {
    return process.env.NEXTAUTH_URL || 'http://localhost:3000';
  }

  private createService(platform: keyof PlatformServices): PlatformServices[keyof PlatformServices] {
    switch (platform) {
      case 'youtube':
        return new YouTubeService({
          clientId: process.env.YOUTUBE_CLIENT_ID!,
          clientSecret: process.env.YOUTUBE_CLIENT_SECRET!,
          redirectUri: process.env.YOUTUBE_REDIRECT_URI || `${this.getBaseUrl()}/api/oauth/youtube/callback`,
        });
      case 'tiktok':
        return new TikTokService({
          clientId: process.env.TIKTOK_CLIENT_ID!,
          clientSecret: process.env.TIKTOK_CLIENT_SECRET!,
          redirectUri: process.env.TIKTOK_REDIRECT_URI || `${this.getBaseUrl()}/api/oauth/tiktok/callback`,
        });
      case 'instagram':
        return new InstagramService({
          clientId: process.env.INSTAGRAM_CLIENT_ID!,
          clientSecret: process.env.INSTAGRAM_CLIENT_SECRET!,
          redirectUri: process.env.INSTAGRAM_REDIRECT_URI || `${this.getBaseUrl()}/api/oauth/instagram/callback`,
        });
      case 'twitter':
        return new TwitterService({
          clientId: process.env.TWITTER_CLIENT_ID!,
          clientSecret: process.env.TWITTER_CLIENT_SECRET!,
          redirectUri: process.env.TWITTER_REDIRECT_URI || `${this.getBaseUrl()}/api/oauth/twitter/callback`,
        });
    }
  }

  private requireService<T extends keyof PlatformServices>(platform: T): PlatformServices[T] {
    if (!this.services[platform]) {
      this.services[platform] = this.createService(platform) as PlatformServices[T];
    }
    return this.services[platform] as PlatformServices[T];
  }

  // Generate secure auth URL for a platform
  async generateAuthUrl(
    platform: keyof PlatformServices,
    userId: string,
    redirectUrl?: string
  ): Promise<{ authUrl: string; state: string }> {
    const service = this.requireService(platform);

    // Generate secure state parameter
    const state = crypto.randomBytes(32).toString('hex');
    
    // Store state for verification
    this.pendingStates.set(state, {
      platform,
      userId,
      timestamp: Date.now(),
      redirectUrl
    });

    // Get auth URL from platform service
    const authUrl = service.generateAuthUrl(state);

    return { authUrl, state };
  }

  // Handle OAuth callback and create/update platform account
  async handleCallback(
    platform: keyof PlatformServices,
    code: string,
    state: string
  ): Promise<{
    success: boolean;
    accountId?: string;
    redirectUrl?: string;
    error?: string;
  }> {
    try {
      // Verify state parameter
      const pendingAuth = this.pendingStates.get(state);
      if (!pendingAuth || pendingAuth.platform !== platform) {
        return { success: false, error: 'Invalid or expired state parameter' };
      }

      // Check if state is not too old (10 minutes max)
      if (Date.now() - pendingAuth.timestamp > 10 * 60 * 1000) {
        this.pendingStates.delete(state);
        return { success: false, error: 'Authentication session expired' };
      }

      // Handle authentication with platform service
      const authResult = await this.requireService(platform).handleAuthCallback(code, state);
      
      if (!authResult.success || !authResult.accountInfo) {
        return { success: false, error: authResult.error || 'Authentication failed' };
      }

      // Get or create platform record
      const platformRecord = await this.getOrCreatePlatform(platform);

      // Create or update platform account
      const platformAccount = await prisma.platformAccount.upsert({
        where: {
          userId_platformId_accountId: {
            userId: pendingAuth.userId,
            platformId: platformRecord.id,
            accountId: authResult.accountInfo.id
          }
        },
        update: {
          username: authResult.accountInfo.username,
          displayName: authResult.accountInfo.displayName,
          profilePicture: authResult.accountInfo.profilePicture,
          accessToken: authResult.accessToken,
          refreshToken: authResult.refreshToken,
          tokenExpiresAt: authResult.expiresAt,
          isActive: true,
          lastSyncAt: new Date(),
        },
        create: {
          userId: pendingAuth.userId,
          platformId: platformRecord.id,
          accountId: authResult.accountInfo.id,
          username: authResult.accountInfo.username,
          displayName: authResult.accountInfo.displayName,
          profilePicture: authResult.accountInfo.profilePicture,
          accessToken: authResult.accessToken,
          refreshToken: authResult.refreshToken,
          tokenExpiresAt: authResult.expiresAt,
          scopes: authResult.scopes || [],
          isActive: true,
          lastSyncAt: new Date(),
          settings: {},
        }
      });

      // Clean up state
      this.pendingStates.delete(state);

      return {
        success: true,
        accountId: platformAccount.id,
        redirectUrl: pendingAuth.redirectUrl
      };

    } catch (error) {
      console.error(`OAuth callback error for ${platform}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Authentication failed'
      };
    }
  }

  // Refresh access token for a platform account
  async refreshToken(accountId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const account = await prisma.platformAccount.findUnique({
        where: { id: accountId },
        include: { platform: true }
      });

      if (!account || !account.refreshToken) {
        return { success: false, error: 'Account not found or no refresh token' };
      }

      const platformName = account.platform.name as keyof PlatformServices;
      const service = this.requireService(platformName);

      const refreshResult = await service.refreshAccessToken(account.refreshToken);

      if (!refreshResult.success) {
        // Mark account as inactive if refresh fails
        await prisma.platformAccount.update({
          where: { id: accountId },
          data: { isActive: false }
        });
        return { success: false, error: refreshResult.error };
      }

      // Update account with new tokens
      await prisma.platformAccount.update({
        where: { id: accountId },
        data: {
          accessToken: refreshResult.accessToken,
          refreshToken: refreshResult.refreshToken || account.refreshToken,
          tokenExpiresAt: refreshResult.expiresAt,
          isActive: true,
          lastSyncAt: new Date(),
        }
      });

      return { success: true };

    } catch (error) {
      console.error('Token refresh error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Token refresh failed'
      };
    }
  }

  // Disconnect a platform account
  async disconnectAccount(accountId: string, userId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      // Verify ownership and soft delete
      const deletedAccount = await prisma.platformAccount.updateMany({
        where: {
          id: accountId,
          userId: userId
        },
        data: {
          isActive: false,
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null
        }
      });

      if (deletedAccount.count === 0) {
        return { success: false, error: 'Account not found or access denied' };
      }

      return { success: true };

    } catch (error) {
      console.error('Account disconnection error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Disconnection failed'
      };
    }
  }

  // Get all connected accounts for a user
  async getUserAccounts(userId: string) {
    return await prisma.platformAccount.findMany({
      where: {
        userId,
        isActive: true
      },
      include: {
        platform: true
      },
      orderBy: {
        lastSyncAt: 'desc'
      }
    });
  }

  // Check if token needs refresh (within 5 minutes of expiry)
  async checkAndRefreshToken(accountId: string): Promise<boolean> {
    try {
      const account = await prisma.platformAccount.findUnique({
        where: { id: accountId }
      });

      if (!account || !account.tokenExpiresAt) {
        return true; // Assume valid if no expiry date
      }

      const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
      
      if (account.tokenExpiresAt <= fiveMinutesFromNow) {
        const refreshResult = await this.refreshToken(accountId);
        return refreshResult.success;
      }

      return true; // Token is still valid
    } catch (error) {
      console.error('Token check error:', error);
      return false;
    }
  }

  // Get platform service instance
  getService(platform: keyof PlatformServices) {
    return this.requireService(platform);
  }

  private async getOrCreatePlatform(platformName: string) {
    return await prisma.socialPlatform.upsert({
      where: { name: platformName },
      update: {},
      create: {
        name: platformName,
        displayName: this.getPlatformDisplayName(platformName),
        isActive: true,
        apiVersion: this.getPlatformApiVersion(platformName),
      }
    });
  }

  private getPlatformDisplayName(platform: string): string {
    const displayNames: { [key: string]: string } = {
      youtube: 'YouTube',
      tiktok: 'TikTok',
      instagram: 'Instagram',
      twitter: 'Twitter / X'
    };
    return displayNames[platform] || platform;
  }

  private getPlatformApiVersion(platform: string): string {
    const versions: { [key: string]: string } = {
      youtube: 'v3',
      tiktok: 'v2',
      instagram: 'v18.0',
      twitter: 'v2'
    };
    return versions[platform] || 'v1';
  }

  private cleanExpiredStates() {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [state, data] of this.pendingStates.entries()) {
      if (data.timestamp < oneHourAgo) {
        this.pendingStates.delete(state);
      }
    }
  }

  // Initialize default social platforms in database
  async initializePlatforms() {
    const platforms = [
      { name: 'youtube', displayName: 'YouTube', apiVersion: 'v3' },
      { name: 'tiktok', displayName: 'TikTok', apiVersion: 'v2' },
      { name: 'instagram', displayName: 'Instagram', apiVersion: 'v18.0' },
      { name: 'twitter', displayName: 'Twitter / X', apiVersion: 'v2' },
    ];

    for (const platform of platforms) {
      await prisma.socialPlatform.upsert({
        where: { name: platform.name },
        update: {
          displayName: platform.displayName,
          apiVersion: platform.apiVersion,
        },
        create: {
          name: platform.name,
          displayName: platform.displayName,
          isActive: true,
          apiVersion: platform.apiVersion,
        }
      });
    }
  }
}

// Global OAuth service instance
export const oauthService = new OAuthService();
