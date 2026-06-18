import { prisma } from '../prisma';
import { publishingQueue } from './publishing-queue';
import { PublishingStatus } from '@prisma/client';

export interface RetryPolicy {
  maxAttempts: number;
  backoffStrategy: 'fixed' | 'exponential' | 'linear';
  initialDelay: number; // in milliseconds
  maxDelay?: number; // in milliseconds
  jitter?: boolean; // Add randomness to prevent thundering herd
  retryableErrors?: string[]; // Specific error types to retry
  nonRetryableErrors?: string[]; // Specific error types NOT to retry
}

export interface RetryAttempt {
  attemptNumber: number;
  timestamp: Date;
  error: string;
  nextRetryAt?: Date;
  success: boolean;
  duration: number; // milliseconds
}

export interface RetryAnalytics {
  campaignId: string;
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
  averageRetryDelay: number;
  mostCommonErrors: Array<{
    error: string;
    count: number;
  }>;
  successRate: number;
  lastAttempt: Date;
}

export class RetryService {
  private defaultPolicies: { [key: string]: RetryPolicy } = {
    youtube: {
      maxAttempts: 5,
      backoffStrategy: 'exponential',
      initialDelay: 30000, // 30 seconds
      maxDelay: 1800000, // 30 minutes
      jitter: true,
      retryableErrors: [
        'quota_exceeded',
        'rate_limit_exceeded',
        'service_unavailable',
        'temporary_failure',
        'network_timeout',
        'upload_timeout'
      ],
      nonRetryableErrors: [
        'invalid_credentials',
        'forbidden',
        'video_too_large',
        'unsupported_format',
        'copyright_violation'
      ]
    },
    tiktok: {
      maxAttempts: 4,
      backoffStrategy: 'exponential',
      initialDelay: 60000, // 1 minute
      maxDelay: 3600000, // 1 hour
      jitter: true,
      retryableErrors: [
        'rate_limit_exceeded',
        'server_error',
        'upload_failed',
        'processing_error'
      ],
      nonRetryableErrors: [
        'invalid_token',
        'video_rejected',
        'content_violation',
        'account_suspended'
      ]
    },
    instagram: {
      maxAttempts: 4,
      backoffStrategy: 'exponential',
      initialDelay: 45000, // 45 seconds
      maxDelay: 2700000, // 45 minutes
      jitter: true,
      retryableErrors: [
        'api_rate_limit',
        'upload_timeout',
        'processing_timeout',
        'server_busy'
      ],
      nonRetryableErrors: [
        'invalid_access_token',
        'media_too_large',
        'unsupported_media_type',
        'business_account_required'
      ]
    },
    twitter: {
      maxAttempts: 3,
      backoffStrategy: 'fixed',
      initialDelay: 300000, // 5 minutes (Twitter rate limits)
      jitter: false,
      retryableErrors: [
        'rate_limit_exceeded',
        'over_capacity',
        'internal_error'
      ],
      nonRetryableErrors: [
        'invalid_credentials',
        'suspended_account',
        'tweet_limit_exceeded',
        'duplicate_content'
      ]
    }
  };

  // Determine if an error should be retried
  shouldRetry(
    error: string,
    platform: string,
    currentAttempt: number,
    customPolicy?: Partial<RetryPolicy>
  ): {
    shouldRetry: boolean;
    reason: string;
    nextRetryDelay?: number;
  } {
    const policy = this.getRetryPolicy(platform, customPolicy);
    
    // Check if max attempts reached
    if (currentAttempt >= policy.maxAttempts) {
      return {
        shouldRetry: false,
        reason: `Maximum retry attempts (${policy.maxAttempts}) reached`
      };
    }

    // Check if error is explicitly non-retryable
    if (policy.nonRetryableErrors?.some(nonRetryable => 
      error.toLowerCase().includes(nonRetryable.toLowerCase())
    )) {
      return {
        shouldRetry: false,
        reason: `Error type '${error}' is marked as non-retryable`
      };
    }

    // Check if error is retryable (if whitelist exists)
    if (policy.retryableErrors?.length) {
      const isRetryable = policy.retryableErrors.some(retryable => 
        error.toLowerCase().includes(retryable.toLowerCase())
      );
      
      if (!isRetryable) {
        return {
          shouldRetry: false,
          reason: `Error type '${error}' is not in retryable errors list`
        };
      }
    }

    // Calculate next retry delay
    const delay = this.calculateRetryDelay(currentAttempt, policy);

    return {
      shouldRetry: true,
      reason: `Retryable error, attempt ${currentAttempt + 1}/${policy.maxAttempts}`,
      nextRetryDelay: delay
    };
  }

