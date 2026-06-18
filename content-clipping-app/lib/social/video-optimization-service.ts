import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { prisma } from '../prisma';

export interface VideoOptimizationOptions {
  targetPlatform: string;
  targetAspectRatio: '9:16' | '16:9' | '1:1' | '4:5';
  targetResolution?: string; // e.g., '1080x1920'
  targetDuration?: number; // in seconds
  targetFileSize?: number; // in bytes
  quality?: 'low' | 'medium' | 'high' | 'original';
  addWatermark?: boolean;
  watermarkText?: string;
  addSubtitles?: boolean;
  subtitlesFile?: string;
}

export interface OptimizationResult {
  success: boolean;
  outputPath?: string;
  originalSize: number;
  optimizedSize: number;
  compressionRatio: number;
  duration: number;
  resolution: string;
  error?: string;
  metadata?: {
    codec: string;
    bitrate: number;
    fps: number;
    audioCodec?: string;
    audioBitrate?: number;
  };
}

export class VideoOptimizationService {
  private tempDir: string;

  constructor() {
    this.tempDir = path.join(process.cwd(), 'temp', 'optimizations');
    this.ensureTempDirectory();
  }

  // Main optimization method
  async optimizeVideo(
    inputPath: string,
    options: VideoOptimizationOptions
  ): Promise<OptimizationResult> {
    try {
      if (!fs.existsSync(inputPath)) {
        throw new Error('Input video file does not exist');
      }

      const originalStats = fs.statSync(inputPath);
      const outputFilename = `optimized_${Date.now()}_${path.basename(inputPath)}`;
      const outputPath = path.join(this.tempDir, outputFilename);

      // Get original video metadata
      const metadata = await this.getVideoMetadata(inputPath);

      // Build FFmpeg command based on platform requirements
      const ffmpegCommand = await this.buildOptimizationCommand(
        inputPath,
        outputPath,
        options,
        metadata
      );

      // Execute optimization
      await this.executeOptimization(ffmpegCommand);

      // Verify output file exists
      if (!fs.existsSync(outputPath)) {
        throw new Error('Optimization failed - output file not created');
      }

      const optimizedStats = fs.statSync(outputPath);
      const optimizedMetadata = await this.getVideoMetadata(outputPath);

      return {
        success: true,
        outputPath,
        originalSize: originalStats.size,
        optimizedSize: optimizedStats.size,
        compressionRatio: originalStats.size / optimizedStats.size,
        duration: optimizedMetadata.duration,
        resolution: `${optimizedMetadata.width}x${optimizedMetadata.height}`,
        metadata: {
          codec: optimizedMetadata.codec,
          bitrate: optimizedMetadata.bitrate,
          fps: optimizedMetadata.fps,
          audioCodec: optimizedMetadata.audioCodec,
          audioBitrate: optimizedMetadata.audioBitrate,
        }
      };

    } catch (error) {
      return {
        success: false,
        originalSize: fs.existsSync(inputPath) ? fs.statSync(inputPath).size : 0,
        optimizedSize: 0,
        compressionRatio: 0,
        duration: 0,
        resolution: '0x0',
        error: error instanceof Error ? error.message : 'Unknown optimization error'
      };
    }
  }

  // Platform-specific optimization presets
  async optimizeForPlatform(
    inputPath: string,
    platform: string,
    contentType: 'shorts' | 'reels' | 'story' | 'post' | 'tweet' = 'post'
  ): Promise<OptimizationResult> {
    const platformOptions = this.getPlatformOptimizationOptions(platform, contentType);
    return await this.optimizeVideo(inputPath, platformOptions);
  }

  // Batch optimization for multiple platforms
  async optimizeForMultiplePlatforms(
    inputPath: string,
    platforms: string[]
  ): Promise<{ [platform: string]: OptimizationResult }> {
    const results: { [platform: string]: OptimizationResult } = {};

    for (const platform of platforms) {
      try {
        results[platform] = await this.optimizeForPlatform(inputPath, platform);
      } catch (error) {
        results[platform] = {
          success: false,
          originalSize: 0,
          optimizedSize: 0,
          compressionRatio: 0,
          duration: 0,
          resolution: '0x0',
          error: error instanceof Error ? error.message : 'Platform optimization failed'
        };
      }
    }

    return results;
  }

