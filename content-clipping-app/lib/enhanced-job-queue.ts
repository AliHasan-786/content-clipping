import Queue from 'bull';
import Redis from 'ioredis';
import { prisma } from './prisma';
import { FFmpegService } from './ffmpeg-service';
import { WhisperService } from './whisper-service';
import { ClipDetectionService } from './clip-detection-service';
import { websocketService } from './websocket-service';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import os from 'os';
import cluster from 'cluster';

// Production Redis configuration with connection pooling
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  retryDelayOnFailover: 100,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  maxMemoryPolicy: 'allkeys-lru',
  keyPrefix: 'clipmaster:',
  family: 4,
  keepAlive: true,
  connectTimeout: 10000,
  commandTimeout: 5000,
  retryDelayOnClusterDown: 300,
  retryDelayOnFailover: 100,
};

// Cache configuration
const CACHE_TTL = {
  VIDEO_METADATA: 24 * 60 * 60, // 24 hours
  TRANSCRIPTION: 7 * 24 * 60 * 60, // 7 days
  THUMBNAILS: 30 * 24 * 60 * 60, // 30 days
  CLIPS: 7 * 24 * 60 * 60, // 7 days
  PROCESSING_STATUS: 60, // 1 minute
};

// Performance configuration
const PERFORMANCE_CONFIG = {
  MAX_CONCURRENT_VIDEO_JOBS: Math.max(1, Math.floor(os.cpus().length / 2)),
  MAX_CONCURRENT_TRANSCRIPTION_JOBS: Math.max(1, Math.floor(os.cpus().length / 4)),
  MAX_CONCURRENT_CLIP_JOBS: Math.max(1, Math.floor(os.cpus().length / 2)),
  MEMORY_THRESHOLD: 0.85, // 85% memory usage threshold
  CPU_THRESHOLD: 0.80, // 80% CPU usage threshold
  CHUNK_SIZE: 1024 * 1024 * 10, // 10MB chunks for file processing
};

// Create Redis connections with connection pooling
const redis = new Redis(redisConfig);
const cacheRedis = new Redis({ ...redisConfig, keyPrefix: 'cache:' });
const metricsRedis = new Redis({ ...redisConfig, keyPrefix: 'metrics:' });

// Performance monitoring system
class PerformanceMonitor {
  private static memoryUsage = process.memoryUsage();
  private static cpuUsage = process.cpuUsage();
  private static lastCheck = Date.now();
  private static metrics: Map<string, number[]> = new Map();

  static async checkSystemHealth(): Promise<{ memory: number; cpu: number; healthy: boolean }> {
    const currentMemory = process.memoryUsage();
    const currentCpu = process.cpuUsage(this.cpuUsage);
    const timeDiff = Date.now() - this.lastCheck;

    const memoryPercent = currentMemory.heapUsed / currentMemory.heapTotal;
    const cpuPercent = (currentCpu.user + currentCpu.system) / (timeDiff * 1000);

    this.memoryUsage = currentMemory;
    this.cpuUsage = process.cpuUsage();
    this.lastCheck = Date.now();

    const healthy = memoryPercent < PERFORMANCE_CONFIG.MEMORY_THRESHOLD && 
                   cpuPercent < PERFORMANCE_CONFIG.CPU_THRESHOLD;

    // Store metrics with sliding window
    this.addMetric('memory', memoryPercent);
    this.addMetric('cpu', cpuPercent);

    // Store in Redis for monitoring
    await Promise.all([
      metricsRedis.zadd('system:memory', Date.now(), memoryPercent),
      metricsRedis.zadd('system:cpu', Date.now(), cpuPercent),
      metricsRedis.expire('system:memory', 86400),
      metricsRedis.expire('system:cpu', 86400)
    ]);

    return { memory: memoryPercent, cpu: cpuPercent, healthy };
  }

  private static addMetric(name: string, value: number) {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    const values = this.metrics.get(name)!;
    values.push(value);
    if (values.length > 100) {
      values.shift();
    }
  }

  static getAverageMetric(name: string): number {
    const values = this.metrics.get(name) || [];
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }

  static async shouldThrottleJobs(): Promise<boolean> {
    const health = await this.checkSystemHealth();
    return !health.healthy;
  }

