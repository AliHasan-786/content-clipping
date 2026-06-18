export interface VideoMetadata {
  filename: string
  originalName: string
  size: number
  duration?: number
  width?: number
  height?: number
  fps?: number
  bitrate?: number
  format?: string
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot).toLowerCase() : ''
}

function getBasename(filename: string, extension?: string): string {
  const normalized = filename.replace(/\\/g, '/')
  const name = normalized.slice(normalized.lastIndexOf('/') + 1)
  return extension && name.endsWith(extension) ? name.slice(0, -extension.length) : name
}

/**
 * Get video metadata from a file
 * Note: This is a basic implementation. In production, you might want to use
 * a library like ffprobe or node-ffmpeg for more detailed metadata extraction
 */
export async function getVideoMetadata(filePath: string): Promise<VideoMetadata> {
  try {
    const { promises: fs } = await import('fs')
    const stats = await fs.stat(filePath)
    const filename = getBasename(filePath)
    const extension = getExtension(filePath)
    
    // Basic metadata that we can get without external tools
    const metadata: VideoMetadata = {
      filename,
      originalName: filename,
      size: stats.size,
      format: extension.replace('.', '').toUpperCase()
    }

    // For more detailed metadata, you would typically use ffprobe or similar
    // This is a placeholder that could be extended with actual video analysis
    metadata.duration = await estimateVideoDuration(filePath, stats.size)
    
    return metadata
  } catch (error) {
    throw new Error(`Failed to get video metadata: ${error}`)
  }
}

/**
 * Estimate video duration based on file size and format
 * This is a rough estimation - in production, use ffprobe for accurate results
 */
async function estimateVideoDuration(filePath: string, fileSize: number): Promise<number> {
  // Very rough estimation based on typical bitrates
  // MP4: ~1-8 Mbps, MOV: ~2-10 Mbps, AVI: ~1-5 Mbps
  const extension = getExtension(filePath)
  
  let estimatedBitrateMbps: number
  switch (extension) {
    case '.mp4':
      estimatedBitrateMbps = 4 // 4 Mbps average
      break
    case '.mov':
      estimatedBitrateMbps = 6 // 6 Mbps average
      break
    case '.avi':
      estimatedBitrateMbps = 3 // 3 Mbps average
      break
    case '.webm':
      estimatedBitrateMbps = 2 // 2 Mbps average
      break
    default:
      estimatedBitrateMbps = 4 // Default 4 Mbps
  }
  
  const fileSizeMb = fileSize / (1024 * 1024)
  const estimatedDurationSeconds = (fileSizeMb * 8) / estimatedBitrateMbps
  
  return Math.round(estimatedDurationSeconds)
}

/**
 * Validate video file format
 */
export function isValidVideoFormat(filename: string): boolean {
  const extension = getExtension(filename)
  const validExtensions = ['.mp4', '.mov', '.avi', '.webm', '.wmv', '.3gp', '.flv', '.mkv']
  return validExtensions.includes(extension)
}

/**
 * Generate a safe filename for storage
 */
export function generateSafeFilename(originalName: string): string {
  const timestamp = Date.now()
  const randomId = Math.random().toString(36).substring(2, 8)
  const extension = getExtension(originalName)
  const baseName = getBasename(originalName, extension)
  
  // Remove special characters and spaces
  const safeName = baseName
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 50) // Limit length
  
  return `${safeName}_${timestamp}_${randomId}${extension}`
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * Format duration in seconds to human-readable string
 */
export function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) {
    return '0:00'
  }
  
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
  }
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

/**
 * Parse duration string (HH:MM:SS or MM:SS) to seconds
 */
export function parseDuration(durationString: string): number {
  if (!durationString) return 0
  
  const parts = durationString.split(':').map(Number)
  
  if (parts.length === 2) {
    // MM:SS format
    return parts[0] * 60 + parts[1]
  } else if (parts.length === 3) {
    // HH:MM:SS format
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
  }
  
  return 0
}

/**
 * Validate video upload constraints
 */
export function validateVideoFile(file: File): { valid: boolean; error?: string } {
  // Check file type
  if (!isValidVideoFormat(file.name)) {
    return {
      valid: false,
      error: 'Invalid video format. Supported formats: MP4, MOV, AVI, WebM, WMV, 3GP, FLV, MKV'
    }
  }

  // Check file size (500MB limit)
  const maxSize = 500 * 1024 * 1024 // 500MB
  if (file.size > maxSize) {
    return {
      valid: false,
      error: `File size too large. Maximum size is ${formatFileSize(maxSize)}`
    }
  }

  // Check minimum file size (1KB)
  const minSize = 1024 // 1KB
  if (file.size < minSize) {
    return {
      valid: false,
      error: 'File size too small. Minimum size is 1KB'
    }
  }

  return { valid: true }
}

/**
 * Get video aspect ratio string
 */
export function getAspectRatio(width?: number, height?: number): string {
  if (!width || !height) return 'Unknown'
  
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b)
  const divisor = gcd(width, height)
  
  const ratioW = width / divisor
  const ratioH = height / divisor
  
  // Common aspect ratios
  if (ratioW === 16 && ratioH === 9) return '16:9'
  if (ratioW === 4 && ratioH === 3) return '4:3'
  if (ratioW === 21 && ratioH === 9) return '21:9'
  if (ratioW === 1 && ratioH === 1) return '1:1'
  
  return `${ratioW}:${ratioH}`
}

/**
 * Format video resolution for display
 */
export function formatResolution(width?: number, height?: number): string {
  if (!width || !height) return 'Unknown'
  
  // Common resolution names
  if (width === 1920 && height === 1080) return '1080p (Full HD)'
  if (width === 1280 && height === 720) return '720p (HD)'
  if (width === 3840 && height === 2160) return '4K (Ultra HD)'
  if (width === 2560 && height === 1440) return '1440p (2K)'
  if (width === 640 && height === 480) return '480p (SD)'
  
  return `${width}×${height}`
}

/**
 * Create upload directory if it doesn't exist
 */
export async function ensureUploadDirectory(): Promise<string> {
  const { promises: fs } = await import('fs')
  const uploadDir = `${process.cwd()}/public/uploads`
  
  try {
    await fs.access(uploadDir)
  } catch {
    await fs.mkdir(uploadDir, { recursive: true })
  }
  
  return uploadDir
}

/**
 * Generate thumbnail placeholder path
 * In a real implementation, you'd extract a frame from the video
 */
export function generateThumbnailPath(filename: string): string {
  const baseName = getBasename(filename, getExtension(filename))
  return `/uploads/thumbnails/${baseName}_thumb.jpg`
}