  // Schedule a retry for a failed campaign
  async scheduleRetry(
    campaignId: string,
    error: string,
    platform: string,
    customPolicy?: Partial<RetryPolicy>
  ): Promise<{
    success: boolean;
    message: string;
    retryAt?: Date;
    attemptNumber?: number;
  }> {
    try {
      // Get current campaign info
      const campaign = await prisma.publishingCampaign.findUnique({
        where: { id: campaignId },
        include: { 
          platform: true,
          publishingHistory: {
            where: { action: 'RETRIED' },
            orderBy: { timestamp: 'desc' }
          }
        }
      });

      if (!campaign) {
        return {
          success: false,
          message: 'Campaign not found'
        };
      }

      const currentAttempt = campaign.retryCount;
      const retryDecision = this.shouldRetry(error, platform, currentAttempt, customPolicy);

      if (!retryDecision.shouldRetry) {
        // Mark campaign as permanently failed
        await this.markAsPermanentlyFailed(campaignId, retryDecision.reason);
        
        return {
          success: false,
          message: `Retry not possible: ${retryDecision.reason}`
        };
      }

      // Calculate retry time
      const retryAt = new Date(Date.now() + retryDecision.nextRetryDelay!);
      
      // Update campaign retry count and schedule
      await prisma.publishingCampaign.update({
        where: { id: campaignId },
        data: {
          retryCount: currentAttempt + 1,
          status: PublishingStatus.SCHEDULED,
          errorMessage: null, // Clear previous error
          scheduledAt: retryAt
        }
      });

      // Record retry attempt in history
      await this.recordRetryAttempt(campaignId, currentAttempt + 1, error, retryAt);

      // Schedule the retry job
      await publishingQueue.addPublishingJob(
        {
          type: 'RETRY',
          campaignId,
          userId: campaign.userId,
          retryCount: currentAttempt + 1,
          metadata: { originalError: error, platform }
        },
        {
          scheduledFor: retryAt,
          priority: 8, // Higher priority for retries
          attempts: 1 // Only try once per retry job
        }
      );

      return {
        success: true,
        message: `Retry scheduled for ${retryAt.toISOString()}`,
        retryAt,
        attemptNumber: currentAttempt + 1
      };

    } catch (error) {
      console.error('Error scheduling retry:', error);
      return {
        success: false,
        message: 'Failed to schedule retry'
      };
    }
  }