  static async getProcessingCapacity(): Promise<number> {
    const health = await this.checkSystemHealth();
    if (!health.healthy) return 0.1; // Minimal capacity when unhealthy
    
    // Calculate capacity based on available resources
    const memoryCapacity = 1 - health.memory;
    const cpuCapacity = 1 - health.cpu;
    return Math.min(memoryCapacity, cpuCapacity);
  }
}

// Advanced caching system with compression and intelligent invalidation
class CacheManager {
  static async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await cacheRedis.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.warn('Cache get error:', error);
      return null;
    }
  }

  static async set(key: string, value: any, ttl: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      await cacheRedis.setex(key, ttl, serialized);
    } catch (error) {
      console.warn('Cache set error:', error);
    }
  }

  static async del(key: string): Promise<void> {
    try {
      await cacheRedis.del(key);
    } catch (error) {
      console.warn('Cache delete error:', error);
    }
  }

  static async invalidatePattern(pattern: string): Promise<void> {
    try {
      const keys = await cacheRedis.keys(pattern);
      if (keys.length > 0) {
        await cacheRedis.del(...keys);
      }
    } catch (error) {
      console.warn('Cache invalidation error:', error);
    }
  }

  static generateVideoKey(videoId: string, operation: string): string {
    return `video:${videoId}:${operation}`;
  }

  static generateHashKey(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  // Cache video metadata with deduplication
  static async cacheVideoMetadata(videoPath: string, metadata: any): Promise<void> {
    const hash = this.generateHashKey(videoPath);
    await this.set(`metadata:${hash}`, metadata, CACHE_TTL.VIDEO_METADATA);
  }

  static async getCachedVideoMetadata(videoPath: string): Promise<any | null> {
    const hash = this.generateHashKey(videoPath);
    return this.get(`metadata:${hash}`);
  }

  // Cache transcription results
  static async cacheTranscription(audioHash: string, transcription: any): Promise<void> {
    await this.set(`transcription:${audioHash}`, transcription, CACHE_TTL.TRANSCRIPTION);
  }

  static async getCachedTranscription(audioPath: string): Promise<any | null> {
    const audioContent = await fs.readFile(audioPath);
    const hash = this.generateHashKey(audioContent.toString('base64'));
    return this.get(`transcription:${hash}`);
  }
}

// Job data interfaces with enhanced metadata
export interface VideoProcessingJobData {
  videoId: string;
  userId: string;
  videoPath: string;
  priority?: number;
  retryCount?: number;
  processingOptions?: {
    skipCache?: boolean;
    highQuality?: boolean;
    fastProcessing?: boolean;
  };
}

export interface TranscriptionJobData {
  videoId: string;
  audioPath: string;
  language?: string;
  skipCache?: boolean;
  audioHash?: string;
}

export interface ClipGenerationJobData {
  videoId: string;
  videoPath: string;
  transcriptionId: string;
  options?: {
    minDuration?: number;
    maxDuration?: number;
    maxClips?: number;
    scoreThreshold?: number;
  };
}

// Enhanced job queues with adaptive concurrency
export const videoProcessingQueue = new Queue<VideoProcessingJobData>('video processing', {
  redis: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 20,
    removeOnFail: 10,
    timeout: parseInt(process.env.VIDEO_PROCESSING_TIMEOUT || '1800000'),
    ttl: 48 * 60 * 60 * 1000,
  },
  settings: {
    stalledInterval: 30 * 1000,
    maxStalledCount: 1,
  },
});

export const transcriptionQueue = new Queue<TranscriptionJobData>('transcription', {
  redis: redisConfig,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 15,
    removeOnFail: 8,
    timeout: parseInt(process.env.TRANSCRIPTION_TIMEOUT || '3600000'),
    ttl: 24 * 60 * 60 * 1000,
  },
  settings: {
    stalledInterval: 60 * 1000,
    maxStalledCount: 1,
  },
});

export const clipGenerationQueue = new Queue<ClipGenerationJobData>('clip generation', {
  redis: redisConfig,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 3000,
    },
    removeOnComplete: 10,
    removeOnFail: 5,
    timeout: parseInt(process.env.CLIP_GENERATION_TIMEOUT || '900000'),
    ttl: 12 * 60 * 60 * 1000,
  },
  settings: {
    stalledInterval: 45 * 1000,
    maxStalledCount: 1,
  },
});

