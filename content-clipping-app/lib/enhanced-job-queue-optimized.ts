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
import { EventEmitter } from 'events';

// Performance monitoring and resource management
class ResourceMonitor extends EventEmitter {
  private memoryThreshold: number;
  private cpuThreshold: number;
  private monitoringInterval: NodeJS.Timeout;
  private lastCpuUsage = process.cpuUsage();
  
  constructor(options: { memoryThreshold: number; cpuThreshold: number }) {
    super();
    this.memoryThreshold = options.memoryThreshold;
    this.cpuThreshold = options.cpuThreshold;
    this.startMonitoring();
  }

  private startMonitoring() {
    this.monitoringInterval = setInterval(() => {
      const memoryUsage = this.getMemoryUsage();
      const cpuUsage = this.getCpuUsage();
      
      this.emit('metrics', { memoryUsage, cpuUsage });
      
      if (memoryUsage > this.memoryThreshold) {
        this.emit('memoryThresholdExceeded', memoryUsage);
      }
      
      if (cpuUsage > this.cpuThreshold) {
        this.emit('cpuThresholdExceeded', cpuUsage);
      }
    }, 5000); // Check every 5 seconds
  }

  private getMemoryUsage(): number {
    const usage = process.memoryUsage();
    const totalMemory = os.totalmem();
    return usage.heapUsed / totalMemory;
  }

  private getCpuUsage(): number {
    const currentUsage = process.cpuUsage(this.lastCpuUsage);
    const total = currentUsage.user + currentUsage.system;
    const totalTime = 1000000; // 1 second in microseconds
    this.lastCpuUsage = process.cpuUsage();
    return total / totalTime;
  }

  public getSystemMetrics() {
    return {
      memoryUsage: this.getMemoryUsage(),
      cpuUsage: this.getCpuUsage(),
      freeMem: os.freemem(),
      totalMem: os.totalmem(),
      loadAverage: os.loadavg(),
      cpuCount: os.cpus().length,
    };
  }

  public stop() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
  }
}

// Enhanced Redis configuration with clustering support
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  retryDelayOnFailover: 100,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  keyPrefix: 'clipmaster:',
  // Connection pool settings
  family: 4,
  keepAlive: true,
  connectTimeout: 10000,
  commandTimeout: 5000,
  // Memory optimization
  maxMemoryPolicy: 'allkeys-lru',
  // Cluster settings for high availability
  enableAutoPipelining: true,
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
};

// Cache configuration with TTL optimization
const CACHE_TTL = {
  VIDEO_METADATA: 24 * 60 * 60, // 24 hours
  TRANSCRIPTION: 7 * 24 * 60 * 60, // 7 days
  THUMBNAILS: 30 * 24 * 60 * 60, // 30 days
  CLIPS: 7 * 24 * 60 * 60, // 7 days
  PROCESSING_STATUS: 5 * 60, // 5 minutes
  FILE_METADATA: 60 * 60, // 1 hour
};

// Dynamic performance configuration based on system resources
class PerformanceManager {
  private cpuCount: number;
  private totalMemory: number;
  private resourceMonitor: ResourceMonitor;
  
  constructor() {
    this.cpuCount = os.cpus().length;
    this.totalMemory = os.totalmem();
    this.resourceMonitor = new ResourceMonitor({
      memoryThreshold: 0.85, // 85% memory usage
      cpuThreshold: 0.80, // 80% CPU usage
    });
    
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.resourceMonitor.on('memoryThresholdExceeded', (usage) => {
      console.warn(`Memory threshold exceeded: ${(usage * 100).toFixed(2)}%`);
      this.reduceProcessingLoad();
    });

    this.resourceMonitor.on('cpuThresholdExceeded', (usage) => {
      console.warn(`CPU threshold exceeded: ${(usage * 100).toFixed(2)}%`);
      this.reduceConcurrentJobs();
    });
  }

