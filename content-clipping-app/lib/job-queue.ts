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
  // Connection pool settings
  family: 4,
  keepAlive: true,
  connectTimeout: 10000,
  commandTimeout: 5000,
  // Retry configuration
  retryDelayOnClusterDown: 300,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
};

// Cache configuration
const CACHE_TTL = {
  VIDEO_METADATA: 24 * 60 * 60, // 24 hours
  TRANSCRIPTION: 7 * 24 * 60 * 60, // 7 days
  THUMBNAILS: 30 * 24 * 60 * 60, // 30 days
  CLIPS: 7 * 24 * 60 * 60, // 7 days
};

// Performance configuration
const PERFORMANCE_CONFIG = {
  MAX_CONCURRENT_VIDEO_JOBS: Math.max(1, Math.floor(os.cpus().length / 2)),
  MAX_CONCURRENT_TRANSCRIPTION_JOBS: Math.max(1, Math.floor(os.cpus().length / 4)),
  MAX_CONCURRENT_CLIP_JOBS: Math.max(1, Math.floor(os.cpus().length / 2)),
  MEMORY_THRESHOLD: 0.85, // 85% memory usage threshold
  CPU_THRESHOLD: 0.80, // 80% CPU usage threshold
};

// Create Redis connection
const redis = new Redis(redisConfig);

// Job data interfaces
export interface VideoProcessingJobData {
  videoId: string;
  userId: string;
  videoPath: string;
  priority?: number;
}

export interface TranscriptionJobData {
  videoId: string;
  audioPath: string;
  language?: string;
}

export interface ClipGenerationJobData {
  videoId: string;
  videoPath: string;
  transcriptionId: string;
}

// Create job queues
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
    // Job timeout based on video size (default 30 minutes)
    timeout: parseInt(process.env.VIDEO_PROCESSING_TIMEOUT || '1800000'),
    // Job TTL - remove job after 48 hours
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
    removeOnComplete: 5,
    removeOnFail: 3,
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
    removeOnComplete: 5,
    removeOnFail: 3,
  },
});

// Job processing functions
export class VideoProcessor {
  /**
   * Main video processing job
   */
  static async processVideo(job: Queue.Job<VideoProcessingJobData>) {
    const { videoId, videoPath } = job.data;
    
    try {
      // Update status
      await VideoProcessor.updateProcessingStatus(videoId, 'EXTRACTING_METADATA', 10);
      
      // Step 1: Extract metadata
      const metadata = await FFmpegService.getVideoMetadata(videoPath);
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

      await VideoProcessor.updateProcessingStatus(videoId, 'GENERATING_THUMBNAIL', 30);

      // Step 2: Generate thumbnail
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

      await VideoProcessor.updateProcessingStatus(videoId, 'EXTRACTING_AUDIO', 50);

      // Step 3: Extract audio for transcription
      const audioDir = path.join(process.cwd(), 'temp', 'audio');
      await fs.mkdir(audioDir, { recursive: true });
      const audioPath = path.join(audioDir, `${videoId}.mp3`);
      
      await FFmpegService.extractAudio(videoPath, audioPath);
      
      await prisma.video.update({
        where: { id: videoId },
        data: {
          audioExtracted: true,
          processingProgress: 60,
        },
      });

      // Step 4: Queue transcription job
      await transcriptionQueue.add('transcribe', {
        videoId,
        audioPath,
      }, {
        priority: job.data.priority || 0,
      });

      await VideoProcessor.updateProcessingStatus(videoId, 'TRANSCRIBING', 70);

      return { success: true, audioPath };
    } catch (error) {
      await VideoProcessor.updateProcessingStatus(videoId, 'FAILED', 0, error.message);
      throw error;
    }
  }

