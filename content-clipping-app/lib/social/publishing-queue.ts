import Bull from 'bull';
import Redis from 'ioredis';
import { PublishingOrchestrator } from './publishing-orchestrator';
import { prisma } from '../prisma';
import { PublishingStatus } from '@prisma/client';

export interface PublishingJobData {
  type: 'SINGLE_PLATFORM' | 'MULTI_PLATFORM' | 'SCHEDULED_BATCH' | 'RETRY';
  campaignId: string;
  userId: string;
  priority?: number;
  retryCount?: number;
  maxRetries?: number;
  scheduledFor?: Date;
  metadata?: any;
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

export class PublishingQueue {
  private publishingQueue: Bull.Queue<PublishingJobData>;
  private orchestrator: PublishingOrchestrator;
  private redis: Redis;

  constructor() {
    // Initialize Redis connection
    this.redis = new Redis(process.env.REDIS_URL || {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      retryDelayOnFailover: 100,
      enableReadyCheck: false,
      lazyConnect: true,
    });

    // Initialize Bull queue
    this.publishingQueue = new Bull('publishing', {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
      },
      defaultJobOptions: {
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 50,      // Keep last 50 failed jobs
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        delay: 0,
      },
    });

    this.orchestrator = new PublishingOrchestrator();
    this.setupEventHandlers();
    this.startWorkers();
  }

  // Add a publishing job to the queue
  async addPublishingJob(
    jobData: PublishingJobData,
    options: {
      priority?: number;
      delay?: number;
      scheduledFor?: Date;
      attempts?: number;
    } = {}
  ): Promise<Bull.Job<PublishingJobData>> {
    try {
      const jobOptions: Bull.JobOptions = {
        priority: options.priority || this.getJobPriority(jobData.type),
        delay: options.delay || (options.scheduledFor ? 
          Math.max(0, options.scheduledFor.getTime() - Date.now()) : 0),
        attempts: options.attempts || jobData.maxRetries || 3,
        removeOnComplete: 10,
        removeOnFail: 5,
      };

      const job = await this.publishingQueue.add(jobData.type, jobData, jobOptions);

      // Update campaign status to scheduled if it's a delayed job
      if (options.scheduledFor || options.delay) {
        await this.updateCampaignStatus(jobData.campaignId, PublishingStatus.SCHEDULED);
      } else {
        await this.updateCampaignStatus(jobData.campaignId, PublishingStatus.PROCESSING);
      }

      console.log(`Added publishing job ${job.id} for campaign ${jobData.campaignId}`);
      return job;

    } catch (error) {
      console.error('Error adding publishing job:', error);
      throw error;
    }
  }

  // Add batch of jobs for scheduled publishing
  async addScheduledBatch(
    campaigns: Array<{
      campaignId: string;
      userId: string;
      scheduledFor: Date;
    }>
  ): Promise<Bull.Job<PublishingJobData>[]> {
    const jobs = await Promise.all(
      campaigns.map(campaign => 
        this.addPublishingJob(
          {
            type: 'SCHEDULED_BATCH',
            campaignId: campaign.campaignId,
            userId: campaign.userId,
          },
          {
            scheduledFor: campaign.scheduledFor,
            priority: 5
          }
        )
      )
    );

    console.log(`Added ${jobs.length} scheduled publishing jobs`);
    return jobs;
  }

  // Retry a failed job
  async retryJob(jobId: string): Promise<Bull.Job<PublishingJobData> | null> {
    try {
      const job = await this.publishingQueue.getJob(jobId);
      if (!job) {
        console.log(`Job ${jobId} not found`);
        return null;
      }

      const retryJobData: PublishingJobData = {
        ...job.data,
        type: 'RETRY',
        retryCount: (job.data.retryCount || 0) + 1,
      };

      const retryJob = await this.publishingQueue.add('RETRY', retryJobData, {
        priority: 8, // High priority for retries
        attempts: Math.max(1, (job.data.maxRetries || 3) - (job.data.retryCount || 0)),
      });

      console.log(`Created retry job ${retryJob.id} for original job ${jobId}`);
      return retryJob;

    } catch (error) {
      console.error('Error retrying job:', error);
      return null;
    }
  }

  // Cancel/remove a job
  async cancelJob(jobId: string): Promise<boolean> {
    try {
      const job = await this.publishingQueue.getJob(jobId);
      if (!job) {
        return false;
      }

      await job.remove();
      
      // Update campaign status
      if (job.data.campaignId) {
        await this.updateCampaignStatus(job.data.campaignId, PublishingStatus.CANCELLED);
      }

      console.log(`Cancelled job ${jobId}`);
      return true;

    } catch (error) {
      console.error('Error cancelling job:', error);
      return false;
    }
  }