// Enhanced video processor with caching and parallel processing
export class EnhancedVideoProcessor {
  /**
   * Main video processing job with caching and optimization
   */
  static async processVideo(job: Queue.Job<VideoProcessingJobData>) {
    const { videoId, videoPath, processingOptions = {} } = job.data;
    const startTime = Date.now();
    
    try {
      // Check system health before processing
      if (await PerformanceMonitor.shouldThrottleJobs()) {
        throw new Error('System resources exhausted, retrying later');
      }

      await this.updateProcessingStatus(videoId, 'EXTRACTING_METADATA', 10);
      
      // Try to get cached metadata first
      let metadata = null;
      if (!processingOptions.skipCache) {
        metadata = await CacheManager.getCachedVideoMetadata(videoPath);
      }
      
      if (!metadata) {
        metadata = await FFmpegService.getVideoMetadata(videoPath);
        await CacheManager.cacheVideoMetadata(videoPath, metadata);
      }
      
      const fileSize = await FFmpegService.getFileSize(videoPath);
      
      await prisma.video.update({
        where: { id: videoId },
        data: {
          duration: metadata.duration,
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          bitrate: metadata.bitrate,
          codec: metadata.codec,
          fileSize: BigInt(fileSize),
          metadataExtracted: true,
          processingProgress: 20,
        },
      });

      await this.updateProcessingStatus(videoId, 'GENERATING_THUMBNAIL', 30);

      // Generate multiple thumbnails in parallel
      const thumbnailDir = path.join(process.cwd(), 'public', 'uploads', 'thumbnails');
      await fs.mkdir(thumbnailDir, { recursive: true });
      
      const thumbnailPromises = [
        FFmpegService.generateThumbnail(videoPath, thumbnailDir, {
          count: 1,
          timemarks: ['10%'],
          size: '640x360',
          filename: `${videoId}_thumb.jpg`
        }),
        FFmpegService.generateThumbnail(videoPath, thumbnailDir, {
          count: 1,
          timemarks: ['25%'],
          size: '1280x720',
          filename: `${videoId}_hd_thumb.jpg`
        })
      ];

      const [thumbnailPaths] = await Promise.all(thumbnailPromises);
      
      if (thumbnailPaths.length > 0) {
        const thumbnailUrl = `/uploads/thumbnails/${path.basename(thumbnailPaths[0])}`;
        await prisma.video.update({
          where: { id: videoId },
          data: {
            thumbnail: thumbnailUrl,
            thumbnailGenerated: true,
            processingProgress: 40,
          },
        });
      }

      await this.updateProcessingStatus(videoId, 'EXTRACTING_AUDIO', 50);

      // Extract audio with optimization
      const audioDir = path.join(process.cwd(), 'temp', 'audio');
      await fs.mkdir(audioDir, { recursive: true });
      const audioPath = path.join(audioDir, `${videoId}.mp3`);
      
      // Use optimized audio extraction parameters
      const audioOptions = {
        audioCodec: 'mp3',
        audioBitrate: '128k',
        audioChannels: 1, // Mono for better transcription
        audioFrequency: 16000, // Optimized for Whisper
      };
      
      await FFmpegService.extractAudio(videoPath, audioPath, audioOptions);
      
      // Generate audio hash for caching
      const audioContent = await fs.readFile(audioPath);
      const audioHash = CacheManager.generateHashKey(audioContent.toString('base64'));
      
      await prisma.video.update({
        where: { id: videoId },
        data: {
          audioExtracted: true,
          processingProgress: 60,
        },
      });

      // Queue transcription with audio hash
      const transcriptionJob = await transcriptionQueue.add('transcribe', {
        videoId,
        audioPath,
        audioHash,
        skipCache: processingOptions.skipCache,
      }, {
        priority: job.opts.priority || 0,
        delay: 0, // Process immediately
      });

      await this.updateProcessingStatus(videoId, 'TRANSCRIBING', 70);

      // Log processing metrics
      const processingTime = Date.now() - startTime;
      await metricsRedis.zadd('processing:video:duration', Date.now(), processingTime);

      return { 
        success: true, 
        audioPath, 
        audioHash, 
        transcriptionJobId: transcriptionJob.id,
        processingTime 
      };
    } catch (error) {
      await this.updateProcessingStatus(videoId, 'FAILED', 0, error.message);
      
      // Log error metrics
      await metricsRedis.incr('processing:video:errors');
      await metricsRedis.expire('processing:video:errors', 86400);
      
      throw error;
    }
  }

