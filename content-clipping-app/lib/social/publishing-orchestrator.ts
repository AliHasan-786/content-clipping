import { prisma } from '../prisma';
import { oauthService } from './oauth-service';
import { VideoOptimizationService } from './video-optimization-service';
import { CaptionOptimizationService } from './caption-optimization-service';
import { HashtagService } from './hashtag-service';
import { ThumbnailService } from './thumbnail-service';
import { PublishingStatus, PlatformAccount, PublishingCampaign } from '@prisma/client';
import { VideoUploadOptions, PublishResult } from './base-platform-service';
import path from 'path';
import fs from 'fs';

export interface PublishingRequest {
  userId: string;
  clipId?: string;
  videoId?: string;
  title: string;
  description?: string;
  tags?: string[];
  platforms: {
    platform: string;
    accountId: string;
    contentType?: 'shorts' | 'reels' | 'story' | 'post' | 'tweet';
    scheduledAt?: Date;
    customization?: {
      title?: string;
      description?: string;
      tags?: string[];
      thumbnail?: string;
    };
  }[];
  videoPath: string;
  autoOptimize?: boolean;
  approvalRequired?: boolean;
  globalScheduledAt?: Date;
}

export interface PublishingProgress {
  campaignId: string;
  totalPlatforms: number;
  completed: number;
  failed: number;
  pending: number;
  status: 'preparing' | 'optimizing' | 'uploading' | 'completed' | 'failed';
  results: {
    platform: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    result?: PublishResult;
    error?: string;
  }[];
}

export class PublishingOrchestrator {
  private videoOptimizer: VideoOptimizationService;
  private captionOptimizer: CaptionOptimizationService;
  private hashtagService: HashtagService;
  private thumbnailService: ThumbnailService;

  constructor() {
    this.videoOptimizer = new VideoOptimizationService();
    this.captionOptimizer = new CaptionOptimizationService();
    this.hashtagService = new HashtagService();
    this.thumbnailService = new ThumbnailService();
  }

  // Main orchestration method for multi-platform publishing
  async publishToMultiplePlatforms(request: PublishingRequest): Promise<{
    success: boolean;
    campaignId?: string;
    message: string;
    errors?: string[];
  }> {
    try {
      // Validate request
      const validation = await this.validatePublishingRequest(request);
      if (!validation.valid) {
        return {
          success: false,
          message: 'Request validation failed',
          errors: validation.errors
        };
      }

      // Create publishing campaign
      const campaign = await this.createPublishingCampaign(request);

      // Process platforms in parallel if not requiring approval
      if (!request.approvalRequired) {
        this.processPublishingCampaign(campaign.id).catch(error => {
          console.error('Error processing publishing campaign:', error);
        });
      }

      return {
        success: true,
        campaignId: campaign.id,
        message: request.approvalRequired 
          ? 'Publishing campaign created and awaiting approval'
          : 'Publishing campaign started'
      };

    } catch (error) {
      console.error('Publishing orchestration error:', error);
      return {
        success: false,
        message: 'Failed to start publishing campaign',
        errors: [error instanceof Error ? error.message : 'Unknown error']
      };
    }
  }

  // Process a publishing campaign
  async processPublishingCampaign(campaignId: string): Promise<void> {
    try {
      const campaign = await prisma.publishingCampaign.findUnique({
        where: { id: campaignId },
        include: {
          user: true,
          clip: true,
          video: true,
          platform: true,
          account: true
        }
      });

      if (!campaign) {
        throw new Error('Campaign not found');
      }

      // Update campaign status
      await this.updateCampaignStatus(campaignId, PublishingStatus.PROCESSING);

      // Get all platform accounts for this campaign
      const platformAccounts = await prisma.platformAccount.findMany({
        where: {
          userId: campaign.userId,
          isActive: true
        },
        include: {
          platform: true
        }
      });

      // Get video file path (from clip or video)
      let videoPath = '';
      if (campaign.clip) {
        videoPath = campaign.clip.exportUrl || '';
      } else if (campaign.video) {
        videoPath = campaign.video.url;
      }

      if (!videoPath || !fs.existsSync(videoPath)) {
        throw new Error('Video file not found');
      }

      // Process each platform
      const publishingTasks = platformAccounts.map(account => 
        this.publishToPlatform(campaign, account, videoPath)
      );

      // Execute all publishing tasks
      const results = await Promise.allSettled(publishingTasks);

      // Determine final campaign status
      const hasSuccessful = results.some(result => 
        result.status === 'fulfilled' && result.value.success
      );
      const hasFailures = results.some(result => 
        result.status === 'rejected' || 
        (result.status === 'fulfilled' && !result.value.success)
      );

      const finalStatus = hasSuccessful && !hasFailures 
        ? PublishingStatus.PUBLISHED 
        : hasSuccessful 
          ? PublishingStatus.PUBLISHED // Partial success
          : PublishingStatus.FAILED;

      await this.updateCampaignStatus(campaignId, finalStatus);

      // Record publishing history
      await this.recordPublishingHistory(campaignId, 'COMPLETED', finalStatus);

    } catch (error) {
      console.error('Error processing campaign:', error);
      await this.updateCampaignStatus(campaignId, PublishingStatus.FAILED, error.message);
      await this.recordPublishingHistory(campaignId, 'FAILED', error.message);
    }
  }

