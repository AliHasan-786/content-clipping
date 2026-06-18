import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';

export interface ThumbnailOptions {
  platform: string;
  width?: number;
  height?: number;
  quality?: number; // 1-100
  format?: 'jpeg' | 'png' | 'webp';
  addText?: {
    title: string;
    subtitle?: string;
    fontSize?: number;
    fontColor?: string;
    backgroundColor?: string;
    position?: 'top' | 'center' | 'bottom';
  };
  addBranding?: {
    logoPath: string;
    position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    size?: number;
    opacity?: number;
  };
  useVideoFrame?: {
    timestamp: number; // seconds
    applyFilters?: boolean;
  };
  template?: string; // Template ID for consistent branding
}

export interface ThumbnailResult {
  success: boolean;
  outputPath?: string;
  width: number;
  height: number;
  fileSize: number;
  format: string;
  error?: string;
  metadata?: {
    optimizedForPlatform: string;
    hasText: boolean;
    hasBranding: boolean;
    aspectRatio: string;
  };
}

export class ThumbnailService {
  private tempDir: string;
  private templatesDir: string;

  constructor() {
    this.tempDir = path.join(process.cwd(), 'temp', 'thumbnails');
    this.templatesDir = path.join(process.cwd(), 'assets', 'thumbnail-templates');
    this.ensureDirectories();
  }

  // Generate platform-optimized thumbnail
  async generateThumbnail(
    inputPath: string,
    options: ThumbnailOptions
  ): Promise<ThumbnailResult> {
    try {
      if (!fs.existsSync(inputPath)) {
        throw new Error('Input file does not exist');
      }

      const platformSpecs = this.getPlatformSpecifications(options.platform);
      const outputFilename = `thumbnail_${Date.now()}_${path.basename(inputPath, path.extname(inputPath))}.${options.format || platformSpecs.format}`;
      const outputPath = path.join(this.tempDir, outputFilename);

      let thumbnailBuffer: Buffer;

      // Extract frame from video if specified
      if (options.useVideoFrame && this.isVideoFile(inputPath)) {
        const frameBuffer = await this.extractVideoFrame(inputPath, options.useVideoFrame.timestamp);
        thumbnailBuffer = frameBuffer;
      } else {
        // Use image directly
        thumbnailBuffer = fs.readFileSync(inputPath);
      }

      // Process thumbnail with Sharp
      let sharpInstance = sharp(thumbnailBuffer);

      // Resize to platform specifications
      const width = options.width || platformSpecs.width;
      const height = options.height || platformSpecs.height;
      
      sharpInstance = sharpInstance.resize(width, height, {
        fit: 'cover',
        position: 'center'
      });

      // Apply quality settings
      const quality = options.quality || platformSpecs.quality;
      sharpInstance = this.applyQualitySettings(sharpInstance, options.format || platformSpecs.format, quality);

      // Add text overlay if specified
      if (options.addText) {
        sharpInstance = await this.addTextOverlay(sharpInstance, options.addText, width, height);
      }

      // Add branding if specified
      if (options.addBranding) {
        sharpInstance = await this.addBrandingOverlay(sharpInstance, options.addBranding, width, height);
      }

      // Apply template if specified
      if (options.template) {
        sharpInstance = await this.applyTemplate(sharpInstance, options.template, width, height);
      }

      // Save the thumbnail
      await sharpInstance.toFile(outputPath);

      // Get file stats
      const stats = fs.statSync(outputPath);
      const metadata = await sharp(outputPath).metadata();

      return {
        success: true,
        outputPath,
        width: metadata.width || width,
        height: metadata.height || height,
        fileSize: stats.size,
        format: metadata.format || options.format || platformSpecs.format,
        metadata: {
          optimizedForPlatform: options.platform,
          hasText: !!options.addText,
          hasBranding: !!options.addBranding,
          aspectRatio: `${width}:${height}`
        }
      };

    } catch (error) {
      return {
        success: false,
        width: 0,
        height: 0,
        fileSize: 0,
        format: 'unknown',
        error: error instanceof Error ? error.message : 'Thumbnail generation failed'
      };
    }
  }

