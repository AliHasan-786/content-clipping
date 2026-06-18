import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { VideoMetadata } from './video-utils';
import { EventEmitter } from 'events';

// Enhanced video metadata interface
export interface OptimizedVideoMetadata extends VideoMetadata {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  codec: string;
  duration: number;
  audioCodec?: string;
  audioChannels?: number;
  audioSampleRate?: number;
  aspectRatio?: string;
  colorSpace?: string;
  pixelFormat?: string;
  hasAudio: boolean;
  hasVideo: boolean;
  metadata?: Record<string, any>;
}

export interface OptimizedThumbnailOptions {
  count?: number;
  timemarks?: string[];
  size?: string;
  folder?: string;
  filename?: string;
  quality?: number; // 1-31, lower is better quality
  format?: 'jpg' | 'png' | 'webp';
}

export interface OptimizedVideoTrimOptions {
  startTime: number;
  endTime: number;
  outputPath: string;
  quality?: 'high' | 'medium' | 'low';
  preset?: 'ultrafast' | 'fast' | 'medium' | 'slow';
  crf?: number; // Constant Rate Factor for quality
  maxFileSize?: number; // Maximum output file size in bytes
}

export interface BatchProcessingOptions {
  concurrency?: number;
  tempDir?: string;
  cleanupTemp?: boolean;
  progressCallback?: (progress: number, currentFile: string) => void;
}

export interface ResourceLimits {
  maxMemoryMB?: number;
  maxCpuPercent?: number;
  tempDiskSpaceMB?: number;
  timeoutSeconds?: number;
}

// Resource monitoring class
class ResourceMonitor extends EventEmitter {
  private limits: ResourceLimits;
  private monitoringInterval?: NodeJS.Timeout;
  
  constructor(limits: ResourceLimits) {
    super();
    this.limits = limits;
  }

  startMonitoring() {
    this.monitoringInterval = setInterval(() => {
      this.checkResources();
    }, 5000); // Check every 5 seconds
  }

  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
  }

  private checkResources() {
    const memoryUsage = process.memoryUsage();
    const memoryUsageMB = memoryUsage.heapUsed / 1024 / 1024;
    
    if (this.limits.maxMemoryMB && memoryUsageMB > this.limits.maxMemoryMB) {
      this.emit('memoryLimitExceeded', memoryUsageMB);
    }

    // Get load average as CPU approximation
    const loadAverage = os.loadavg()[0]; // 1-minute load average
    const cpuCount = os.cpus().length;
    const cpuPercent = (loadAverage / cpuCount) * 100;
    
    if (this.limits.maxCpuPercent && cpuPercent > this.limits.maxCpuPercent) {
      this.emit('cpuLimitExceeded', cpuPercent);
    }
  }

  async checkTempDiskSpace(tempDir: string): Promise<boolean> {
    try {
      const stats = await fs.stat(tempDir);
      // This is a simplified check - in production, you'd want to check actual disk space
      return true;
    } catch {
      return false;
    }
  }
}

// Batch processing queue for FFmpeg operations
class FFmpegBatchProcessor extends EventEmitter {
  private queue: Array<() => Promise<any>> = [];
  private running = false;
  private concurrency: number;
  private activeJobs = 0;
  private resourceMonitor: ResourceMonitor;
  
  constructor(options: BatchProcessingOptions & ResourceLimits) {
    super();
    this.concurrency = options.concurrency || Math.max(1, Math.floor(os.cpus().length / 2));
    this.resourceMonitor = new ResourceMonitor({
      maxMemoryMB: options.maxMemoryMB || 2048,
      maxCpuPercent: options.maxCpuPercent || 80,
      tempDiskSpaceMB: options.tempDiskSpaceMB || 5120,
      timeoutSeconds: options.timeoutSeconds || 3600,
    });
    
    this.setupResourceHandlers();
  }

  private setupResourceHandlers() {
    this.resourceMonitor.on('memoryLimitExceeded', (usage) => {
      console.warn(`Memory limit exceeded: ${usage.toFixed(2)}MB`);
      this.reduceConcurrency();
    });

    this.resourceMonitor.on('cpuLimitExceeded', (usage) => {
      console.warn(`CPU limit exceeded: ${usage.toFixed(2)}%`);
      this.reduceConcurrency();
    });
  }