  // Publish to a specific platform
  private async publishToPlatform(
    campaign: PublishingCampaign & { 
      user: any; 
      clip?: any; 
      video?: any; 
      platform: any; 
      account: any; 
    },
    account: PlatformAccount & { platform: any },
    videoPath: string
  ): Promise<PublishResult> {
    try {
      // Check and refresh token if needed
      const tokenValid = await oauthService.checkAndRefreshToken(account.id);
      if (!tokenValid) {
        throw new Error('Failed to refresh access token');
      }

      // Get optimized content for this platform
      const optimizedContent = await this.optimizeContentForPlatform(
        campaign,
        account.platform.name,
        videoPath
      );

      // Get platform service
      const service = oauthService.getService(account.platform.name);
      if (!service) {
        throw new Error(`No service available for platform: ${account.platform.name}`);
      }

      // Prepare upload options
      const uploadOptions: VideoUploadOptions = {
        title: optimizedContent.title,
        description: optimizedContent.description,
        tags: optimizedContent.hashtags,
        privacy: 'public',
        thumbnail: optimizedContent.thumbnailPath,
        scheduledPublishTime: campaign.scheduledAt || undefined
      };

      // Upload to platform
      const result = await service.uploadVideo(
        account,
        optimizedContent.videoPath,
        uploadOptions
      );

      // Record the result
      if (result.success) {
        await this.recordSuccessfulPublish(campaign, account, result);
      } else {
        await this.recordFailedPublish(campaign, account, result.error || 'Unknown error');
      }

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown platform error';
      await this.recordFailedPublish(campaign, account, errorMessage);
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  // Optimize content for a specific platform
  private async optimizeContentForPlatform(
    campaign: PublishingCampaign & { user: any; clip?: any; video?: any },
    platform: string,
    videoPath: string
  ): Promise<{
    title: string;
    description?: string;
    hashtags: string[];
    videoPath: string;
    thumbnailPath?: string;
  }> {
    // Get campaign metadata
    const metadata = campaign.metadata as any;
    const title = metadata?.title || campaign.title;
    const description = metadata?.description || campaign.description;
    const originalTags = metadata?.tags || [];

    // Optimize video for platform
    const videoOptimization = await this.videoOptimizer.optimizeForPlatform(
      videoPath,
      platform
    );

    if (!videoOptimization.success) {
      throw new Error(`Video optimization failed: ${videoOptimization.error}`);
    }

    // Optimize caption for platform
    const captionOptimization = await this.captionOptimizer.optimizeCaption(
      title,
      description,
      {
        platform,
        tone: 'engaging',
        includeHashtags: true,
        includeCallToAction: true
      }
    );

    // Get optimized hashtags
    const hashtagSuggestions = await this.hashtagService.suggestHashtags(
      title + ' ' + (description || ''),
      platform
    );

    const optimizedHashtags = [
      ...captionOptimization.hashtags,
      ...hashtagSuggestions.slice(0, 10).map(h => h.hashtag),
      ...originalTags
    ]
    .filter((tag, index, self) => self.indexOf(tag) === index) // Remove duplicates
    .slice(0, this.getHashtagLimitForPlatform(platform));

    // Generate optimized thumbnail
    let thumbnailPath: string | undefined;
    try {
      const thumbnailResult = await this.thumbnailService.generateThumbnail(
        videoOptimization.outputPath!,
        {
          platform,
          addText: {
            title: captionOptimization.title.length > 50 
              ? captionOptimization.title.substring(0, 47) + '...'
              : captionOptimization.title,
            position: 'center'
          }
        }
      );
      
      if (thumbnailResult.success) {
        thumbnailPath = thumbnailResult.outputPath;
      }
    } catch (error) {
      console.warn('Thumbnail generation failed:', error);
    }

    return {
      title: captionOptimization.title,
      description: captionOptimization.description,
      hashtags: optimizedHashtags,
      videoPath: videoOptimization.outputPath!,
      thumbnailPath
    };
  }

  // Get publishing progress for a campaign
  async getPublishingProgress(campaignId: string): Promise<PublishingProgress | null> {
    try {
      const campaign = await prisma.publishingCampaign.findUnique({
        where: { id: campaignId },
        include: {
          publishedContent: {
            include: {
              account: {
                include: {
                  platform: true
                }
              }
            }
          }
        }
      });

      if (!campaign) {
        return null;
      }

      // Get all target platforms from metadata
      const metadata = campaign.metadata as any;
      const targetPlatforms = metadata?.platforms || [];

      const results = targetPlatforms.map((platformConfig: any) => {
        const publishedContent = campaign.publishedContent.find(
          content => content.account.platform.name === platformConfig.platform
        );

        return {
          platform: platformConfig.platform,
          status: publishedContent 
            ? (publishedContent.status === 'PUBLISHED' ? 'completed' : 'failed')
            : 'pending',
          result: publishedContent ? {
            success: publishedContent.status === 'PUBLISHED',
            platformPostId: publishedContent.platformPostId || undefined,
            url: publishedContent.url || undefined
          } : undefined
        };
      });

      const completed = results.filter(r => r.status === 'completed').length;
      const failed = results.filter(r => r.status === 'failed').length;
      const pending = results.filter(r => r.status === 'pending').length;

      let overallStatus: PublishingProgress['status'];
      if (campaign.status === PublishingStatus.DRAFT) {
        overallStatus = 'preparing';
      } else if (campaign.status === PublishingStatus.PROCESSING) {
        overallStatus = 'uploading';
      } else if (campaign.status === PublishingStatus.PUBLISHED) {
        overallStatus = 'completed';
      } else {
        overallStatus = 'failed';
      }

      return {
        campaignId,
        totalPlatforms: targetPlatforms.length,
        completed,
        failed,
        pending,
        status: overallStatus,
        results
      };

    } catch (error) {
      console.error('Error getting publishing progress:', error);
      return null;
    }
  }

  // Approve a pending campaign
  async approveCampaign(campaignId: string, userId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      const campaign = await prisma.publishingCampaign.findFirst({
        where: {
          id: campaignId,
          userId: userId,
          status: PublishingStatus.DRAFT,
          approvalRequired: true
        }
      });

      if (!campaign) {
        return {
          success: false,
          message: 'Campaign not found or not pending approval'
        };
      }

      // Update campaign approval status
      await prisma.publishingCampaign.update({
        where: { id: campaignId },
        data: {
          isApproved: true,
          approvedAt: new Date(),
          approvedBy: userId
        }
      });

      // Start processing
      this.processPublishingCampaign(campaignId).catch(error => {
        console.error('Error processing approved campaign:', error);
      });

      await this.recordPublishingHistory(campaignId, 'APPROVED', 'Campaign approved by user');

      return {
        success: true,
        message: 'Campaign approved and publishing started'
      };

    } catch (error) {
      return {
        success: false,
        message: 'Failed to approve campaign'
      };
    }
  }

  // Cancel a campaign
  async cancelCampaign(campaignId: string, userId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      const campaign = await prisma.publishingCampaign.findFirst({
        where: {
          id: campaignId,
          userId: userId,
          status: {
            in: [PublishingStatus.DRAFT, PublishingStatus.SCHEDULED, PublishingStatus.PROCESSING]
          }
        }
      });

      if (!campaign) {
        return {
          success: false,
          message: 'Campaign not found or cannot be cancelled'
        };
      }

      await prisma.publishingCampaign.update({
        where: { id: campaignId },
        data: {
          status: PublishingStatus.CANCELLED
        }
      });

      await this.recordPublishingHistory(campaignId, 'CANCELLED', 'Campaign cancelled by user');

      return {
        success: true,
        message: 'Campaign cancelled successfully'
      };

    } catch (error) {
      return {
        success: false,
        message: 'Failed to cancel campaign'
      };
    }
  }