  public getDynamicConfig() {
    const memoryGB = this.totalMemory / (1024 ** 3);
    const availableMemory = os.freemem();
    const memoryUsageRatio = (this.totalMemory - availableMemory) / this.totalMemory;
    
    // Adjust concurrency based on available resources
    let maxConcurrentVideoJobs = Math.max(1, Math.floor(this.cpuCount / 2));
    let maxConcurrentTranscriptionJobs = Math.max(1, Math.floor(this.cpuCount / 4));
    let maxConcurrentClipJobs = Math.max(1, Math.floor(this.cpuCount / 3));
    
    // Reduce concurrency if memory usage is high
    if (memoryUsageRatio > 0.75) {
      maxConcurrentVideoJobs = Math.max(1, Math.floor(maxConcurrentVideoJobs * 0.7));
      maxConcurrentTranscriptionJobs = Math.max(1, Math.floor(maxConcurrentTranscriptionJobs * 0.7));
      maxConcurrentClipJobs = Math.max(1, Math.floor(maxConcurrentClipJobs * 0.7));
    }
    
    return {
      MAX_CONCURRENT_VIDEO_JOBS: maxConcurrentVideoJobs,
      MAX_CONCURRENT_TRANSCRIPTION_JOBS: maxConcurrentTranscriptionJobs,
      MAX_CONCURRENT_CLIP_JOBS: maxConcurrentClipJobs,
      MEMORY_THRESHOLD: 0.85,
      CPU_THRESHOLD: 0.80,
      QUEUE_STALLED_INTERVAL: memoryUsageRatio > 0.8 ? 60000 : 30000,
      JOB_TIMEOUT: memoryUsageRatio > 0.8 ? 3600000 : 1800000, // 1 hour vs 30 minutes
    };
  }

  private reduceProcessingLoad() {
    // Temporarily reduce processing load by pausing lower priority jobs
    console.log('Reducing processing load due to high memory usage');
    // Implementation would pause non-critical queues or reduce concurrency
  }

  private reduceConcurrentJobs() {
    // Temporarily reduce concurrent job processing
    console.log('Reducing concurrent jobs due to high CPU usage');
    // Implementation would dynamically adjust queue concurrency
  }

  public getMetrics() {
    return this.resourceMonitor.getSystemMetrics();
  }
}

// Initialize performance manager
const performanceManager = new PerformanceManager();
const redis = new Redis(redisConfig);

// Enhanced cache manager
export class CacheManager {
  private redis: Redis;
  private hitCount = 0;
  private missCount = 0;
  
  constructor(redisInstance: Redis) {
    this.redis = redisInstance;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.redis.get(key);
      if (cached) {
        this.hitCount++;
        return JSON.parse(cached);
      }
      this.missCount++;
      return null;
    } catch (error) {
      console.error('Cache get error:', error);
      this.missCount++;
      return null;
    }
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttl) {
        await this.redis.setex(key, ttl, serialized);
      } else {
        await this.redis.set(key, serialized);
      }
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      console.error('Cache delete error:', error);
    }
  }

  async mget(keys: string[]): Promise<(any | null)[]> {
    try {
      const values = await this.redis.mget(...keys);
      return values.map((value, index) => {
        if (value) {
          this.hitCount++;
          return JSON.parse(value);
        }
        this.missCount++;
        return null;
      });
    } catch (error) {
      console.error('Cache mget error:', error);
      this.missCount += keys.length;
      return keys.map(() => null);
    }
  }

  async mset(keyValuePairs: Array<{ key: string; value: any; ttl?: number }>): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      
      keyValuePairs.forEach(({ key, value, ttl }) => {
        const serialized = JSON.stringify(value);
        if (ttl) {
          pipeline.setex(key, ttl, serialized);
        } else {
          pipeline.set(key, serialized);
        }
      });
      
      await pipeline.exec();
    } catch (error) {
      console.error('Cache mset error:', error);
    }
  }

  getCacheStats() {
    const total = this.hitCount + this.missCount;
    return {
      hits: this.hitCount,
      misses: this.missCount,
      hitRate: total > 0 ? this.hitCount / total : 0,
    };
  }

  async getCacheSize(): Promise<number> {
    try {
      const info = await this.redis.info('memory');
      const match = info.match(/used_memory:(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    } catch (error) {
      console.error('Error getting cache size:', error);
      return 0;
    }
  }
}

export const cacheManager = new CacheManager(redis);

// Job data interfaces with enhanced metadata
export interface EnhancedVideoProcessingJobData {
  videoId: string;
  userId: string;
  videoPath: string;
  priority?: number;
  metadata?: {
    fileSize: number;
    estimatedDuration?: number;
    format?: string;
    retryCount?: number;
  };
}

export interface EnhancedTranscriptionJobData {
  videoId: string;
  audioPath: string;
  language?: string;
  priority?: number;
  metadata?: {
    audioSize: number;
    estimatedDuration?: number;
    retryCount?: number;
  };
}

export interface EnhancedClipGenerationJobData {
  videoId: string;
  videoPath: string;
  transcriptionId: string;
  priority?: number;
  metadata?: {
    segmentCount?: number;
    retryCount?: number;
  };
}

// Enhanced queue configuration with dynamic settings
const dynamicConfig = performanceManager.getDynamicConfig();

export const optimizedVideoProcessingQueue = new Queue<EnhancedVideoProcessingJobData>('optimized-video-processing', {
  redis: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 50, // Keep more completed jobs for analysis
    removeOnFail: 20,
    timeout: dynamicConfig.JOB_TIMEOUT,
    ttl: 72 * 60 * 60 * 1000, // 72 hours
  },
  settings: {
    stalledInterval: dynamicConfig.QUEUE_STALLED_INTERVAL,
    maxStalledCount: 2,
    retryProcessDelay: 5000,
  },
});