  private reduceConcurrency() {
    if (this.concurrency > 1) {
      this.concurrency = Math.max(1, this.concurrency - 1);
      console.log(`Reduced concurrency to ${this.concurrency}`);
    }
  }

  addJob<T>(job: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await job();
          resolve(result);
          return result;
        } catch (error) {
          reject(error);
          throw error;
        }
      });
      
      if (!this.running) {
        this.processQueue();
      }
    });
  }

  private async processQueue() {
    this.running = true;
    this.resourceMonitor.startMonitoring();
    
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.concurrency - this.activeJobs);
      
      const promises = batch.map(async (job) => {
        this.activeJobs++;
        try {
          return await job();
        } finally {
          this.activeJobs--;
        }
      });
      
      await Promise.allSettled(promises);
    }
    
    this.running = false;
    this.resourceMonitor.stopMonitoring();
  }

  getStats() {
    return {
      queueLength: this.queue.length,
      activeJobs: this.activeJobs,
      concurrency: this.concurrency,
      running: this.running,
    };
  }
}

export class OptimizedFFmpegService {
  private static batchProcessor = new FFmpegBatchProcessor({
    concurrency: Math.max(1, Math.floor(os.cpus().length / 2)),
    maxMemoryMB: 2048,
    maxCpuPercent: 80,
    timeoutSeconds: 3600,
  });