  // Helper methods
  private async validatePublishingRequest(request: PublishingRequest): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    // Check if video file exists
    if (!fs.existsSync(request.videoPath)) {
      errors.push('Video file does not exist');
    }

    // Validate platforms
    if (!request.platforms || request.platforms.length === 0) {
      errors.push('At least one platform must be specified');
    }

    // Validate platform accounts
    for (const platformConfig of request.platforms) {
      const account = await prisma.platformAccount.findFirst({
        where: {
          id: platformConfig.accountId,
          userId: request.userId,
          isActive: true
        }
      });

      if (!account) {
        errors.push(`Invalid or inactive account for platform: ${platformConfig.platform}`);
      }
    }

    // Validate content
    if (!request.title.trim()) {
      errors.push('Title is required');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  private async createPublishingCampaign(request: PublishingRequest): Promise<PublishingCampaign> {
    // Create campaign for the first platform (we'll create one campaign per platform in the future)
    const firstPlatform = request.platforms[0];
    
    const platform = await prisma.socialPlatform.findFirst({
      where: { name: firstPlatform.platform }
    });

    if (!platform) {
      throw new Error(`Platform not found: ${firstPlatform.platform}`);
    }

    return await prisma.publishingCampaign.create({
      data: {
        title: request.title,
        description: request.description,
        userId: request.userId,
        clipId: request.clipId,
        videoId: request.videoId,
        platformId: platform.id,
        accountId: firstPlatform.accountId,
        status: PublishingStatus.DRAFT,
        scheduledAt: request.globalScheduledAt || firstPlatform.scheduledAt,
        autoOptimize: request.autoOptimize !== false,
        approvalRequired: request.approvalRequired === true,
        metadata: {
          platforms: request.platforms,
          originalVideoPath: request.videoPath,
          tags: request.tags || []
        }
      }
    });
  }

  private async updateCampaignStatus(
    campaignId: string, 
    status: PublishingStatus, 
    errorMessage?: string
  ): Promise<void> {
    await prisma.publishingCampaign.update({
      where: { id: campaignId },
      data: {
        status,
        errorMessage,
        publishedAt: status === PublishingStatus.PUBLISHED ? new Date() : undefined
      }
    });
  }

  private async recordSuccessfulPublish(
    campaign: PublishingCampaign,
    account: PlatformAccount,
    result: PublishResult
  ): Promise<void> {
    await prisma.publishedContent.create({
      data: {
        campaignId: campaign.id,
        accountId: account.id,
        platformPostId: result.platformPostId,
        title: campaign.title,
        description: campaign.description,
        url: result.url,
        status: 'PUBLISHED',
        metadata: result.metadata || {}
      }
    });
  }

  private async recordFailedPublish(
    campaign: PublishingCampaign,
    account: PlatformAccount,
    error: string
  ): Promise<void> {
    // Could create a failed publish record or update campaign with error details
    console.error(`Failed to publish to ${account.platform}: ${error}`);
  }

  private async recordPublishingHistory(
    campaignId: string,
    action: string,
    message?: string
  ): Promise<void> {
    const campaign = await prisma.publishingCampaign.findUnique({
      where: { id: campaignId }
    });

    if (campaign) {
      await prisma.publishingHistory.create({
        data: {
          campaignId,
          accountId: campaign.accountId,
          action,
          status: campaign.status,
          message,
          userId: campaign.userId
        }
      });
    }
  }

  private getHashtagLimitForPlatform(platform: string): number {
    const limits = {
      youtube: 15,
      tiktok: 5,
      instagram: 30,
      twitter: 8
    };
    return limits[platform] || 10;
  }

  // Scheduled publishing support
  async processScheduledCampaigns(): Promise<void> {
    try {
      const now = new Date();
      
      const scheduledCampaigns = await prisma.publishingCampaign.findMany({
        where: {
          status: PublishingStatus.SCHEDULED,
          scheduledAt: {
            lte: now
          },
          isApproved: true
        }
      });

      for (const campaign of scheduledCampaigns) {
        console.log(`Processing scheduled campaign: ${campaign.id}`);
        this.processPublishingCampaign(campaign.id).catch(error => {
          console.error(`Error processing scheduled campaign ${campaign.id}:`, error);
        });
      }

    } catch (error) {
      console.error('Error processing scheduled campaigns:', error);
    }
  }

  // Retry failed publishing
  async retryFailedCampaign(campaignId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      const campaign = await prisma.publishingCampaign.findUnique({
        where: { id: campaignId }
      });

      if (!campaign || campaign.status !== PublishingStatus.FAILED) {
        return {
          success: false,
          message: 'Campaign not found or not in failed state'
        };
      }

      if (campaign.retryCount >= campaign.maxRetries) {
        return {
          success: false,
          message: 'Maximum retry attempts exceeded'
        };
      }

      // Increment retry count and reset status
      await prisma.publishingCampaign.update({
        where: { id: campaignId },
        data: {
          status: PublishingStatus.DRAFT,
          retryCount: campaign.retryCount + 1,
          errorMessage: null
        }
      });

      // Start processing again
      this.processPublishingCampaign(campaignId).catch(error => {
        console.error('Error retrying campaign:', error);
      });

      return {
        success: true,
        message: 'Campaign retry initiated'
      };

    } catch (error) {
      return {
        success: false,
        message: 'Failed to retry campaign'
      };
    }
  }
}