  private getPlatformOptimizationOptions(
    platform: string,
    contentType: string
  ): VideoOptimizationOptions {
    const presets: { [key: string]: VideoOptimizationOptions } = {
      'youtube-shorts': {
        targetPlatform: 'youtube',
        targetAspectRatio: '9:16',
        targetResolution: '1080x1920',
        targetDuration: 60,
        targetFileSize: 500 * 1024 * 1024, // 500MB
        quality: 'high',
      },
      'youtube-video': {
        targetPlatform: 'youtube',
        targetAspectRatio: '16:9',
        targetResolution: '1920x1080',
        quality: 'high',
      },
      'tiktok-video': {
        targetPlatform: 'tiktok',
        targetAspectRatio: '9:16',
        targetResolution: '1080x1920',
        targetDuration: 180,
        targetFileSize: 287 * 1024 * 1024, // 287MB
        quality: 'high',
      },
      'instagram-reels': {
        targetPlatform: 'instagram',
        targetAspectRatio: '9:16',
        targetResolution: '1080x1920',
        targetDuration: 90,
        quality: 'high',
      },
      'instagram-story': {
        targetPlatform: 'instagram',
        targetAspectRatio: '9:16',
        targetResolution: '1080x1920',
        targetDuration: 60,
        quality: 'medium',
      },
      'instagram-post': {
        targetPlatform: 'instagram',
        targetAspectRatio: '1:1',
        targetResolution: '1080x1080',
        quality: 'high',
      },
      'twitter-video': {
        targetPlatform: 'twitter',
        targetAspectRatio: '16:9',
        targetResolution: '1280x720',
        targetDuration: 140,
        targetFileSize: 512 * 1024 * 1024, // 512MB
        quality: 'medium',
      },
    };

    const key = contentType ? `${platform}-${contentType}` : platform;
    return presets[key] || presets[platform] || {
      targetPlatform: platform,
      targetAspectRatio: '16:9',
      quality: 'medium',
    };
  }

  private async buildOptimizationCommand(
    inputPath: string,
    outputPath: string,
    options: VideoOptimizationOptions,
    metadata: any
  ): Promise<ffmpeg.FfmpegCommand> {
    const command = ffmpeg(inputPath);

    // Video codec and quality settings
    const qualitySettings = this.getQualitySettings(options.quality || 'medium');
    command.videoCodec('libx264')
           .audioCodec('aac')
           .videoBitrate(qualitySettings.videoBitrate)
           .audioBitrate(qualitySettings.audioBitrate);

    // Resolution and aspect ratio
    if (options.targetResolution) {
      const [width, height] = options.targetResolution.split('x').map(Number);
      command.size(`${width}x${height}`);
    } else {
      // Calculate resolution based on aspect ratio
      const resolution = this.calculateResolutionForAspectRatio(
        options.targetAspectRatio,
        metadata
      );
      command.size(resolution);
    }

    // Duration (trim if necessary)
    if (options.targetDuration && metadata.duration > options.targetDuration) {
      command.duration(options.targetDuration);
    }

    // Frame rate optimization
    if (metadata.fps > 30) {
      command.fps(30); // Most platforms prefer 30fps or lower
    }

    // Scaling and padding for aspect ratio
    const scaleFilter = this.getScaleFilter(options.targetAspectRatio);
    if (scaleFilter) {
      command.videoFilters(scaleFilter);
    }

    // Add watermark if requested
    if (options.addWatermark && options.watermarkText) {
      const watermarkFilter = this.getWatermarkFilter(options.watermarkText);
      command.videoFilters(watermarkFilter);
    }

    // Add subtitles if requested
    if (options.addSubtitles && options.subtitlesFile) {
      command.videoFilters(`subtitles=${options.subtitlesFile}`);
    }

    // Output settings
    command.format('mp4')
           .outputOptions([
             '-movflags', '+faststart', // Optimize for streaming
             '-pix_fmt', 'yuv420p',     // Ensure compatibility
           ])
           .output(outputPath);

    return command;
  }