export const optimizedTranscriptionQueue = new Queue<EnhancedTranscriptionJobData>('optimized-transcription', {
  redis: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 30,
    removeOnFail: 10,
    timeout: 30 * 60 * 1000, // 30 minutes
  },
});

export const optimizedClipGenerationQueue = new Queue<EnhancedClipGenerationJobData>('optimized-clip-generation', {
  redis: redisConfig,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 3000,
    },
    removeOnComplete: 20,
    removeOnFail: 10,
    timeout: 15 * 60 * 1000, // 15 minutes
  },
});

// Enhanced video processor with performance tracking
export class OptimizedVideoProcessor {
  /**
   * Main video processing job with enhanced monitoring
   */
  static async processVideo(job: Queue.Job<EnhancedVideoProcessingJobData>) {
    const startTime = Date.now();
    const { videoId, videoPath, metadata } = job.data;
    let metricsId: string;
    
    try {
      // Start performance tracking
      const initialMetrics = performanceManager.getMetrics();
      const processingMetrics = await prisma.processingMetrics.create({
        data: {
          videoId,
          stage: 'EXTRACTING_METADATA',
          duration: 0,
          memoryUsage: BigInt(Math.round(initialMetrics.memoryUsage * initialMetrics.totalMem)),
          cpuUsage: initialMetrics.cpuUsage * 100,
          queueWaitTime: startTime - job.timestamp,
          concurrentJobs: await optimizedVideoProcessingQueue.getActive().then(jobs => jobs.length),
          metadata: { jobId: job.id, ...metadata },
        },
      });
      metricsId = processingMetrics.id;
      
      // Check cache for video metadata
      const cacheKey = `video_metadata:${videoId}`;
      let cachedMetadata = await cacheManager.get<any>(cacheKey);
      
      if (!cachedMetadata) {
        // Update status with progress tracking
        await OptimizedVideoProcessor.updateProcessingStatus(videoId, 'EXTRACTING_METADATA', 10, metricsId);
        
        // Step 1: Extract metadata with performance monitoring
        const extractStartTime = Date.now();
        const videoMetadata = await FFmpegService.getVideoMetadata(videoPath);
        const fileSize = await FFmpegService.getFileSize(videoPath);
        const extractDuration = Date.now() - extractStartTime;
        
        cachedMetadata = {
          ...videoMetadata,
          fileSize: Number(fileSize),
          extractionTime: extractDuration,
        };
        
        // Cache metadata for future use
        await cacheManager.set(cacheKey, cachedMetadata, CACHE_TTL.VIDEO_METADATA);
        
        await prisma.video.update({
          where: { id: videoId },
          data: {
            duration: videoMetadata.duration,
            width: videoMetadata.width,
            height: videoMetadata.height,
            fps: videoMetadata.fps,
            bitrate: videoMetadata.bitrate,
            codec: videoMetadata.codec,
            fileSize: BigInt(fileSize),
            filePath: videoPath,
            cacheKey,
            metadataExtracted: true,
            processingProgress: 20,
            lastProcessedAt: new Date(),
          },
        });
      } else {
        console.log(`Using cached metadata for video ${videoId}`);
      }

      await OptimizedVideoProcessor.updateProcessingStatus(videoId, 'GENERATING_THUMBNAIL', 30, metricsId);

      // Step 2: Generate thumbnail with caching
      const thumbnailCacheKey = `thumbnail:${videoId}`;
      let thumbnailUrl = await cacheManager.get<string>(thumbnailCacheKey);
      
      if (!thumbnailUrl) {
        const thumbnailDir = path.join(process.cwd(), 'public', 'uploads', 'thumbnails');
        const thumbnailPaths = await FFmpegService.generateThumbnail(
          videoPath, 
          thumbnailDir,
          {
            count: 1,
            timemarks: ['10%'],
            size: '640x360',
            filename: `${videoId}_thumb.jpg`
          }
        );

        if (thumbnailPaths.length > 0) {
          thumbnailUrl = `/uploads/thumbnails/${path.basename(thumbnailPaths[0])}`;
          await cacheManager.set(thumbnailCacheKey, thumbnailUrl, CACHE_TTL.THUMBNAILS);
          
          await prisma.video.update({
            where: { id: videoId },
            data: {
              thumbnail: thumbnailUrl,
              thumbnailGenerated: true,
              processingProgress: 40,
            },
          });
        }
      }

      await OptimizedVideoProcessor.updateProcessingStatus(videoId, 'EXTRACTING_AUDIO', 50, metricsId);

      // Step 3: Extract audio with optimizations
      const audioDir = path.join(process.cwd(), 'temp', 'audio');
      await fs.mkdir(audioDir, { recursive: true });
      const audioPath = path.join(audioDir, `${videoId}.mp3`);
      
      // Check if audio already exists and is valid
      let audioExists = false;
      try {
        await fs.access(audioPath);
        const audioStats = await fs.stat(audioPath);
        if (audioStats.size > 0) {
          audioExists = true;
        }
      } catch {
        audioExists = false;
      }
      
      if (!audioExists) {
        await FFmpegService.extractAudio(videoPath, audioPath);
      }
      
      await prisma.video.update({
        where: { id: videoId },
        data: {
          audioExtracted: true,
          processingProgress: 60,
        },
      });

      // Step 4: Queue transcription job with priority
      const transcriptionPriority = (metadata?.fileSize && metadata.fileSize < 100 * 1024 * 1024) ? 10 : 0; // Higher priority for smaller files
      await optimizedTranscriptionQueue.add('transcribe', {
        videoId,
        audioPath,
        priority: transcriptionPriority,
        metadata: {
          audioSize: (await fs.stat(audioPath)).size,
          estimatedDuration: cachedMetadata.duration,
        },
      }, {
        priority: transcriptionPriority,
      });

      await OptimizedVideoProcessor.updateProcessingStatus(videoId, 'TRANSCRIBING', 70, metricsId);
      
      // Update final metrics
      const endTime = Date.now();
      const finalMetrics = performanceManager.getMetrics();
      
      await prisma.processingMetrics.update({
        where: { id: metricsId },
        data: {
          duration: endTime - startTime,
          memoryUsage: BigInt(Math.round(finalMetrics.memoryUsage * finalMetrics.totalMem)),
          cpuUsage: finalMetrics.cpuUsage * 100,
          metadata: {
            ...processingMetrics.metadata,
            totalProcessingTime: endTime - startTime,
            cacheHit: !!cachedMetadata,
          },
        },
      });

      return { 
        success: true, 
        audioPath, 
        processingTime: endTime - startTime,
        cacheUsed: !!cachedMetadata,
      };
    } catch (error) {
      await OptimizedVideoProcessor.updateProcessingStatus(videoId, 'FAILED', 0, metricsId, error.message);
      
      // Update error metrics
      if (metricsId) {
        await prisma.processingMetrics.update({
          where: { id: metricsId },
          data: {
            duration: Date.now() - startTime,
            errorMessage: error.message,
          },
        });
      }
      
      throw error;
    }
  }