  // Generate multiple thumbnails for A/B testing
  async generateThumbnailVariations(
    inputPath: string,
    basePlatform: string,
    variationCount = 3
  ): Promise<ThumbnailResult[]> {
    const results: ThumbnailResult[] = [];
    const baseSpecs = this.getPlatformSpecifications(basePlatform);

    // Generate base thumbnail
    const baseOptions: ThumbnailOptions = {
      platform: basePlatform
    };

    if (this.isVideoFile(inputPath)) {
      baseOptions.useVideoFrame = { timestamp: 2 }; // Use frame at 2 seconds
    }

    const baseThumbnail = await this.generateThumbnail(inputPath, baseOptions);
    results.push(baseThumbnail);

    // Generate variations with different styles
    const variations: Partial<ThumbnailOptions>[] = [
      {
        addText: {
          title: 'Watch Now!',
          position: 'center',
          fontSize: 48,
          fontColor: '#FFFFFF',
          backgroundColor: 'rgba(0,0,0,0.7)'
        }
      },
      {
        useVideoFrame: { timestamp: 5 }, // Different timestamp
        addText: {
          title: 'New Video',
          position: 'bottom',
          fontSize: 36,
          fontColor: '#FF0000'
        }
      },
      {
        useVideoFrame: { timestamp: 10 },
        addBranding: {
          logoPath: path.join(process.cwd(), 'assets', 'logo.png'),
          position: 'bottom-right',
          size: 80,
          opacity: 0.8
        }
      }
    ];

    for (let i = 0; i < Math.min(variationCount - 1, variations.length); i++) {
      const variationOptions: ThumbnailOptions = {
        ...baseOptions,
        ...variations[i]
      };

      const variation = await this.generateThumbnail(inputPath, variationOptions);
      results.push(variation);
    }

    return results;
  }

  // Generate thumbnails for all platforms
  async generateForAllPlatforms(inputPath: string): Promise<{ [platform: string]: ThumbnailResult }> {
    const platforms = ['youtube', 'tiktok', 'instagram', 'twitter'];
    const results: { [platform: string]: ThumbnailResult } = {};

    for (const platform of platforms) {
      const options: ThumbnailOptions = {
        platform,
        useVideoFrame: this.isVideoFile(inputPath) ? { timestamp: 3 } : undefined
      };

      results[platform] = await this.generateThumbnail(inputPath, options);
    }

    return results;
  }

  // Extract multiple frames from video for thumbnail selection
  async extractVideoFrames(
    videoPath: string,
    frameCount = 5
  ): Promise<{ timestamp: number; framePath: string }[]> {
    try {
      const videoMetadata = await this.getVideoMetadata(videoPath);
      const duration = videoMetadata.duration;
      const frames: { timestamp: number; framePath: string }[] = [];

      // Calculate frame timestamps evenly distributed
      const interval = duration / (frameCount + 1);

      for (let i = 1; i <= frameCount; i++) {
        const timestamp = interval * i;
        const framePath = await this.extractVideoFrame(videoPath, timestamp, true);
        frames.push({ timestamp, framePath });
      }

      return frames;

    } catch (error) {
      console.error('Error extracting video frames:', error);
      return [];
    }
  }

  // Analyze thumbnail effectiveness (simplified)
  async analyzeThumbnailQuality(thumbnailPath: string): Promise<{
    score: number; // 0-100
    issues: string[];
    suggestions: string[];
  }> {
    try {
      const metadata = await sharp(thumbnailPath).metadata();
      const stats = fs.statSync(thumbnailPath);
      
      let score = 100;
      const issues: string[] = [];
      const suggestions: string[] = [];

      // Check resolution
      if (!metadata.width || !metadata.height) {
        issues.push('Invalid image dimensions');
        score -= 30;
      } else {
        if (metadata.width < 1280 || metadata.height < 720) {
          issues.push('Low resolution (recommended: at least 1280x720)');
          suggestions.push('Use higher resolution source material');
          score -= 20;
        }
      }

      // Check file size
      if (stats.size > 2 * 1024 * 1024) { // 2MB
        issues.push('Large file size (>2MB)');
        suggestions.push('Optimize image compression');
        score -= 10;
      } else if (stats.size < 50 * 1024) { // 50KB
        issues.push('Very small file size might indicate low quality');
        score -= 5;
      }

      // Check aspect ratio
      if (metadata.width && metadata.height) {
        const aspectRatio = metadata.width / metadata.height;
        if (aspectRatio < 1.5 || aspectRatio > 2.0) {
          issues.push('Non-standard aspect ratio for most platforms');
          suggestions.push('Consider 16:9 aspect ratio for better compatibility');
          score -= 15;
        }
      }

      // Check format
      if (metadata.format !== 'jpeg' && metadata.format !== 'png') {
        issues.push('Uncommon image format');
        suggestions.push('Use JPEG or PNG format');
        score -= 5;
      }

      return {
        score: Math.max(0, score),
        issues,
        suggestions
      };

    } catch (error) {
      return {
        score: 0,
        issues: ['Failed to analyze thumbnail'],
        suggestions: ['Ensure thumbnail is a valid image file']
      };
    }
  }