  private getQualitySettings(quality: string) {
    const settings = {
      low: { videoBitrate: '500k', audioBitrate: '64k' },
      medium: { videoBitrate: '1500k', audioBitrate: '128k' },
      high: { videoBitrate: '3000k', audioBitrate: '192k' },
      original: { videoBitrate: '5000k', audioBitrate: '320k' },
    };
    return settings[quality] || settings.medium;
  }

  private calculateResolutionForAspectRatio(
    aspectRatio: string,
    metadata: any
  ): string {
    const ratios = {
      '9:16': { width: 1080, height: 1920 },
      '16:9': { width: 1920, height: 1080 },
      '1:1': { width: 1080, height: 1080 },
      '4:5': { width: 1080, height: 1350 },
    };

    const target = ratios[aspectRatio] || ratios['16:9'];
    return `${target.width}x${target.height}`;
  }

  private getScaleFilter(aspectRatio: string): string {
    const ratios = {
      '9:16': 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
      '16:9': 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080',
      '1:1': 'scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080',
      '4:5': 'scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350',
    };

    return ratios[aspectRatio] || '';
  }

  private getWatermarkFilter(text: string): string {
    return `drawtext=text='${text}':x=10:y=10:fontsize=24:fontcolor=white@0.8:box=1:boxcolor=black@0.5`;
  }

  private async executeOptimization(command: ffmpeg.FfmpegCommand): Promise<void> {
    return new Promise((resolve, reject) => {
      command
        .on('end', () => resolve())
        .on('error', (error) => reject(error))
        .on('progress', (progress) => {
          console.log(`Optimization progress: ${progress.percent?.toFixed(1)}%`);
        })
        .run();
    });
  }

  private async getVideoMetadata(filePath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (error, metadata) => {
        if (error) {
          reject(error);
          return;
        }

        const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
        const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');

        resolve({
          duration: metadata.format.duration || 0,
          width: videoStream?.width || 0,
          height: videoStream?.height || 0,
          codec: videoStream?.codec_name || 'unknown',
          bitrate: parseInt(metadata.format.bit_rate || '0'),
          fps: this.parseFps(videoStream?.r_frame_rate),
          audioCodec: audioStream?.codec_name,
          audioBitrate: parseInt(audioStream?.bit_rate || '0'),
        });
      });
    });
  }

  private parseFps(frameRate?: string): number {
    if (!frameRate) return 0;
    const [num, den] = frameRate.split('/').map(Number);
    return den ? num / den : num;
  }

  private ensureTempDirectory(): void {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  // Clean up old optimization files
  async cleanupTempFiles(olderThanHours = 24): Promise<void> {
    try {
      const files = fs.readdirSync(this.tempDir);
      const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);

      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        const stats = fs.statSync(filePath);
        
        if (stats.mtime.getTime() < cutoffTime) {
          fs.unlinkSync(filePath);
          console.log(`Cleaned up old optimization file: ${file}`);
        }
      }
    } catch (error) {
      console.error('Error cleaning up temp files:', error);
    }
  }

  // Get optimization estimates before processing
  async getOptimizationEstimate(
    inputPath: string,
    options: VideoOptimizationOptions
  ): Promise<{
    estimatedSize: number;
    estimatedDuration: number;
    compressionRatio: number;
    processingTime: number; // in seconds
  }> {
    try {
      const metadata = await this.getVideoMetadata(inputPath);
      const originalSize = fs.statSync(inputPath).size;

      // Rough estimation based on target quality and duration
      const qualitySettings = this.getQualitySettings(options.quality || 'medium');
      const targetBitrate = parseInt(qualitySettings.videoBitrate.replace('k', '')) * 1000;
      
      const targetDuration = Math.min(
        metadata.duration,
        options.targetDuration || metadata.duration
      );

      const estimatedSize = (targetBitrate * targetDuration) / 8; // Convert to bytes
      const compressionRatio = originalSize / estimatedSize;
      
      // Processing time estimation (very rough)
      const processingTime = targetDuration * 0.5; // Assume 2x real-time processing

      return {
        estimatedSize: Math.round(estimatedSize),
        estimatedDuration: targetDuration,
        compressionRatio: Math.round(compressionRatio * 100) / 100,
        processingTime: Math.round(processingTime),
      };
    } catch (error) {
      return {
        estimatedSize: 0,
        estimatedDuration: 0,
        compressionRatio: 1,
        processingTime: 0,
      };
    }
  }
}