  /**
   * Enhanced transcription job with caching
   */
  static async processTranscription(job: Queue.Job<TranscriptionJobData>) {
    const { videoId, audioPath, language, skipCache = false, audioHash } = job.data;
    const startTime = Date.now();

    try {
      // Check for cached transcription
      let transcriptionResult = null;
      if (!skipCache && audioHash) {
        transcriptionResult = await CacheManager.get(`transcription:${audioHash}`);
      }

      if (!transcriptionResult) {
        // Perform transcription with optimized settings
        transcriptionResult = await WhisperService.transcribeAudio(audioPath, {
          language,
          responseFormat: 'verbose_json',
          timestampGranularities: ['segment'],
          // Optimization parameters
          temperature: 0.1, // Lower temperature for more consistent results
          compressionRatioThreshold: 2.4,
          logprobThreshold: -1.0,
        });

        // Cache the result
        if (audioHash) {
          await CacheManager.set(`transcription:${audioHash}`, transcriptionResult, CACHE_TTL.TRANSCRIPTION);
        }
      }

      // Save transcription with batch insert for better performance
      const transcription = await prisma.transcription.create({
        data: {
          videoId,
          text: transcriptionResult.text,
          language: transcriptionResult.language,
          segments: {
            create: transcriptionResult.segments.map((segment: any) => ({
              text: segment.text,
              startTime: segment.start,
              endTime: segment.end,
              confidence: segment.confidence || 1.0,
              speakerLabel: segment.speaker || null,
            }))
          }
        },
        include: {
          segments: true,
        }
      });

      // Update video status
      await prisma.video.update({
        where: { id: videoId },
        data: {
          transcriptionCompleted: true,
          processingProgress: 80,
          processingStage: 'DETECTING_CLIPS',
        },
      });

      // Queue clip generation with higher priority
      const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: { url: true }
      });

      if (video) {
        const videoPath = path.join(process.cwd(), 'public', video.url);
        await clipGenerationQueue.add('generate-clips', {
          videoId,
          videoPath,
          transcriptionId: transcription.id,
        }, {
          priority: job.opts.priority ? job.opts.priority + 1 : 1,
        });
      }

      // Clean up audio file
      try {
        await fs.unlink(audioPath);
      } catch (error) {
        console.warn('Failed to delete audio file:', error);
      }

      // Log metrics
      const processingTime = Date.now() - startTime;
      await metricsRedis.zadd('processing:transcription:duration', Date.now(), processingTime);