  private getPlatformSpecifications(platform: string) {
    const specs = {
      youtube: {
        width: 1280,
        height: 720,
        format: 'jpeg' as const,
        quality: 90,
        maxSize: 2 * 1024 * 1024, // 2MB
        aspectRatio: 16/9
      },
      tiktok: {
        width: 1080,
        height: 1920,
        format: 'jpeg' as const,
        quality: 85,
        maxSize: 1 * 1024 * 1024, // 1MB
        aspectRatio: 9/16
      },
      instagram: {
        width: 1080,
        height: 1080,
        format: 'jpeg' as const,
        quality: 85,
        maxSize: 1 * 1024 * 1024, // 1MB
        aspectRatio: 1
      },
      twitter: {
        width: 1200,
        height: 675,
        format: 'jpeg' as const,
        quality: 80,
        maxSize: 5 * 1024 * 1024, // 5MB
        aspectRatio: 16/9
      }
    };

    return specs[platform] || specs.youtube;
  }

  private async extractVideoFrame(
    videoPath: string,
    timestamp: number,
    saveToFile = false
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const outputPath = saveToFile 
        ? path.join(this.tempDir, `frame_${Date.now()}_${timestamp}.png`)
        : path.join(this.tempDir, `temp_frame_${Date.now()}.png`);

      ffmpeg(videoPath)
        .seekInput(timestamp)
        .frames(1)
        .output(outputPath)
        .on('end', () => resolve(outputPath))
        .on('error', reject)
        .run();
    });
  }

  private async getVideoMetadata(videoPath: string): Promise<{ duration: number }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (error, metadata) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({
          duration: metadata.format.duration || 0
        });
      });
    });
  }

  private applyQualitySettings(
    sharpInstance: sharp.Sharp,
    format: string,
    quality: number
  ): sharp.Sharp {
    switch (format) {
      case 'jpeg':
        return sharpInstance.jpeg({ quality, progressive: true });
      case 'png':
        return sharpInstance.png({ compressionLevel: 9 });
      case 'webp':
        return sharpInstance.webp({ quality });
      default:
        return sharpInstance.jpeg({ quality });
    }
  }

  private async addTextOverlay(
    sharpInstance: sharp.Sharp,
    textOptions: NonNullable<ThumbnailOptions['addText']>,
    width: number,
    height: number
  ): Promise<sharp.Sharp> {
    const fontSize = textOptions.fontSize || 48;
    const fontColor = textOptions.fontColor || '#FFFFFF';
    const backgroundColor = textOptions.backgroundColor || 'rgba(0,0,0,0.7)';

    // Create SVG text overlay
    const textSvg = this.createTextSvg(
      textOptions.title,
      textOptions.subtitle,
      fontSize,
      fontColor,
      backgroundColor,
      textOptions.position || 'center',
      width,
      height
    );

    const textBuffer = Buffer.from(textSvg);

    return sharpInstance.composite([{
      input: textBuffer,
      top: 0,
      left: 0
    }]);
  }

  private createTextSvg(
    title: string,
    subtitle?: string,
    fontSize = 48,
    fontColor = '#FFFFFF',
    backgroundColor = 'rgba(0,0,0,0.7)',
    position = 'center',
    width = 1280,
    height = 720
  ): string {
    const titleY = position === 'top' ? fontSize + 20 : 
                   position === 'bottom' ? height - 60 : 
                   height / 2 - (subtitle ? fontSize / 2 : 0);
    
    const subtitleY = titleY + fontSize + 10;

    return `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="2" dy="2" stdDeviation="3" flood-color="black" flood-opacity="0.7"/>
          </filter>
        </defs>
        
        ${backgroundColor !== 'transparent' ? `
          <rect x="0" y="${titleY - fontSize - 10}" width="${width}" height="${fontSize * (subtitle ? 2.5 : 1.5)}" 
                fill="${backgroundColor}" opacity="0.8"/>
        ` : ''}
        
        <text x="${width / 2}" y="${titleY}" 
              font-family="Arial, sans-serif" 
              font-size="${fontSize}px" 
              font-weight="bold"
              fill="${fontColor}" 
              text-anchor="middle" 
              filter="url(#shadow)">
          ${title}
        </text>
        
        ${subtitle ? `
          <text x="${width / 2}" y="${subtitleY}" 
                font-family="Arial, sans-serif" 
                font-size="${fontSize * 0.6}px" 
                fill="${fontColor}" 
                text-anchor="middle" 
                filter="url(#shadow)">
            ${subtitle}
          </text>
        ` : ''}
      </svg>
    `;
  }

  private async addBrandingOverlay(
    sharpInstance: sharp.Sharp,
    brandingOptions: NonNullable<ThumbnailOptions['addBranding']>,
    width: number,
    height: number
  ): Promise<sharp.Sharp> {
    try {
      if (!fs.existsSync(brandingOptions.logoPath)) {
        console.warn('Logo file not found:', brandingOptions.logoPath);
        return sharpInstance;
      }

      const logoSize = brandingOptions.size || 100;
      const opacity = brandingOptions.opacity || 1.0;
      const position = brandingOptions.position || 'bottom-right';

      // Calculate position coordinates
      const { left, top } = this.calculateOverlayPosition(position, logoSize, width, height);

      // Process logo
      const logoBuffer = await sharp(brandingOptions.logoPath)
        .resize(logoSize, logoSize, { fit: 'inside', withoutEnlargement: true })
        .png() // Ensure transparency support
        .toBuffer();

      return sharpInstance.composite([{
        input: logoBuffer,
        left,
        top,
        blend: 'over'
      }]);

    } catch (error) {
      console.error('Error adding branding overlay:', error);
      return sharpInstance;
    }
  }

  private calculateOverlayPosition(
    position: string,
    size: number,
    width: number,
    height: number
  ): { left: number; top: number } {
    const margin = 20;

    switch (position) {
      case 'top-left':
        return { left: margin, top: margin };
      case 'top-right':
        return { left: width - size - margin, top: margin };
      case 'bottom-left':
        return { left: margin, top: height - size - margin };
      case 'bottom-right':
        return { left: width - size - margin, top: height - size - margin };
      default:
        return { left: width - size - margin, top: height - size - margin };
    }
  }

  private async applyTemplate(
    sharpInstance: sharp.Sharp,
    templateId: string,
    width: number,
    height: number
  ): Promise<sharp.Sharp> {
    try {
      const templatePath = path.join(this.templatesDir, `${templateId}.png`);
      
      if (!fs.existsSync(templatePath)) {
        console.warn('Template not found:', templatePath);
        return sharpInstance;
      }

      const templateBuffer = await sharp(templatePath)
        .resize(width, height)
        .png()
        .toBuffer();

      return sharpInstance.composite([{
        input: templateBuffer,
        blend: 'overlay'
      }]);

    } catch (error) {
      console.error('Error applying template:', error);
      return sharpInstance;
    }
  }

  private isVideoFile(filePath: string): boolean {
    const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];
    const ext = path.extname(filePath).toLowerCase();
    return videoExtensions.includes(ext);
  }

  private ensureDirectories(): void {
    [this.tempDir, this.templatesDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  // Clean up old thumbnail files
  async cleanupTempFiles(olderThanHours = 24): Promise<void> {
    try {
      const files = fs.readdirSync(this.tempDir);
      const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);

      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        const stats = fs.statSync(filePath);
        
        if (stats.mtime.getTime() < cutoffTime) {
          fs.unlinkSync(filePath);
          console.log(`Cleaned up old thumbnail file: ${file}`);
        }
      }
    } catch (error) {
      console.error('Error cleaning up temp files:', error);
    }
  }
}