  // Get queue statistics
  async getQueueStats(): Promise<QueueStats> {
    try {
      const waiting = await this.publishingQueue.waiting();
      const active = await this.publishingQueue.active();
      const completed = await this.publishingQueue.completed();
      const failed = await this.publishingQueue.failed();
      const delayed = await this.publishingQueue.delayed();
      
      return {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
        paused: await this.publishingQueue.isPaused() ? 1 : 0,
      };

    } catch (error) {
      console.error('Error getting queue stats:', error);
      return {
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: 0,
      };
    }
  }

  // Get jobs for a specific user or campaign
  async getUserJobs(
    userId: string,
    status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' = 'active',
    limit = 20
  ): Promise<Array<{
    id: string;
    type: string;
    campaignId: string;
    status: string;
    createdAt: Date;
    processedAt?: Date;
    finishedAt?: Date;
    progress?: any;
    error?: string;
  }>> {
    try {
      let jobs: Bull.Job<PublishingJobData>[];

      switch (status) {
        case 'waiting':
          jobs = await this.publishingQueue.getWaiting(0, limit - 1);
          break;
        case 'active':
          jobs = await this.publishingQueue.getActive(0, limit - 1);
          break;
        case 'completed':
          jobs = await this.publishingQueue.getCompleted(0, limit - 1);
          break;
        case 'failed':
          jobs = await this.publishingQueue.getFailed(0, limit - 1);
          break;
        case 'delayed':
          jobs = await this.publishingQueue.getDelayed(0, limit - 1);
          break;
        default:
          jobs = [];
      }

      // Filter by user ID and transform
      return jobs
        .filter(job => job.data.userId === userId)
        .map(job => ({
          id: job.id.toString(),
          type: job.data.type,
          campaignId: job.data.campaignId,
          status: status,
          createdAt: new Date(job.timestamp),
          processedAt: job.processedOn ? new Date(job.processedOn) : undefined,
          finishedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
          progress: job.progress(),
          error: job.failedReason,
        }));

    } catch (error) {
      console.error('Error getting user jobs:', error);
      return [];
    }
  }

  // Pause/resume queue
  async pauseQueue(): Promise<void> {
    await this.publishingQueue.pause();
    console.log('Publishing queue paused');
  }

  async resumeQueue(): Promise<void> {
    await this.publishingQueue.resume();
    console.log('Publishing queue resumed');
  }

  // Clean up old jobs
  async cleanupJobs(): Promise<void> {
    try {
      // Clean jobs older than 7 days
      await this.publishingQueue.clean(7 * 24 * 60 * 60 * 1000, 'completed');
      await this.publishingQueue.clean(7 * 24 * 60 * 60 * 1000, 'failed');
      console.log('Cleaned up old queue jobs');
    } catch (error) {
      console.error('Error cleaning up jobs:', error);
    }
  }

  // Setup event handlers
  private setupEventHandlers(): void {
    this.publishingQueue.on('completed', (job: Bull.Job<PublishingJobData>) => {
      console.log(`Job ${job.id} completed for campaign ${job.data.campaignId}`);
      this.updateCampaignStatus(job.data.campaignId, PublishingStatus.PUBLISHED);
    });

    this.publishingQueue.on('failed', (job: Bull.Job<PublishingJobData>, error: Error) => {
      console.error(`Job ${job.id} failed for campaign ${job.data.campaignId}:`, error.message);
      this.updateCampaignStatus(job.data.campaignId, PublishingStatus.FAILED, error.message);
    });

    this.publishingQueue.on('progress', (job: Bull.Job<PublishingJobData>, progress: number) => {
      console.log(`Job ${job.id} progress: ${progress}%`);
    });

    this.publishingQueue.on('stalled', (job: Bull.Job<PublishingJobData>) => {
      console.warn(`Job ${job.id} stalled for campaign ${job.data.campaignId}`);
    });

    this.publishingQueue.on('active', (job: Bull.Job<PublishingJobData>) => {
      console.log(`Job ${job.id} started processing for campaign ${job.data.campaignId}`);
    });
  }

  // Start queue workers
  private startWorkers(): void {
    // Process different job types
    this.publishingQueue.process('SINGLE_PLATFORM', this.concurrency('single'), this.processSinglePlatform.bind(this));
    this.publishingQueue.process('MULTI_PLATFORM', this.concurrency('multi'), this.processMultiPlatform.bind(this));
    this.publishingQueue.process('SCHEDULED_BATCH', this.concurrency('batch'), this.processScheduledBatch.bind(this));
    this.publishingQueue.process('RETRY', this.concurrency('retry'), this.processRetry.bind(this));

    console.log('Publishing queue workers started');
  }