      return { 
        success: true, 
        transcriptionId: transcription.id, 
        processingTime,
        segmentCount: transcriptionResult.segments.length 
      };
    } catch (error) {
      await this.updateProcessingStatus(videoId, 'FAILED', 0, error.message);
      await metricsRedis.incr('processing:transcription:errors');
      throw error;
    }
  }

  /**
   * Enhanced clip generation with parallel processing
   */
  static async generateClips(job: Queue.Job<ClipGenerationJobData>) {
    const { videoId, videoPath, transcriptionId, options = {} } = job.data;
    const startTime = Date.now();

    try {
      // Get transcription with optimized query
      const transcription = await prisma.transcription.findUnique({
        where: { id: transcriptionId },
        include: {
          segments: {
            orderBy: { startTime: 'asc' },
            where: {
              confidence: { gt: 0.7 } // Only use high-confidence segments
            }
          }
        }
      });

      if (!transcription) {
        throw new Error('Transcription not found');
      }

      // Convert segments with filtering
      const segments = transcription.segments
        .filter(segment => segment.text.trim().length > 0)
        .map((segment, index) => ({
          id: index,
          text: segment.text,
          start: segment.startTime,
          end: segment.endTime,
          confidence: segment.confidence || 1.0,
          speakerLabel: segment.speakerLabel,
        }));

      if (segments.length === 0) {
        throw new Error('No valid segments found for clip generation');
      }

      // Enhanced clip detection with custom options
      const detectionOptions = {
        minClipDuration: options.minDuration || 5,
        maxClipDuration: options.maxDuration || 60,
        maxClips: options.maxClips || 15,
        scoreThreshold: options.scoreThreshold || 2.5,
        // Additional optimization parameters
        emotionWeight: 0.3,
        lengthWeight: 0.2,
        positionWeight: 0.1,
        keywordWeight: 0.4,
      };

      const detectedClips = await ClipDetectionService.detectClips(
        videoPath, 
        segments, 
        detectionOptions
      );

      // Batch insert clips for better performance
      if (detectedClips.length > 0) {
        await prisma.$transaction(async (tx) => {
          const clipData = detectedClips.map((clip: any, index: number) => ({
            videoId,
            title: clip.title,
            description: clip.description,
            startTime: Math.floor(clip.startTime),
            endTime: Math.floor(clip.endTime),
            tags: clip.tags || [],
            score: clip.score,
            confidence: clip.confidence,
            reason: clip.reason,
          }));

          await tx.clip.createMany({
            data: clipData,
          });
        });
      }

      // Update video status
      await prisma.video.update({
        where: { id: videoId },
        data: {
          clipsGenerated: true,
          processingProgress: 100,
          processingStage: 'COMPLETED',
          status: 'READY',
        },
      });

      // Cache clip results
      await CacheManager.set(
        CacheManager.generateVideoKey(videoId, 'clips'),
        detectedClips,
        CACHE_TTL.CLIPS
      );

      // Log metrics
      const processingTime = Date.now() - startTime;
      await Promise.all([
        metricsRedis.zadd('processing:clips:duration', Date.now(), processingTime),
        metricsRedis.zadd('processing:clips:count', Date.now(), detectedClips.length),
      ]);

      return { 
        success: true, 
        clipsGenerated: detectedClips.length,
        processingTime,
        averageScore: detectedClips.reduce((sum: number, clip: any) => sum + clip.score, 0) / detectedClips.length
      };
    } catch (error) {
      await this.updateProcessingStatus(videoId, 'FAILED', 0, error.message);
      await metricsRedis.incr('processing:clips:errors');
      throw error;
    }
  }

  /**
   * Enhanced status update with caching and real-time notifications
   */
  private static async updateProcessingStatus(
    videoId: string,
    stage: string,
    progress: number,
    errorMessage?: string
  ) {
    const updateData = {
      processingStage: stage as any,
      processingProgress: progress,
      status: stage === 'FAILED' ? 'ERROR' : stage === 'COMPLETED' ? 'READY' : 'PROCESSING',
      errorMessage: errorMessage || null,
      updatedAt: new Date(),
    };

    await Promise.all([
      // Update database
      prisma.video.update({
        where: { id: videoId },
        data: updateData,
      }),
      // Cache status
      CacheManager.set(
        CacheManager.generateVideoKey(videoId, 'status'),
        updateData,
        CACHE_TTL.PROCESSING_STATUS
      )
    ]);

    // Emit progress update via WebSocket
    websocketService.emitProcessingProgress({
      videoId,
      stage,
      progress,
      errorMessage,
      message: this.getStageMessage(stage),
      timestamp: Date.now(),
    });

    // Handle completion and errors with enhanced notifications
    if (stage === 'COMPLETED') {
      const video = await prisma.video.findUnique({
        where: { id: videoId },
        include: {
          transcription: true,
          clips: { 
            take: 15, 
            orderBy: { score: 'desc' },
            where: { approved: true }
          }
        }
      });
      websocketService.emitProcessingComplete(videoId, video);
    } else if (stage === 'FAILED' && errorMessage) {
      websocketService.emitProcessingError(videoId, errorMessage);
    }
  }

  /**
   * Enhanced stage messages with more detailed information
   */
  private static getStageMessage(stage: string): string {
    const messages: Record<string, string> = {
      'UPLOADED': 'Video uploaded successfully',
      'EXTRACTING_METADATA': 'Analyzing video properties and format...',
      'GENERATING_THUMBNAIL': 'Creating video thumbnails...',
      'EXTRACTING_AUDIO': 'Preparing audio for transcription...',
      'TRANSCRIBING': 'Converting speech to text with AI...',
      'DETECTING_CLIPS': 'Analyzing content for potential clips...',
      'GENERATING_CLIPS': 'Creating optimized clip suggestions...',
      'COMPLETED': 'Processing complete! Your clips are ready.',
      'FAILED': 'Processing failed - please try again'
    };
    return messages[stage] || 'Processing...';
  }
}