  /**
   * Transcription job
   */
  static async processTranscription(job: Queue.Job<TranscriptionJobData>) {
    const { videoId, audioPath, language } = job.data;

    try {
      // Perform transcription
      const transcriptionResult = await WhisperService.transcribeAudio(audioPath, {
        language,
        responseFormat: 'verbose_json',
        timestampGranularities: ['segment']
      });

      // Save transcription to database
      const transcription = await prisma.transcription.create({
        data: {
          videoId,
          text: transcriptionResult.text,
          language: transcriptionResult.language,
          segments: {
            create: transcriptionResult.segments.map(segment => ({
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
        },
      });

      // Queue clip generation
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
        });
      }

      // Clean up audio file
      try {
        await fs.unlink(audioPath);
      } catch (error) {
        console.warn('Failed to delete audio file:', error);
      }

      return { success: true, transcriptionId: transcription.id };
    } catch (error) {
      await VideoProcessor.updateProcessingStatus(videoId, 'FAILED', 0, error.message);
      throw error;
    }
  }

  /**
   * Clip generation job
   */
  static async generateClips(job: Queue.Job<ClipGenerationJobData>) {
    const { videoId, videoPath, transcriptionId } = job.data;

    try {
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

      // Detect clips
      const detectedClips = await ClipDetectionService.detectClips(videoPath, segments, {
        minClipDuration: 5,
        maxClipDuration: 60,
        maxClips: 10,
        scoreThreshold: 2.5,
      });

      // Save clips to database
      const clipPromises = detectedClips.map((clip, index) =>
        prisma.clip.create({
          data: {
            videoId,
            title: clip.title,
            description: clip.description,
            startTime: Math.floor(clip.startTime),
            endTime: Math.floor(clip.endTime),
            tags: clip.tags,
            score: clip.score,
            confidence: clip.confidence,
            reason: clip.reason,
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
        },
      });

      return { success: true, clipsGenerated: detectedClips.length };
    } catch (error) {
      await VideoProcessor.updateProcessingStatus(videoId, 'FAILED', 0, error.message);
      throw error;
    }
  }

  /**
   * Helper to update processing status
   */
  private static async updateProcessingStatus(
    videoId: string,
    stage: string,
    progress: number,
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
      },
    });

    // Emit progress update via WebSocket
    websocketService.emitProcessingProgress({
      videoId,
      stage,
      progress,
      errorMessage,
      message: this.getStageMessage(stage)
    });

    // Handle completion and errors
    if (stage === 'COMPLETED') {
      const video = await prisma.video.findUnique({
        where: { id: videoId },
        include: {
          transcription: true,
          clips: { take: 10, orderBy: { score: 'desc' } }
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

// Register job processors
videoProcessingQueue.process('process-video', 1, VideoProcessor.processVideo);
transcriptionQueue.process('transcribe', 1, VideoProcessor.processTranscription);
clipGenerationQueue.process('generate-clips', 1, VideoProcessor.generateClips);

// Queue event handlers
videoProcessingQueue.on('completed', (job, result) => {
  console.log(`Video processing job ${job.id} completed:`, result);
});

videoProcessingQueue.on('failed', (job, err) => {
  console.error(`Video processing job ${job.id} failed:`, err);
});

transcriptionQueue.on('completed', (job, result) => {
  console.log(`Transcription job ${job.id} completed:`, result);
});

transcriptionQueue.on('failed', (job, err) => {
  console.error(`Transcription job ${job.id} failed:`, err);
});

clipGenerationQueue.on('completed', (job, result) => {
  console.log(`Clip generation job ${job.id} completed:`, result);
});

clipGenerationQueue.on('failed', (job, err) => {
  console.error(`Clip generation job ${job.id} failed:`, err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down job queues...');
  await videoProcessingQueue.close();
  await transcriptionQueue.close();
  await clipGenerationQueue.close();
  await redis.disconnect();
});

// Utility functions
export class JobQueueManager {
  static async addVideoProcessingJob(videoId: string, userId: string, videoPath: string, priority = 0) {
    return videoProcessingQueue.add('process-video', {
      videoId,
      userId,
      videoPath,
      priority,
    }, {
      priority,
    });
  }

  static async getJobStatus(jobId: string, queueName: 'video' | 'transcription' | 'clips') {
    let queue;
    switch (queueName) {
      case 'video':
        queue = videoProcessingQueue;
        break;
      case 'transcription':
        queue = transcriptionQueue;
        break;
      case 'clips':
        queue = clipGenerationQueue;
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
    };
  }

  static async getQueueStats() {
    const videoStats = await videoProcessingQueue.getJobCounts();
    const transcriptionStats = await transcriptionQueue.getJobCounts();
    const clipStats = await clipGenerationQueue.getJobCounts();

    return {
      video: videoStats,
      transcription: transcriptionStats,
      clips: clipStats,
    };
  }

  static async clearFailedJobs() {
    await videoProcessingQueue.clean(0, 'failed');
    await transcriptionQueue.clean(0, 'failed');
    await clipGenerationQueue.clean(0, 'failed');
  }

  static async retryFailedJobs() {
    const videoFailed = await videoProcessingQueue.getFailed();
    const transcriptionFailed = await transcriptionQueue.getFailed();
    const clipsFailed = await clipGenerationQueue.getFailed();

    const retryPromises = [
      ...videoFailed.map(job => job.retry()),
      ...transcriptionFailed.map(job => job.retry()),
      ...clipsFailed.map(job => job.retry()),
    ];

    await Promise.all(retryPromises);
  }
}