  // Analyze retry patterns and success rates
  async analyzeRetryPatterns(
    timeframeDays = 30,
    platform?: string
  ): Promise<{
    overallStats: {
      totalCampaigns: number;
      campaignsWithRetries: number;
      averageRetryCount: number;
      finalSuccessRate: number;
    };
    platformStats: Array<{
      platform: string;
      retryRate: number;
      averageRetryCount: number;
      successRateAfterRetry: number;
      commonErrors: string[];
    }>;
    retryEffectiveness: Array<{
      attemptNumber: number;
      successRate: number;
      averageDelay: number;
    }>;
  }> {
    try {
      const startDate = new Date(Date.now() - timeframeDays * 24 * 60 * 60 * 1000);

      // Get campaigns with retry data
      const campaigns = await prisma.publishingCampaign.findMany({
        where: {
          createdAt: { gte: startDate },
          ...(platform && {
            platform: { name: platform }
          })
        },
        include: {
          platform: true,
          publishingHistory: {
            where: {
              action: { in: ['RETRIED', 'FAILED', 'PUBLISHED'] }
            },
            orderBy: { timestamp: 'asc' }
          }
        }
      });

      // Calculate overall stats
      const totalCampaigns = campaigns.length;
      const campaignsWithRetries = campaigns.filter(c => c.retryCount > 0).length;
      const totalRetryCount = campaigns.reduce((sum, c) => sum + c.retryCount, 0);
      const averageRetryCount = campaignsWithRetries > 0 ? totalRetryCount / campaignsWithRetries : 0;
      const finalSuccessRate = campaigns.filter(c => c.status === PublishingStatus.PUBLISHED).length / totalCampaigns;

      // Calculate platform-specific stats
      const platformGroups = campaigns.reduce((acc, campaign) => {
        const platformName = campaign.platform.name;
        if (!acc[platformName]) {
          acc[platformName] = [];
        }
        acc[platformName].push(campaign);
        return acc;
      }, {} as { [key: string]: typeof campaigns });

      const platformStats = Object.entries(platformGroups).map(([platformName, platformCampaigns]) => {
        const withRetries = platformCampaigns.filter(c => c.retryCount > 0);
        const retryRate = withRetries.length / platformCampaigns.length;
        const avgRetryCount = withRetries.length > 0 
          ? withRetries.reduce((sum, c) => sum + c.retryCount, 0) / withRetries.length 
          : 0;
        const successAfterRetry = withRetries.filter(c => c.status === PublishingStatus.PUBLISHED).length / Math.max(1, withRetries.length);
        
        // Extract common errors
        const errors = withRetries
          .map(c => c.errorMessage)
          .filter(Boolean)
          .reduce((acc, error) => {
            acc[error!] = (acc[error!] || 0) + 1;
            return acc;
          }, {} as { [key: string]: number });
        
        const commonErrors = Object.entries(errors)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 3)
          .map(([error]) => error);

        return {
          platform: platformName,
          retryRate,
          averageRetryCount: avgRetryCount,
          successRateAfterRetry: successAfterRetry,
          commonErrors
        };
      });

      // Calculate retry effectiveness by attempt number
      const attemptStats = new Map<number, { successes: number; total: number; delays: number[] }>();
      
      for (const campaign of campaigns.filter(c => c.retryCount > 0)) {
        for (let attempt = 1; attempt <= campaign.retryCount; attempt++) {
          if (!attemptStats.has(attempt)) {
            attemptStats.set(attempt, { successes: 0, total: 0, delays: [] });
          }
          
          const stats = attemptStats.get(attempt)!;
          stats.total++;
          
          if (campaign.status === PublishingStatus.PUBLISHED) {
            stats.successes++;
          }
          
          // Calculate delay for this attempt (simplified)
          const expectedDelay = this.calculateRetryDelay(attempt - 1, this.defaultPolicies.youtube);
          stats.delays.push(expectedDelay);
        }
      }

      const retryEffectiveness = Array.from(attemptStats.entries()).map(([attemptNumber, stats]) => ({
        attemptNumber,
        successRate: stats.successes / stats.total,
        averageDelay: stats.delays.reduce((sum, delay) => sum + delay, 0) / stats.delays.length
      }));

      return {
        overallStats: {
          totalCampaigns,
          campaignsWithRetries,
          averageRetryCount,
          finalSuccessRate
        },
        platformStats,
        retryEffectiveness
      };

    } catch (error) {
      console.error('Error analyzing retry patterns:', error);
      throw error;
    }
  }

  // Get retry history for a specific campaign
  async getRetryHistory(campaignId: string): Promise<RetryAttempt[]> {
    try {
      const retryHistory = await prisma.publishingHistory.findMany({
        where: {
          campaignId,
          action: { in: ['RETRIED', 'FAILED', 'PUBLISHED'] }
        },
        orderBy: { timestamp: 'asc' }
      });

      return retryHistory.map((entry, index) => ({
        attemptNumber: index + 1,
        timestamp: entry.timestamp,
        error: entry.message || 'Unknown error',
        success: entry.action === 'PUBLISHED',
        duration: 0, // Would calculate from actual processing time
        nextRetryAt: index < retryHistory.length - 1 ? retryHistory[index + 1].timestamp : undefined
      }));

    } catch (error) {
      console.error('Error getting retry history:', error);
      return [];
    }
  }

  // Update retry policy for a platform
  async updateRetryPolicy(
    platform: string, 
    policy: Partial<RetryPolicy>
  ): Promise<void> {
    this.defaultPolicies[platform] = {
      ...this.defaultPolicies[platform],
      ...policy
    };

    // In a production system, you might want to persist this to a database
    console.log(`Updated retry policy for ${platform}:`, this.defaultPolicies[platform]);
  }

  // Bulk retry failed campaigns
  async bulkRetry(
    campaignIds: string[],
    platform?: string
  ): Promise<Array<{
    campaignId: string;
    success: boolean;
    message: string;
    retryAt?: Date;
  }>> {
    const results = await Promise.allSettled(
      campaignIds.map(async campaignId => {
        const campaign = await prisma.publishingCampaign.findUnique({
          where: { id: campaignId },
          include: { platform: true }
        });

        if (!campaign) {
          return {
            campaignId,
            success: false,
            message: 'Campaign not found'
          };
        }

        const result = await this.scheduleRetry(
          campaignId,
          campaign.errorMessage || 'Unknown error',
          platform || campaign.platform.name
        );

        return {
          campaignId,
          success: result.success,
          message: result.message,
          retryAt: result.retryAt
        };
      })
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          campaignId: campaignIds[index],
          success: false,
          message: result.reason.message || 'Retry failed'
        };
      }
    });
  }

  // Private helper methods
  private getRetryPolicy(platform: string, customPolicy?: Partial<RetryPolicy>): RetryPolicy {
    const basePolicy = this.defaultPolicies[platform] || this.defaultPolicies.youtube;
    return { ...basePolicy, ...customPolicy };
  }

  private calculateRetryDelay(attemptNumber: number, policy: RetryPolicy): number {
    let delay: number;

    switch (policy.backoffStrategy) {
      case 'exponential':
        delay = policy.initialDelay * Math.pow(2, attemptNumber);
        break;
      case 'linear':
        delay = policy.initialDelay * (attemptNumber + 1);
        break;
      case 'fixed':
      default:
        delay = policy.initialDelay;
        break;
    }

    // Apply maximum delay limit
    if (policy.maxDelay) {
      delay = Math.min(delay, policy.maxDelay);
    }

    // Apply jitter to prevent thundering herd
    if (policy.jitter) {
      const jitterAmount = delay * 0.1; // 10% jitter
      delay += Math.random() * jitterAmount - jitterAmount / 2;
    }

    return Math.max(0, Math.floor(delay));
  }

  private async recordRetryAttempt(
    campaignId: string,
    attemptNumber: number,
    error: string,
    nextRetryAt: Date
  ): Promise<void> {
    try {
      const campaign = await prisma.publishingCampaign.findUnique({
        where: { id: campaignId }
      });

      if (campaign) {
        await prisma.publishingHistory.create({
          data: {
            campaignId,
            accountId: campaign.accountId,
            action: 'RETRIED',
            status: PublishingStatus.SCHEDULED.toString(),
            message: `Retry attempt ${attemptNumber}: ${error}`,
            userId: campaign.userId,
            errorDetails: {
              originalError: error,
              attemptNumber,
              nextRetryAt: nextRetryAt.toISOString()
            }
          }
        });
      }
    } catch (error) {
      console.error('Error recording retry attempt:', error);
    }
  }

  private async markAsPermanentlyFailed(campaignId: string, reason: string): Promise<void> {
    try {
      await prisma.publishingCampaign.update({
        where: { id: campaignId },
        data: {
          status: PublishingStatus.FAILED,
          errorMessage: `Permanently failed: ${reason}`
        }
      });

      const campaign = await prisma.publishingCampaign.findUnique({
        where: { id: campaignId }
      });

      if (campaign) {
        await prisma.publishingHistory.create({
          data: {
            campaignId,
            accountId: campaign.accountId,
            action: 'FAILED',
            status: PublishingStatus.FAILED.toString(),
            message: `Permanently failed: ${reason}`,
            userId: campaign.userId
          }
        });
      }
    } catch (error) {
      console.error('Error marking campaign as permanently failed:', error);
    }
  }

  // Monitor and alert on high failure rates
  async monitorFailureRates(): Promise<void> {
    try {
      const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const recentCampaigns = await prisma.publishingCampaign.count({
        where: { createdAt: { gte: last24Hours } }
      });

      const failedCampaigns = await prisma.publishingCampaign.count({
        where: { 
          createdAt: { gte: last24Hours },
          status: PublishingStatus.FAILED
        }
      });

      const failureRate = recentCampaigns > 0 ? failedCampaigns / recentCampaigns : 0;

      // Alert if failure rate is too high (>20%)
      if (failureRate > 0.2) {
        console.warn(`HIGH FAILURE RATE ALERT: ${(failureRate * 100).toFixed(1)}% of campaigns failed in the last 24 hours`);
        
        // In a production system, you would send alerts to monitoring systems
        // like Slack, email, or PagerDuty
      }

      // Check for platform-specific issues
      const platformFailures = await prisma.publishingCampaign.groupBy({
        by: ['platformId'],
        where: {
          createdAt: { gte: last24Hours },
          status: PublishingStatus.FAILED
        },
        _count: true
      });

      for (const platformFailure of platformFailures) {
        if (platformFailure._count > 10) { // More than 10 failures for a platform
          console.warn(`Platform-specific issue detected: Platform ${platformFailure.platformId} has ${platformFailure._count} failures`);
        }
      }

    } catch (error) {
      console.error('Error monitoring failure rates:', error);
    }
  }

  // Circuit breaker pattern for platforms with high failure rates
  async checkCircuitBreaker(platform: string): Promise<{
    isOpen: boolean;
    reason?: string;
    timeUntilReset?: number;
  }> {
    try {
      const last30Minutes = new Date(Date.now() - 30 * 60 * 1000);
      
      const recentFailures = await prisma.publishingCampaign.count({
        where: {
          createdAt: { gte: last30Minutes },
          status: PublishingStatus.FAILED,
          platform: { name: platform }
        }
      });

      // Open circuit if more than 5 failures in 30 minutes
      if (recentFailures > 5) {
        const timeUntilReset = 30 * 60 * 1000; // 30 minutes
        
        return {
          isOpen: true,
          reason: `Circuit breaker open: ${recentFailures} failures in last 30 minutes`,
          timeUntilReset
        };
      }

      return { isOpen: false };

    } catch (error) {
      console.error('Error checking circuit breaker:', error);
      return { isOpen: false };
    }
  }
}