// Dynamic concurrency management
let currentConcurrency = {
  video: PERFORMANCE_CONFIG.MAX_CONCURRENT_VIDEO_JOBS,
  transcription: PERFORMANCE_CONFIG.MAX_CONCURRENT_TRANSCRIPTION_JOBS,
  clips: PERFORMANCE_CONFIG.MAX_CONCURRENT_CLIP_JOBS,
};

async function adjustConcurrency() {
  const capacity = await PerformanceMonitor.getProcessingCapacity();
  
  currentConcurrency.video = Math.max(1, Math.floor(PERFORMANCE_CONFIG.MAX_CONCURRENT_VIDEO_JOBS * capacity));
  currentConcurrency.transcription = Math.max(1, Math.floor(PERFORMANCE_CONFIG.MAX_CONCURRENT_TRANSCRIPTION_JOBS * capacity));
  currentConcurrency.clips = Math.max(1, Math.floor(PERFORMANCE_CONFIG.MAX_CONCURRENT_CLIP_JOBS * capacity));
}

// Register enhanced job processors with dynamic concurrency
videoProcessingQueue.process('process-video', () => currentConcurrency.video, EnhancedVideoProcessor.processVideo);
transcriptionQueue.process('transcribe', () => currentConcurrency.transcription, EnhancedVideoProcessor.processTranscription);
clipGenerationQueue.process('generate-clips', () => currentConcurrency.clips, EnhancedVideoProcessor.generateClips);

// Performance monitoring interval
setInterval(adjustConcurrency, 30000); // Check every 30 seconds

// Enhanced queue event handlers with metrics
videoProcessingQueue.on('completed', async (job, result) => {
  console.log(`Video processing job ${job.id} completed:`, result);
  await metricsRedis.incr('jobs:video:completed');
});

videoProcessingQueue.on('failed', async (job, err) => {
  console.error(`Video processing job ${job.id} failed:`, err.message);
  await metricsRedis.incr('jobs:video:failed');
});

transcriptionQueue.on('completed', async (job, result) => {
  console.log(`Transcription job ${job.id} completed:`, result);
  await metricsRedis.incr('jobs:transcription:completed');
});

clipGenerationQueue.on('completed', async (job, result) => {
  console.log(`Clip generation job ${job.id} completed:`, result);
  await metricsRedis.incr('jobs:clips:completed');
});

// Enhanced Job Queue Manager with production features
export class EnhancedJobQueueManager {
  static async addVideoProcessingJob(
    videoId: string, 
    userId: string, 
    videoPath: string, 
    priority = 0,
    options: any = {}
  ) {
    // Check system capacity before adding job
    const capacity = await PerformanceMonitor.getProcessingCapacity();
    if (capacity < 0.1) {
      throw new Error('System is currently at capacity. Please try again later.');
    }

    return videoProcessingQueue.add('process-video', {
      videoId,
      userId,
      videoPath,
      priority,
      processingOptions: options,
    }, {
      priority,
      delay: capacity < 0.5 ? 5000 : 0, // Delay if system is stressed
    });
  }

  static async getJobStatus(jobId: string, queueName: 'video' | 'transcription' | 'clips') {
    const queueMap = {
      video: videoProcessingQueue,
      transcription: transcriptionQueue,
      clips: clipGenerationQueue,
    };

    const queue = queueMap[queueName];
    const job = await queue.getJob(jobId);
    if (!job) return null;

    return {
      id: job.id,
      progress: job.progress(),
      failedReason: job.failedReason,
      finishedOn: job.finishedOn,
      processedOn: job.processedOn,
      data: job.data,
      opts: job.opts,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
    };
  }

