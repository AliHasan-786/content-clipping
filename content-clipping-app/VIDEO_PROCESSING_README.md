# Video Processing Pipeline

This document describes the complete video processing pipeline implementation for the content clipping application.

## Overview

The video processing pipeline automatically processes uploaded videos to generate short clips suitable for social media sharing. The entire process typically takes 2-3 minutes and includes:

1. **Metadata Extraction** - Video properties, duration, resolution
2. **Thumbnail Generation** - Preview images from key frames
3. **Audio Extraction** - High-quality audio for transcription
4. **Speech Transcription** - AI-powered speech-to-text with timestamps
5. **Intelligent Clip Detection** - Algorithm identifies engaging moments
6. **Clip Generation** - Creates multiple clip suggestions

## Architecture

### Core Services

- **FFmpegService** (`lib/ffmpeg-service.ts`) - Video processing operations
- **WhisperService** (`lib/whisper-service.ts`) - Audio transcription via OpenAI
- **ClipDetectionService** (`lib/clip-detection-service.ts`) - Intelligent clip identification
- **JobQueueManager** (`lib/job-queue.ts`) - Background processing system

### API Endpoints

- `POST /api/process` - Start video processing
- `GET /api/process?videoId=xxx` - Get processing status
- `POST /api/transcribe` - Manual transcription trigger
- `GET /api/transcribe?videoId=xxx` - Get transcription
- `POST /api/clips/generate` - Generate clips
- `GET /api/clips/generate?videoId=xxx` - Get generated clips
- `POST /api/clips/export` - Export clip as video file

### UI Components

- **ProcessingStatus** - Real-time processing progress
- **ClipsPreview** - Generated clips with approval workflow
- **ProcessingDashboard** - Complete processing interface

## Setup Requirements

### 1. System Dependencies

Install FFmpeg:
```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt update && sudo apt install ffmpeg

# Windows
# Download from https://ffmpeg.org/download.html
```

Install Redis:
```bash
# macOS
brew install redis
brew services start redis

# Ubuntu/Debian
sudo apt install redis-server
sudo systemctl start redis-server
```

### 2. Environment Variables

Copy `.env.example` to `.env.local` and configure:

```bash
# Required for transcription
OPENAI_API_KEY="your-openai-api-key"

# Required for job queue
REDIS_HOST="localhost"
REDIS_PORT="6379"

# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/db"

# Optional FFmpeg paths
FFMPEG_PATH="/usr/local/bin/ffmpeg"
FFPROBE_PATH="/usr/local/bin/ffprobe"
```

### 3. Database Schema

Run Prisma migrations:
```bash
npm run db:generate
npm run db:push
# or
npm run db:migrate
```

### 4. Install Dependencies

```bash
npm install
```

## Usage

### Automatic Processing

By default, videos are automatically processed upon upload:

1. User uploads video via `/upload`
2. Video is saved and processing starts immediately
3. Progress can be tracked at `/processing/[videoId]`
4. Clips are available when processing completes

### Manual Processing

To disable automatic processing, set `autoProcess = false` in `/api/upload/route.ts`:

1. Upload video (remains in UPLOADING status)
2. Navigate to `/processing/[videoId]`
3. Click "Start Processing" button
4. Monitor progress through the dashboard

### Processing Stages

1. **UPLOADED** - Video file saved, ready to process
2. **EXTRACTING_METADATA** - Analyzing video properties
3. **GENERATING_THUMBNAIL** - Creating preview image
4. **EXTRACTING_AUDIO** - Preparing audio for transcription
5. **TRANSCRIBING** - Converting speech to text with timestamps
6. **DETECTING_CLIPS** - Analyzing transcript for interesting moments
7. **GENERATING_CLIPS** - Creating clip suggestions
8. **COMPLETED** - Processing finished successfully

## Clip Detection Algorithm

The intelligent clip detection algorithm analyzes transcriptions to identify engaging content:

### Content Analysis
- **Engagement Keywords** - "amazing", "incredible", "breakthrough", etc.
- **Question Patterns** - Questions and Q&A segments
- **Emotional Language** - Strong emotional expressions
- **Tutorial Content** - How-to and instructional segments
- **Story Elements** - Narrative and anecdotal content

### Technical Features
- **Silence Detection** - Natural cut points for clean clips
- **Optimal Length** - Prefers 15-30 second clips
- **Quality Scoring** - Rates potential clips 0-5
- **Context Awareness** - Considers surrounding content
- **Confidence Scoring** - Based on transcription accuracy