  // Job processors
  private async processSinglePlatform(job: Bull.Job<PublishingJobData>): Promise<any> {
    try {
      console.log(`Processing single platform job ${job.id} for campaign ${job.data.campaignId}`);
      
      // Update job progress
      job.progress(10);

      // Process the campaign using orchestrator
      await this.orchestrator.processPublishingCampaign(job.data.campaignId);
      
      job.progress(100);
      return { success: true, campaignId: job.data.campaignId };

    } catch (error) {
      console.error('Error processing single platform job:', error);
      throw error;
    }
  }

  private async processMultiPlatform(job: Bull.Job<PublishingJobData>): Promise<any> {
    try {
      console.log(`Processing multi-platform job ${job.id} for campaign ${job.data.campaignId}`);
      
      job.progress(20);
      
      // Process the campaign using orchestrator
      await this.orchestrator.processPublishingCampaign(job.data.campaignId);
      
      job.progress(100);
      return { success: true, campaignId: job.data.campaignId };

    } catch (error) {
      console.error('Error processing multi-platform job:', error);
      throw error;
    }
  }

  private async processScheduledBatch(job: Bull.Job<PublishingJobData>): Promise<any> {
    try {
      console.log(`Processing scheduled batch job ${job.id}`);
      
      // Process scheduled campaigns
      await this.orchestrator.processScheduledCampaigns();
      
      return { success: true };

    } catch (error) {
      console.error('Error processing scheduled batch job:', error);
      throw error;
    }
  }

  private async processRetry(job: Bull.Job<PublishingJobData>): Promise<any> {
    try {
      console.log(`Processing retry job ${job.id} for campaign ${job.data.campaignId} (attempt ${job.data.retryCount})`);
      
      // Retry the campaign using orchestrator
      const result = await this.orchestrator.retryFailedCampaign(job.data.campaignId);
      
      if (!result.success) {
        throw new Error(result.message);
      }

      return { success: true, campaignId: job.data.campaignId, attempt: job.data.retryCount };

    } catch (error) {
      console.error('Error processing retry job:', error);
      throw error;
    }
  }

  // Helper methods
  private getJobPriority(jobType: string): number {
    const priorities = {
      'RETRY': 10,           // Highest priority
      'SINGLE_PLATFORM': 7,
      'MULTI_PLATFORM': 5,
      'SCHEDULED_BATCH': 3,  // Lowest priority
    };
    return priorities[jobType] || 5;
  }

  private concurrency(jobType: string): number {
    const concurrencyLimits = {
      'single': parseInt(process.env.SINGLE_PLATFORM_CONCURRENCY || '5'),
      'multi': parseInt(process.env.MULTI_PLATFORM_CONCURRENCY || '2'),
      'batch': parseInt(process.env.BATCH_CONCURRENCY || '1'),
      'retry': parseInt(process.env.RETRY_CONCURRENCY || '3'),
    };
    return concurrencyLimits[jobType] || 3;
  }

  private async updateCampaignStatus(
    campaignId: string, 
    status: PublishingStatus, 
    errorMessage?: string
  ): Promise<void> {
    try {
      await prisma.publishingCampaign.update({
        where: { id: campaignId },
        data: {
          status,
          errorMessage,
          publishedAt: status === PublishingStatus.PUBLISHED ? new Date() : undefined,
        }
      });
    } catch (error) {
      console.error('Error updating campaign status:', error);
    }
  }

  // Schedule automatic cleanup
  scheduleCleanup(): void {
    // Run cleanup every 6 hours
    setInterval(() => {
      this.cleanupJobs().catch(error => {
        console.error('Scheduled cleanup failed:', error);
      });
    }, 6 * 60 * 60 * 1000);

    console.log('Scheduled automatic queue cleanup');
  }

  // Graceful shutdown
  async close(): Promise<void> {
    try {
      await this.publishingQueue.close();
      await this.redis.disconnect();
      console.log('Publishing queue closed gracefully');
    } catch (error) {
      console.error('Error closing publishing queue:', error);
    }
  }

  // Health check
  async healthCheck(): Promise<{
    healthy: boolean;
    redis: boolean;
    queue: boolean;
    stats: QueueStats;
  }> {
    try {
      // Check Redis connection
      const redisHealthy = this.redis.status === 'ready';
      
      // Check queue status
      const stats = await this.getQueueStats();
      const queueHealthy = stats.active < 100; // Arbitrary threshold
      
      return {
        healthy: redisHealthy && queueHealthy,
        redis: redisHealthy,
        queue: queueHealthy,
        stats
      };

    } catch (error) {
      console.error('Health check failed:', error);
      return {
        healthy: false,
        redis: false,
        queue: false,
        stats: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          paused: 0,
        }
      };
    }
  }
}

// Global queue instance
export const publishingQueue = new PublishingQueue();