  /**
   * Extract comprehensive video metadata with performance optimizations
   */
  static async getVideoMetadata(inputPath: string, useCache = true): Promise<OptimizedVideoMetadata> {
    return this.batchProcessor.addJob(async () => {
      return new Promise<OptimizedVideoMetadata>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Metadata extraction timeout'));
        }, 30000); // 30 second timeout

        ffmpeg.ffprobe(inputPath, (err, metadata) => {
          clearTimeout(timeout);
          
          if (err) {
            reject(new Error(`Failed to extract metadata: ${err.message}`));
            return;
          }

          if (!metadata.streams || metadata.streams.length === 0) {
            reject(new Error('No streams found'));
            return;
          }

          const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
          const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');

          if (!videoStream) {
            reject(new Error('No video stream found'));
            return;
          }

          const duration = Math.floor(parseFloat(metadata.format?.duration || '0'));
          const width = videoStream.width || 0;
          const height = videoStream.height || 0;
          const fps = this.parseFps(videoStream.r_frame_rate || videoStream.avg_frame_rate || '0');
          
          const stats: OptimizedVideoMetadata = {
            filename: path.basename(inputPath),
            originalName: path.basename(inputPath),
            size: 0, // Will be filled by caller
            duration,
            width,
            height,
            fps,
            bitrate: parseInt(metadata.format?.bit_rate || '0'),
            codec: videoStream.codec_name || 'unknown',
            format: path.extname(inputPath).replace('.', '').toUpperCase(),
            audioCodec: audioStream?.codec_name,
            audioChannels: audioStream?.channels,
            audioSampleRate: audioStream?.sample_rate,
            aspectRatio: this.calculateAspectRatio(width, height),
            colorSpace: videoStream.color_space,
            pixelFormat: videoStream.pix_fmt,
            hasAudio: !!audioStream,
            hasVideo: !!videoStream,
            metadata: metadata.format?.tags,
          };

          resolve(stats);
        });
      });
    });
  }

  /**
   * Generate thumbnails with batch processing and quality optimization
   */
  static async generateThumbnails(
    inputPaths: string[], 
    outputDir: string, 
    options: OptimizedThumbnailOptions = {}
  ): Promise<string[][]> {
    const {
      count = 1,
      timemarks = ['10%'],
      size = '640x360',
      filename = 'thumb_%i.jpg',
      quality = 2,
      format = 'jpg'
    } = options;

    await fs.mkdir(outputDir, { recursive: true });

    const batchPromises = inputPaths.map(inputPath => 
      this.generateThumbnail(inputPath, outputDir, {
        count,
        timemarks,
        size,
        filename: `${path.parse(inputPath).name}_${filename}`,
        quality,
        format,
      })
    );

    return Promise.all(batchPromises);
  }

  /**
   * Generate single video thumbnail with quality optimization
   */
  static async generateThumbnail(
    inputPath: string, 
    outputDir: string, 
    options: OptimizedThumbnailOptions = {}
  ): Promise<string[]> {
    const {
      count = 1,
      timemarks = ['10%'],
      size = '640x360',
      filename = 'thumb_%i.jpg',
      quality = 2,
      format = 'jpg'
    } = options;

    return this.batchProcessor.addJob(async () => {
      await fs.mkdir(outputDir, { recursive: true });

      return new Promise<string[]>((resolve, reject) => {
        const outputPaths: string[] = [];
        
        const command = ffmpeg(inputPath)
          .screenshots({
            count,
            timemarks,
            size,
            folder: outputDir,
            filename
          })
          // Add quality settings
          .outputOptions([
            `-q:v ${quality}`, // JPEG quality
            `-vf scale=${size}:flags=lanczos`, // High-quality scaling
          ]);

        if (format === 'webp') {
          command.outputOptions(['-c:v libwebp', '-quality 80']);
        } else if (format === 'png') {
          command.outputOptions(['-c:v png']);
        }

        command
          .on('filenames', (filenames) => {
            filenames.forEach(name => {
              outputPaths.push(path.join(outputDir, name));
            });
          })
          .on('end', () => {
            resolve(outputPaths);
          })
          .on('error', (err) => {
            reject(new Error(`Thumbnail generation failed: ${err.message}`));
          });
      });
    });
  }

  /**
   * Extract audio with optimized settings for transcription
   */
  static async extractAudio(
    inputPath: string, 
    outputPath: string,
    options: {
      bitrate?: number;
      sampleRate?: number;
      channels?: number;
      format?: string;
    } = {}
  ): Promise<string> {
    const {
      bitrate = 128,
      sampleRate = 16000, // Optimal for Whisper
      channels = 1, // Mono for transcription
      format = 'mp3'
    } = options;

    return this.batchProcessor.addJob(async () => {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      return new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Audio extraction timeout'));
        }, 10 * 60 * 1000); // 10 minute timeout

        ffmpeg(inputPath)
          .output(outputPath)
          .audioCodec('libmp3lame')
          .audioBitrate(bitrate)
          .audioFrequency(sampleRate)
          .audioChannels(channels)
          .noVideo()
          // Optimization flags
          .outputOptions([
            '-avoid_negative_ts make_zero',
            '-fflags +genpts',
          ])
          .on('end', () => {
            clearTimeout(timeout);
            resolve(outputPath);
          })
          .on('error', (err) => {
            clearTimeout(timeout);
            reject(new Error(`Audio extraction failed: ${err.message}`));
          })
          .on('progress', (progress) => {
            // Optional: emit progress events
            if (progress.percent) {
              console.log(`Audio extraction progress: ${progress.percent.toFixed(2)}%`);
            }
          })
          .run();
      });
    });
  }

  /**
   * Trim video with advanced optimization options
   */
  static async trimVideo(inputPath: string, options: OptimizedVideoTrimOptions): Promise<string> {
    const { 
      startTime, 
      endTime, 
      outputPath, 
      quality = 'medium',
      preset = 'fast',
      crf = 23,
      maxFileSize
    } = options;
    const duration = endTime - startTime;

    if (duration <= 0) {
      throw new Error('Invalid trim duration');
    }

    return this.batchProcessor.addJob(async () => {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      return new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Video trimming timeout'));
        }, duration * 2000 + 60000); // Duration * 2 + 1 minute buffer

        let command = ffmpeg(inputPath)
          .seekInput(startTime)
          .duration(duration)
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions([
            `-preset ${preset}`,
            `-crf ${crf}`,
            '-movflags +faststart', // Web optimization
            '-avoid_negative_ts make_zero',
            '-fflags +genpts',
          ]);

        // Apply quality-specific settings
        switch (quality) {
          case 'high':
            command = command.outputOptions(['-profile:v high', '-level 4.1']);
            break;
          case 'medium':
            command = command.outputOptions(['-profile:v main', '-level 3.1']);
            break;
          case 'low':
            command = command.outputOptions(['-profile:v baseline', '-level 3.0']);
            break;
        }

        // File size constraint
        if (maxFileSize) {
          const targetBitrate = Math.floor((maxFileSize * 8) / duration / 1000); // kbps
          command = command.videoBitrate(Math.max(100, targetBitrate * 0.8)) // Reserve 20% for audio
                          .audioBitrate(Math.min(128, targetBitrate * 0.2));
        }

        command
          .output(outputPath)
          .on('end', () => {
            clearTimeout(timeout);
            resolve(outputPath);
          })
          .on('error', (err) => {
            clearTimeout(timeout);
            reject(new Error(`Video trimming failed: ${err.message}`));
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log(`Trimming progress: ${progress.percent.toFixed(2)}%`);
            }
          })
          .run();
      });
    });
  }

  /**
   * Batch video trimming with progress tracking
   */
  static async batchTrimVideos(
    inputPath: string,
    clipSegments: Array<{ start: number; end: number; outputPath: string }>,
    options: OptimizedVideoTrimOptions & BatchProcessingOptions = {}
  ): Promise<string[]> {
    const results: string[] = [];
    let completed = 0;
    
    const trimPromises = clipSegments.map(async (segment) => {
      const result = await this.trimVideo(inputPath, {
        startTime: segment.start,
        endTime: segment.end,
        outputPath: segment.outputPath,
        ...options,
      });
      
      completed++;
      if (options.progressCallback) {
        options.progressCallback((completed / clipSegments.length) * 100, segment.outputPath);
      }
      
      return result;
    });

    const settled = await Promise.allSettled(trimPromises);
    
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        console.error(`Failed to trim segment ${index}:`, result.reason);
      }
    });

    return results;
  }

  /**
   * Convert video with platform-specific optimizations
   */
  static async optimizeForPlatform(
    inputPath: string, 
    outputPath: string, 
    platform: 'youtube' | 'tiktok' | 'instagram' | 'twitter',
    options: {
      quality?: 'high' | 'medium' | 'low';
      maxFileSize?: number;
    } = {}
  ): Promise<string> {
    const { quality = 'medium', maxFileSize } = options;
    
    const platformSettings = {
      youtube: {
        aspectRatio: '16:9',
        maxResolution: '1920x1080',
        frameRate: 30,
        videoBitrate: 5000,
        audioBitrate: 128,
      },
      tiktok: {
        aspectRatio: '9:16',
        maxResolution: '1080x1920',
        frameRate: 30,
        videoBitrate: 2500,
        audioBitrate: 128,
      },
      instagram: {
        aspectRatio: '1:1',
        maxResolution: '1080x1080',
        frameRate: 30,
        videoBitrate: 3500,
        audioBitrate: 128,
      },
      twitter: {
        aspectRatio: '16:9',
        maxResolution: '1280x720',
        frameRate: 30,
        videoBitrate: 2000,
        audioBitrate: 128,
      },
    };

    const settings = platformSettings[platform];
    
    return this.batchProcessor.addJob(async () => {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      let targetVideoBitrate = settings.videoBitrate;

      if (maxFileSize) {
        const metadata = await this.getVideoMetadata(inputPath);
        targetVideoBitrate = Math.min(
          settings.videoBitrate,
          Math.floor((maxFileSize * 8) / metadata.duration / 1000)
        );
      }

      return new Promise<string>((resolve, reject) => {
        let command = ffmpeg(inputPath)
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions([
            '-preset fast',
            `-vf scale=${settings.maxResolution}:flags=lanczos,format=yuv420p`,
            `-r ${settings.frameRate}`,
            '-movflags +faststart',
            '-avoid_negative_ts make_zero',
          ]);

        command = command
          .videoBitrate(targetVideoBitrate)
          .audioBitrate(settings.audioBitrate);

        command
          .output(outputPath)
          .on('end', () => resolve(outputPath))
          .on('error', (err) => reject(new Error(`Platform optimization failed: ${err.message}`)))
          .run();
      });
    });
  }

  /**
   * Detect silence in audio for intelligent clip boundaries
   */
  static async detectSilence(
    inputPath: string, 
    options: {
      silenceThreshold?: number;
      silenceDuration?: number;
      maxSegments?: number;
    } = {}
  ): Promise<Array<{ start: number; end: number; duration: number }>> {
    const { 
      silenceThreshold = -30, 
      silenceDuration = 0.5,
      maxSegments = 100 
    } = options;

    return this.batchProcessor.addJob(async () => {
      return new Promise<Array<{ start: number; end: number; duration: number }>>((resolve, reject) => {
        const silenceSegments: Array<{ start: number; end: number; duration: number }> = [];
        
        ffmpeg(inputPath)
          .audioFilters(`silencedetect=noise=${silenceThreshold}dB:duration=${silenceDuration}`)
          .format('null')
          .output('-')
          .on('stderr', (stderrLine) => {
            // Parse silence detection output
            const silenceStartMatch = stderrLine.match(/silence_start: ([\d.]+)/);
            const silenceEndMatch = stderrLine.match(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/);
            
            if (silenceStartMatch) {
              const start = parseFloat(silenceStartMatch[1]);
              silenceSegments.push({ start, end: 0, duration: 0 });
            } else if (silenceEndMatch && silenceSegments.length > 0) {
              const lastSegment = silenceSegments[silenceSegments.length - 1];
              lastSegment.end = parseFloat(silenceEndMatch[1]);
              lastSegment.duration = parseFloat(silenceEndMatch[2]);
            }
            
            // Limit number of segments for performance
            if (silenceSegments.length >= maxSegments) {
              reject(new Error('Too many silence segments detected'));
            }
          })
          .on('end', () => {
            resolve(silenceSegments.filter(segment => segment.end > 0));
          })
          .on('error', (err) => {
            reject(new Error(`Silence detection failed: ${err.message}`));
          })
          .run();
      });
    });
  }

  /**
   * Get video file size efficiently
   */
  static async getFileSize(filePath: string): Promise<number> {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch (error) {
      throw new Error(`Failed to get file size: ${error}`);
    }
  }

  /**
   * Validate FFmpeg installation and capabilities
   */
  static async validateInstallation(): Promise<{ 
    isValid: boolean; 
    version?: string; 
    capabilities?: string[];
    error?: string;
  }> {
    return new Promise((resolve) => {
      ffmpeg().version((err, version) => {
        if (err) {
          resolve({
            isValid: false,
            error: err.message,
          });
        } else {
          // Check for required codecs
          ffmpeg.getAvailableCodecs((err, codecs) => {
            const requiredCodecs = ['libx264', 'libmp3lame', 'aac'];
            const availableCodecs = codecs ? Object.keys(codecs) : [];
            const hasRequiredCodecs = requiredCodecs.every(codec => 
              availableCodecs.includes(codec)
            );

            resolve({
              isValid: true,
              version: version,
              capabilities: availableCodecs,
            });
          });
        }
      });
    });
  }

  /**
   * Get processing statistics
   */
  static getProcessingStats() {
    return this.batchProcessor.getStats();
  }

  /**
   * Clean up temporary files
   */
  static async cleanupTempFiles(tempDir: string, olderThanHours = 24): Promise<void> {
    try {
      const files = await fs.readdir(tempDir);
      const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
      
      for (const file of files) {
        const filePath = path.join(tempDir, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime.getTime() < cutoffTime) {
          await fs.unlink(filePath);
          console.log(`Cleaned up temp file: ${filePath}`);
        }
      }
    } catch (error) {
      console.warn(`Failed to cleanup temp files: ${error}`);
    }
  }

  /**
   * Parse frame rate from ffmpeg format
   */
  private static parseFps(frameRate: string): number {
    if (!frameRate || frameRate === '0/0') return 0;
    
    const parts = frameRate.split('/');
    if (parts.length === 2) {
      const numerator = parseFloat(parts[0]);
      const denominator = parseFloat(parts[1]);
      if (denominator !== 0) {
        return Math.round((numerator / denominator) * 100) / 100;
      }
    }
    
    return parseFloat(frameRate) || 0;
  }

  /**
   * Calculate aspect ratio string
   */
  private static calculateAspectRatio(width: number, height: number): string {
    if (!width || !height) return 'unknown';
    
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    const divisor = gcd(width, height);
    
    return `${width / divisor}:${height / divisor}`;
  }
}

// Export batch processor for external access
export { FFmpegBatchProcessor };