### Configurable Options
```typescript
{
  minClipDuration: 5,      // Minimum seconds
  maxClipDuration: 60,     // Maximum seconds  
  maxClips: 10,           // Maximum clips to generate
  scoreThreshold: 2.5,    // Minimum quality score
  silenceThreshold: -30,  // dB for silence detection
  silenceDuration: 0.8    // Seconds of silence required
}
```

## Job Queue System

Uses Redis-backed Bull queues for reliable background processing:

### Queue Types
- **Video Processing** - Main processing pipeline
- **Transcription** - Audio-to-text conversion
- **Clip Generation** - Clip detection and creation

### Features
- **Retry Logic** - Automatic retries on failure
- **Progress Tracking** - Real-time status updates  
- **Job Prioritization** - High priority for new uploads
- **Error Handling** - Comprehensive error reporting
- **Graceful Shutdown** - Clean queue termination

### Monitoring
```typescript
// Get queue statistics
const stats = await JobQueueManager.getQueueStats();

// Retry failed jobs
await JobQueueManager.retryFailedJobs();

// Clear failed jobs
await JobQueueManager.clearFailedJobs();
```

## Performance Optimization

### Processing Speed
- **Parallel Processing** - Multiple stages run concurrently where possible
- **Optimized Audio** - 16kHz mono for faster transcription
- **Chunked Processing** - Large files processed in segments
- **Caching** - Metadata and thumbnails cached after generation

### Resource Management
- **Job Limits** - Configurable concurrent job limits
- **Memory Management** - Automatic cleanup of temporary files
- **Queue Management** - Failed job cleanup and retry policies
- **Progress Tracking** - Efficient database updates

### Scalability
- **Horizontal Scaling** - Multiple worker processes supported
- **Load Balancing** - Redis queue distributes work
- **Storage Optimization** - Configurable file retention policies

## Error Handling

### Common Issues
1. **FFmpeg Not Found** - Install FFmpeg and set PATH
2. **OpenAI API Errors** - Check API key and quota
3. **Redis Connection** - Ensure Redis is running
4. **Large Files** - May require chunked processing
5. **Unsupported Formats** - Convert to MP4/MOV/WebM

### Debugging
- Check browser network tab for API errors
- Monitor server logs for processing errors
- Use `/api/process?videoId=xxx` to check status
- Verify environment variables are set

### Recovery
- Processing can be restarted from any stage
- Failed jobs automatically retry with backoff
- Manual retry available through dashboard
- Database maintains processing state

## API Documentation

### Start Processing
```typescript
POST /api/process
{
  "videoId": "video_id_here"
}
```

### Check Status
```typescript
GET /api/process?videoId=video_id_here
```

### Generate Clips
```typescript
POST /api/clips/generate
{
  "videoId": "video_id_here",
  "options": {
    "maxClips": 10,
    "scoreThreshold": 3.0
  }
}
```

### Export Clip
```typescript
POST /api/clips/export
{
  "clipId": "clip_id_here",
  "format": "mp4",
  "quality": "medium"
}
```

## Development

### Running the Pipeline

1. Start Redis: `redis-server`
2. Start development server: `npm run dev`
3. Upload a video via the UI
4. Monitor processing at `/processing/[videoId]`

### Testing

Test with short video files (< 1 minute) for faster development cycles.

### Extending

- Add new content analysis patterns in `ClipDetectionService`
- Implement additional export formats in `FFmpegService`
- Add custom processing stages in job queue
- Create specialized UI components for specific use cases

## Production Considerations

### Security
- Validate all file uploads
- Sanitize filenames and paths
- Implement proper authentication
- Rate limit API endpoints

### Performance
- Use CDN for video/thumbnail serving
- Implement database connection pooling
- Monitor job queue performance
- Set up logging and metrics

### Scalability
- Consider cloud transcription services
- Implement distributed file storage
- Use managed Redis service
- Add horizontal scaling for workers

## Troubleshooting

### Processing Stuck
1. Check Redis connection
2. Verify FFmpeg installation  
3. Check OpenAI API quota
4. Monitor server resources

### Poor Clip Quality
1. Adjust detection thresholds
2. Review transcription accuracy
3. Test with different content types
4. Fine-tune algorithm parameters

### Performance Issues
1. Monitor job queue length
2. Check server resources
3. Optimize database queries
4. Consider parallel processing

## Support

For issues or questions:
1. Check the error logs
2. Verify environment setup
3. Review API responses
4. Test with sample videos