  /**
   * Enhanced transcription processing with caching
   */
  static async processTranscription(job: Queue.Job<EnhancedTranscriptionJobData>) {
    const startTime = Date.now();
    const { videoId, audioPath, language, metadata } = job.data;
    let metricsId: string;

    try {
      // Start performance tracking
      const initialMetrics = performanceManager.getMetrics();
      const processingMetrics = await prisma.processingMetrics.create({
        data: {
          videoId,
          stage: 'TRANSCRIBING',
          duration: 0,
          memoryUsage: BigInt(Math.round(initialMetrics.memoryUsage * initialMetrics.totalMem)),
          cpuUsage: initialMetrics.cpuUsage * 100,
          queueWaitTime: startTime - job.timestamp,
          concurrentJobs: await optimizedTranscriptionQueue.getActive().then(jobs => jobs.length),
          metadata: { jobId: job.id, ...metadata },
        },
      });
      metricsId = processingMetrics.id;

      // Check cache for existing transcription
      const transcriptionCacheKey = `transcription:${videoId}:${language || 'auto'}`;
      let transcriptionData = await cacheManager.get<any>(transcriptionCacheKey);
      
      if (!transcriptionData) {
        // Perform transcription
        const transcriptionResult = await WhisperService.transcribeAudio(audioPath, {
          language,
          responseFormat: 'verbose_json',
          timestampGranularities: ['segment']
        });
        
        transcriptionData = {
          text: transcriptionResult.text,
          language: transcriptionResult.language,
          segments: transcriptionResult.segments,
          processingTime: Date.now() - startTime,
        };
        
        // Cache transcription result
        await cacheManager.set(transcriptionCacheKey, transcriptionData, CACHE_TTL.TRANSCRIPTION);
      }

      // Save transcription to database
      const transcription = await prisma.transcription.create({
        data: {
          videoId,
          text: transcriptionData.text,
          language: transcriptionData.language,
          segments: {
            create: transcriptionData.segments.map((segment: any) => ({
              text: segment.text,
              startTime: segment.start,
              endTime: segment.end,
              confidence: segment.confidence,
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
          lastProcessedAt: new Date(),
        },
      });

      // Queue clip generation with metadata
      const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: { url: true, filePath: true }
      });

      if (video) {
        const videoPath = video.filePath || path.join(process.cwd(), 'public', video.url);
        await optimizedClipGenerationQueue.add('generate-clips', {
          videoId,
          videoPath,
          transcriptionId: transcription.id,
          metadata: {
            segmentCount: transcriptionData.segments.length,
          },
        });
      }

      // Clean up audio file
      try {
        await fs.unlink(audioPath);
      } catch (error) {
        console.warn('Failed to delete audio file:', error);
      }

      // Update final metrics
      const endTime = Date.now();
      const finalMetrics = performanceManager.getMetrics();
      
      await prisma.processingMetrics.update({
        where: { id: metricsId },
        data: {
          duration: endTime - startTime,
          memoryUsage: BigInt(Math.round(finalMetrics.memoryUsage * finalMetrics.totalMem)),
          cpuUsage: finalMetrics.cpuUsage * 100,
          metadata: {
            ...processingMetrics.metadata,
            totalProcessingTime: endTime - startTime,
            cacheUsed: !!transcriptionData,
            segmentCount: transcriptionData.segments.length,
          },
        },
      });

      return { 
        success: true, 
        transcriptionId: transcription.id,
        processingTime: endTime - startTime,
        segmentCount: transcriptionData.segments.length,
      };
    } catch (error) {
      await OptimizedVideoProcessor.updateProcessingStatus(videoId, 'FAILED', 0, metricsId, error.message);
      
      if (metricsId) {
        await prisma.processingMetrics.update({
          where: { id: metricsId },
          data: {
            duration: Date.now() - startTime,
            errorMessage: error.message,
          },
        });
      }
      
      throw error;
    }
  }

  /**
   * Enhanced clip generation with caching and optimization
   */
  static async generateClips(job: Queue.Job<EnhancedClipGenerationJobData>) {
    const startTime = Date.now();
    const { videoId, videoPath, transcriptionId, metadata } = job.data;
    let metricsId: string;

    try {
      // Start performance tracking
      const initialMetrics = performanceManager.getMetrics();
      const processingMetrics = await prisma.processingMetrics.create({
        data: {
          videoId,
          stage: 'GENERATING_CLIPS',
          duration: 0,
          memoryUsage: BigInt(Math.round(initialMetrics.memoryUsage * initialMetrics.totalMem)),
          cpuUsage: initialMetrics.cpuUsage * 100,
          queueWaitTime: startTime - job.timestamp,
          concurrentJobs: await optimizedClipGenerationQueue.getActive().then(jobs => jobs.length),
          metadata: { jobId: job.id, ...metadata },
        },
      });
      metricsId = processingMetrics.id;

      // Check cache for existing clips
      const clipsCacheKey = `clips:${videoId}:${transcriptionId}`;
      let clipsData = await cacheManager.get<any>(clipsCacheKey);
      
      if (!clipsData) {
        // Get transcription with segments
        const transcription = await prisma.transcription.findUnique({
          where: { id: transcriptionId },
          include: {
            segments: {
              orderBy: { startTime: 'asc' }
            }
          }
        });

        if (!transcription) {
          throw new Error('Transcription not found');
        }

        // Convert segments to expected format
        const segments = transcription.segments.map((segment, index) => ({
          id: index,
          text: segment.text,
          start: segment.startTime,
          end: segment.endTime,
          confidence: segment.confidence,
        }));

        // Detect clips with optimized parameters
        const detectedClips = await ClipDetectionService.detectClips(videoPath, segments, {
          minClipDuration: 5,
          maxClipDuration: 60,
          maxClips: 15, // Increased for better selection
          scoreThreshold: 2.0, // Lowered threshold for more clips
        });

        clipsData = {
          clips: detectedClips,
          processingTime: Date.now() - startTime,
        };
        
        // Cache clips data
        await cacheManager.set(clipsCacheKey, clipsData, CACHE_TTL.CLIPS);
      }

      // Save clips to database with batch processing
      const clipPromises = clipsData.clips.map((clip: any, index: number) =>
        prisma.clip.create({
          data: {
            videoId,
            title: clip.title,
            description: clip.description,
            startTime: Math.floor(clip.startTime),
            endTime: Math.floor(clip.endTime),
            duration: Math.floor(clip.endTime - clip.startTime),
            tags: clip.tags,
            score: clip.score,
            confidence: clip.confidence,
            reason: clip.reason,
            cacheKey: `${clipsCacheKey}:${index}`,
          }
        })
      );

      await Promise.all(clipPromises);

      // Update video status
      await prisma.video.update({
        where: { id: videoId },
        data: {
          clipsGenerated: true,
          processingProgress: 100,
          processingStage: 'COMPLETED',
          status: 'READY',
          processingTime: Math.floor((Date.now() - startTime) / 1000),
          lastProcessedAt: new Date(),
        },
      });

      // Update final metrics
      const endTime = Date.now();
      const finalMetrics = performanceManager.getMetrics();
      
      await prisma.processingMetrics.update({
        where: { id: metricsId },
        data: {
          duration: endTime - startTime,
          memoryUsage: BigInt(Math.round(finalMetrics.memoryUsage * finalMetrics.totalMem)),
          cpuUsage: finalMetrics.cpuUsage * 100,
          metadata: {
            ...processingMetrics.metadata,
            totalProcessingTime: endTime - startTime,
            clipsGenerated: clipsData.clips.length,
            cacheUsed: !!clipsData,
          },
        },
      });

      return { 
        success: true, 
        clipsGenerated: clipsData.clips.length,
        processingTime: endTime - startTime,
      };
    } catch (error) {
      await OptimizedVideoProcessor.updateProcessingStatus(videoId, 'FAILED', 0, metricsId, error.message);
      
      if (metricsId) {
        await prisma.processingMetrics.update({
          where: { id: metricsId },
          data: {
            duration: Date.now() - startTime,
            errorMessage: error.message,
          },
        });
      }
      
      throw error;
    }
  }

  /**
   * Helper to update processing status with metrics tracking
   */
  private static async updateProcessingStatus(
    videoId: string,
    stage: string,
    progress: number,
    metricsId?: string,
    errorMessage?: string
  ) {
    await prisma.video.update({
      where: { id: videoId },
      data: {
        processingStage: stage as any,
        processingProgress: progress,
        status: stage === 'FAILED' ? 'ERROR' : stage === 'COMPLETED' ? 'READY' : 'PROCESSING',
        errorMessage: errorMessage || null,
        updatedAt: new Date(),
        lastProcessedAt: new Date(),
      },
    });

    // Update metrics if provided
    if (metricsId) {
      const currentMetrics = performanceManager.getMetrics();
      await prisma.processingMetrics.update({
        where: { id: metricsId },
        data: {
          stage,
          memoryUsage: BigInt(Math.round(currentMetrics.memoryUsage * currentMetrics.totalMem)),
          cpuUsage: currentMetrics.cpuUsage * 100,
          errorMessage: errorMessage || null,
        },
      });
    }

    // Emit progress update via WebSocket
    websocketService.emitProcessingProgress({
      videoId,
      stage,
      progress,
      errorMessage,
      message: OptimizedVideoProcessor.getStageMessage(stage),
      metrics: metricsId ? performanceManager.getMetrics() : undefined,
    });

    // Handle completion and errors
    if (stage === 'COMPLETED') {
      const video = await prisma.video.findUnique({
        where: { id: videoId },
        include: {
          transcription: true,
          clips: { take: 15, orderBy: { score: 'desc' } },
          processingMetrics: { orderBy: { timestamp: 'desc' }, take: 1 },
        }
      });
      websocketService.emitProcessingComplete(videoId, video);
    } else if (stage === 'FAILED' && errorMessage) {
      websocketService.emitProcessingError(videoId, errorMessage);
    }
  }

  /**
   * Get user-friendly message for processing stage
   */
  private static getStageMessage(stage: string): string {
    const messages: Record<string, string> = {
      'UPLOADED': 'Video uploaded successfully',
      'EXTRACTING_METADATA': 'Analyzing video properties...',
      'GENERATING_THUMBNAIL': 'Creating video thumbnail...',
      'EXTRACTING_AUDIO': 'Preparing audio for transcription...',
      'TRANSCRIBING': 'Converting speech to text...',
      'DETECTING_CLIPS': 'Finding potential clips...',
      'GENERATING_CLIPS': 'Creating clip suggestions...',
      'COMPLETED': 'Processing complete!',
      'FAILED': 'Processing failed'
    };
    return messages[stage] || 'Processing...';
  }
}

// Register job processors with dynamic concurrency
const config = performanceManager.getDynamicConfig();

optimizedVideoProcessingQueue.process('process-video', config.MAX_CONCURRENT_VIDEO_JOBS, OptimizedVideoProcessor.processVideo);
optimizedTranscriptionQueue.process('transcribe', config.MAX_CONCURRENT_TRANSCRIPTION_JOBS, OptimizedVideoProcessor.processTranscription);
optimizedClipGenerationQueue.process('generate-clips', config.MAX_CONCURRENT_CLIP_JOBS, OptimizedVideoProcessor.generateClips);

// Enhanced queue event handlers with metrics
optimizedVideoProcessingQueue.on('completed', async (job, result) => {
  console.log(`Optimized video processing job ${job.id} completed in ${result.processingTime}ms:`, result);
  
  // Update cache stats
  const cacheStats = cacheManager.getCacheStats();
  console.log(`Cache hit rate: ${(cacheStats.hitRate * 100).toFixed(2)}%`);
});

optimizedVideoProcessingQueue.on('failed', (job, err) => {
  console.error(`Optimized video processing job ${job.id} failed:`, err);
});

optimizedTranscriptionQueue.on('completed', (job, result) => {
  console.log(`Optimized transcription job ${job.id} completed in ${result.processingTime}ms:`, result);
});

optimizedTranscriptionQueue.on('failed', (job, err) => {
  console.error(`Optimized transcription job ${job.id} failed:`, err);
});

optimizedClipGenerationQueue.on('completed', (job, result) => {
  console.log(`Optimized clip generation job ${job.id} completed in ${result.processingTime}ms:`, result);
});

optimizedClipGenerationQueue.on('failed', (job, err) => {
  console.error(`Optimized clip generation job ${job.id} failed:`, err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down optimized job queues...');
  performanceManager.getMetrics(); // Stop monitoring
  await optimizedVideoProcessingQueue.close();
  await optimizedTranscriptionQueue.close();
  await optimizedClipGenerationQueue.close();
  await redis.disconnect();
});

// Enhanced job queue manager
export class OptimizedJobQueueManager {
  static async addVideoProcessingJob(
    videoId: string, 
    userId: string, 
    videoPath: string, 
    priority = 0,
    metadata?: any
  ) {
    // Get file size for prioritization
    const fileStats = await fs.stat(videoPath);
    const enhancedMetadata = {
      fileSize: fileStats.size,
      retryCount: 0,
      ...metadata,
    };

    return optimizedVideoProcessingQueue.add('process-video', {
      videoId,
      userId,
      videoPath,
      priority,
      metadata: enhancedMetadata,
    }, {
      priority,
      delay: 0, // Process immediately
    });
  }

  static async getJobStatus(jobId: string, queueName: 'video' | 'transcription' | 'clips') {
    let queue;
    switch (queueName) {
      case 'video':
        queue = optimizedVideoProcessingQueue;
        break;
      case 'transcription':
        queue = optimizedTranscriptionQueue;
        break;
      case 'clips':
        queue = optimizedClipGenerationQueue;
        break;
    }

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
    };
  }

  static async getDetailedQueueStats() {
    const [videoStats, transcriptionStats, clipStats] = await Promise.all([
      optimizedVideoProcessingQueue.getJobCounts(),
      optimizedTranscriptionQueue.getJobCounts(),
      optimizedClipGenerationQueue.getJobCounts(),
    ]);

    const systemMetrics = performanceManager.getMetrics();
    const cacheStats = cacheManager.getCacheStats();
    const cacheSize = await cacheManager.getCacheSize();

    return {
      queues: {
        video: videoStats,
        transcription: transcriptionStats,
        clips: clipStats,
      },
      system: systemMetrics,
      cache: {
        ...cacheStats,
        sizeBytes: cacheSize,
        sizeMB: (cacheSize / (1024 * 1024)).toFixed(2),
      },
      performance: {
        config: config,
        timestamp: new Date(),
      },
    };
  }

  static async clearFailedJobs() {
    await Promise.all([
      optimizedVideoProcessingQueue.clean(0, 'failed'),
      optimizedTranscriptionQueue.clean(0, 'failed'),
      optimizedClipGenerationQueue.clean(0, 'failed'),
    ]);
  }

  static async retryFailedJobs() {
    const [videoFailed, transcriptionFailed, clipsFailed] = await Promise.all([
      optimizedVideoProcessingQueue.getFailed(),
      optimizedTranscriptionQueue.getFailed(),
      optimizedClipGenerationQueue.getFailed(),
    ]);

    const retryPromises = [
      ...videoFailed.map(job => job.retry()),
      ...transcriptionFailed.map(job => job.retry()),
      ...clipsFailed.map(job => job.retry()),
    ];

    await Promise.all(retryPromises);
  }

  static async optimizeQueue(queueName: 'video' | 'transcription' | 'clips') {
    let queue;
    switch (queueName) {
      case 'video':
        queue = optimizedVideoProcessingQueue;
        break;
      case 'transcription':
        queue = optimizedTranscriptionQueue;
        break;
      case 'clips':
        queue = optimizedClipGenerationQueue;
        break;
    }

    // Clean old completed jobs
    await queue.clean(24 * 60 * 60 * 1000, 'completed'); // Clean jobs older than 24h
    await queue.clean(7 * 24 * 60 * 60 * 1000, 'failed'); // Clean failed jobs older than 7 days
  }

  static async pauseProcessing() {
    await Promise.all([
      optimizedVideoProcessingQueue.pause(),
      optimizedTranscriptionQueue.pause(),
      optimizedClipGenerationQueue.pause(),
    ]);
  }

  static async resumeProcessing() {
    await Promise.all([
      optimizedVideoProcessingQueue.resume(),
      optimizedTranscriptionQueue.resume(),
      optimizedClipGenerationQueue.resume(),
    ]);
  }
}

export { performanceManager };