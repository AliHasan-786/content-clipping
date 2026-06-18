import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs/promises';
import { VideoMetadata } from './video-utils';

// Configure FFmpeg paths - these should be set based on your system
// For production, consider using environment variables
if (process.env.FFMPEG_PATH) {
  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
}
if (process.env.FFPROBE_PATH) {
  ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);
}

export interface ExtendedVideoMetadata extends VideoMetadata {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  codec: string;
  duration: number;
}

export interface ThumbnailOptions {
  count?: number;
  timemarks?: string[];
  size?: string;
  folder?: string;
  filename?: string;
}

export interface VideoTrimOptions {
  startTime: number; // in seconds
  endTime: number;   // in seconds
  outputPath: string;
}

export class FFmpegService {
  /**
   * Extract detailed video metadata using ffprobe
   */
  static async getVideoMetadata(inputPath: string): Promise<ExtendedVideoMetadata> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          reject(new Error(`Failed to extract metadata: ${err.message}`));
          return;
        }

        if (!metadata.streams || metadata.streams.length === 0) {
          reject(new Error('No video streams found'));
          return;
        }

        const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
        if (!videoStream) {
          reject(new Error('No video stream found'));
          return;
        }

        const stats = {
          filename: path.basename(inputPath),
          originalName: path.basename(inputPath),
          size: 0, // Will be filled by caller
          duration: Math.floor(parseFloat(metadata.format?.duration || '0')),
          width: videoStream.width || 0,
          height: videoStream.height || 0,
          fps: this.parseFps(videoStream.r_frame_rate || videoStream.avg_frame_rate || '0'),
          bitrate: parseInt(metadata.format?.bit_rate || '0'),
          codec: videoStream.codec_name || 'unknown',
          format: path.extname(inputPath).replace('.', '').toUpperCase()
        };

        resolve(stats);
      });
    });
  }

  /**
   * Generate thumbnail(s) from video
   */
  static async generateThumbnail(
    inputPath: string, 
    outputDir: string, 
    options: ThumbnailOptions = {}
  ): Promise<string[]> {
    const {
      count = 1,
      timemarks = ['10%'],
      size = '320x240',
      filename = 'thumb_%i.jpg'
    } = options;

    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    return new Promise((resolve, reject) => {
      const outputPaths: string[] = [];
      
      ffmpeg(inputPath)
        .screenshots({
          count,
          timemarks,
          size,
          folder: outputDir,
          filename
        })
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
  }

  /**
   * Extract audio from video
   */
  static async extractAudio(inputPath: string, outputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .output(outputPath)
        .audioCodec('libmp3lame')
        .audioBitrate(128)
        .audioFrequency(16000) // Whisper works best with 16kHz
        .audioChannels(1) // Mono for better transcription
        .noVideo()
        .on('end', () => {
          resolve(outputPath);
        })
        .on('error', (err) => {
          reject(new Error(`Audio extraction failed: ${err.message}`));
        })
        .on('progress', (progress) => {
          // Optional: emit progress events
          console.log(`Audio extraction progress: ${progress.percent}%`);
        })
        .run();
    });
  }

  /**
   * Trim video to create a clip
   */
  static async trimVideo(inputPath: string, options: VideoTrimOptions): Promise<string> {
    const { startTime, endTime, outputPath } = options;
    const duration = endTime - startTime;

    if (duration <= 0) {
      throw new Error('Invalid trim duration');
    }

    // Ensure output directory exists
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .seekInput(startTime)
        .duration(duration)
        .videoCodec('libx264')
        .audioCodec('aac')
        .output(outputPath)
        .on('end', () => {
          resolve(outputPath);
        })
        .on('error', (err) => {
          reject(new Error(`Video trimming failed: ${err.message}`));
        })
        .on('progress', (progress) => {
          console.log(`Trimming progress: ${progress.percent}%`);
        })
        .run();
    });
  }

  /**
   * Convert video format
   */
  static async convertVideo(
    inputPath: string, 
    outputPath: string, 
    options: {
      format?: string;
      quality?: string;
      size?: string;
    } = {}
  ): Promise<string> {
    const { format = 'mp4', quality = 'medium', size } = options;

    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    return new Promise((resolve, reject) => {
      let command = ffmpeg(inputPath)
        .format(format)
        .videoCodec('libx264')
        .audioCodec('aac');

      // Apply quality settings
      switch (quality) {
        case 'high':
          command = command.videoBitrate(2000).audioBitrate(128);
          break;
        case 'medium':
          command = command.videoBitrate(1000).audioBitrate(96);
          break;
        case 'low':
          command = command.videoBitrate(500).audioBitrate(64);
          break;
      }

      // Apply size if specified
      if (size) {
        command = command.size(size);
      }

      command
        .output(outputPath)
        .on('end', () => {
          resolve(outputPath);
        })
        .on('error', (err) => {
          reject(new Error(`Video conversion failed: ${err.message}`));
        })
        .on('progress', (progress) => {
          console.log(`Conversion progress: ${progress.percent}%`);
        })
        .run();
    });
  }

  /**
   * Detect silence in audio for natural cut points
   */
  static async detectSilence(
    inputPath: string, 
    options: {
      silenceThreshold?: number; // in dB
      silenceDuration?: number; // in seconds
    } = {}
  ): Promise<Array<{ start: number; end: number; duration: number }>> {
    const { silenceThreshold = -30, silenceDuration = 0.5 } = options;

    return new Promise((resolve, reject) => {
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
        })
        .on('end', () => {
          resolve(silenceSegments.filter(segment => segment.end > 0));
        })
        .on('error', (err) => {
          reject(new Error(`Silence detection failed: ${err.message}`));
        })
        .run();
    });
  }

  /**
   * Get video file size
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
   * Validate FFmpeg installation
   */
  static async validateInstallation(): Promise<boolean> {
    return new Promise((resolve) => {
      ffmpeg().version((err, version) => {
        if (err) {
          console.error('FFmpeg validation failed:', err);
          resolve(false);
        } else {
          console.log('FFmpeg version:', version);
          resolve(true);
        }
      });
    });
  }
}