  static async getDetailedQueueStats() {
    const [videoStats, transcriptionStats, clipStats] = await Promise.all([
      videoProcessingQueue.getJobCounts(),
      transcriptionQueue.getJobCounts(),
      clipGenerationQueue.getJobCounts(),
    ]);

    const health = await PerformanceMonitor.checkSystemHealth();
    
    return {
      queues: {
        video: videoStats,
        transcription: transcriptionStats,
        clips: clipStats,
      },
      system: {
        health,
        concurrency: currentConcurrency,
        metrics: {
          avgMemory: PerformanceMonitor.getAverageMetric('memory'),
          avgCpu: PerformanceMonitor.getAverageMetric('cpu'),
        }
      },
      performance: PERFORMANCE_CONFIG,
    };
  }

  static async optimizeQueues() {
    // Clean old completed jobs
    await Promise.all([
      videoProcessingQueue.clean(24 * 60 * 60 * 1000, 'completed'),
      transcriptionQueue.clean(12 * 60 * 60 * 1000, 'completed'),
      clipGenerationQueue.clean(6 * 60 * 60 * 1000, 'completed'),
    ]);

    // Clean failed jobs older than 7 days
    await Promise.all([
      videoProcessingQueue.clean(7 * 24 * 60 * 60 * 1000, 'failed'),
      transcriptionQueue.clean(7 * 24 * 60 * 60 * 1000, 'failed'),
      clipGenerationQueue.clean(7 * 24 * 60 * 60 * 1000, 'failed'),
    ]);
  }

  static async retryFailedJobs(maxAge = 60 * 60 * 1000) { // Default: 1 hour
    const now = Date.now();
    const queues = [videoProcessingQueue, transcriptionQueue, clipGenerationQueue];
    
    for (const queue of queues) {
      const failed = await queue.getFailed();
      const recentlyFailed = failed.filter(job => 
        job.timestamp && (now - job.timestamp) <= maxAge
      );
      
      await Promise.all(recentlyFailed.map(job => job.retry()));
    }
  }

  static async pauseAllQueues() {
    await Promise.all([
      videoProcessingQueue.pause(),
      transcriptionQueue.pause(),
      clipGenerationQueue.pause(),
    ]);
  }

  static async resumeAllQueues() {
    await Promise.all([
      videoProcessingQueue.resume(),
      transcriptionQueue.resume(),
      clipGenerationQueue.resume(),
    ]);
  }

  static async getProcessingMetrics() {
    const keys = await metricsRedis.keys('processing:*');
    const metrics: Record<string, any> = {};
    
    for (const key of keys) {
      const type = await metricsRedis.type(key);
      if (type === 'zset') {
        // Get recent values (last 24 hours)
        const values = await metricsRedis.zrangebyscore(
          key, 
          Date.now() - 24 * 60 * 60 * 1000, 
          Date.now()
        );
        metrics[key] = values;
      } else if (type === 'string') {
        metrics[key] = await metricsRedis.get(key);
      }
    }
    
    return metrics;
  }
}

// Graceful shutdown with cleanup
process.on('SIGTERM', async () => {
  console.log('Shutting down enhanced job queues...');
  
  // Pause new jobs
  await EnhancedJobQueueManager.pauseAllQueues();
  
  // Wait for current jobs to complete (with timeout)
  const timeout = setTimeout(() => {
    console.log('Force shutting down queues...');
    process.exit(1);
  }, 30000);
  
  try {
    await Promise.all([
      videoProcessingQueue.close(),
      transcriptionQueue.close(),
      clipGenerationQueue.close(),
    ]);
    
    await Promise.all([
      redis.disconnect(),
      cacheRedis.disconnect(),
      metricsRedis.disconnect(),
    ]);
    
    clearTimeout(timeout);
    console.log('Graceful shutdown complete');
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
});

// Health check endpoint data
export async function getSystemHealth() {
  const health = await PerformanceMonitor.checkSystemHealth();
  const queueStats = await EnhancedJobQueueManager.getDetailedQueueStats();
  
  return {
    healthy: health.healthy,
    system: health,
    queues: queueStats.queues,
    timestamp: Date.now(),
  };
}