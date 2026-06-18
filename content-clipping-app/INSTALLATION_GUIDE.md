# Video Processing Dependencies Installation Guide

This guide will help you install and configure all dependencies required for the video processing functionality in the Content Clipping App.

## Quick Start (Automated Installation)

### 1. Run the Setup Script

```bash
npm run setup
```

This will automatically install FFmpeg and Redis on macOS and most Linux distributions.

### 2. Verify Installation

```bash
npm run test:dependencies
```

This will test all dependencies and show you what's working and what needs attention.

### 3. Configure Environment

Edit `.env.local` and add your OpenAI API key:

```env
OPENAI_API_KEY=your-actual-api-key-here
```

## Manual Installation

If the automated setup doesn't work for your system, follow these manual steps:

### Prerequisites

- **Node.js** (18.x or higher)
- **npm** or **yarn**
- **Git**

### 1. Install FFmpeg

FFmpeg is required for video processing, audio extraction, and thumbnail generation.

#### macOS
```bash
# Using Homebrew (recommended)
brew install ffmpeg

# Verify installation
ffmpeg -version
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install ffmpeg

# Verify installation
ffmpeg -version
```

#### Linux (CentOS/RHEL/Fedora)
```bash
# Enable EPEL repository
sudo dnf install epel-release  # Fedora/newer CentOS
# OR
sudo yum install epel-release  # Older CentOS

# Install FFmpeg
sudo dnf install ffmpeg ffmpeg-devel  # Fedora/newer CentOS
# OR  
sudo yum install ffmpeg ffmpeg-devel  # Older CentOS

# Verify installation
ffmpeg -version
```

#### Windows
1. Download FFmpeg from [https://ffmpeg.org/download.html](https://ffmpeg.org/download.html)
2. Extract to `C:\ffmpeg`
3. Add `C:\ffmpeg\bin` to your PATH environment variable
4. Restart your terminal and verify: `ffmpeg -version`

### 2. Install Redis

Redis is used for job queuing and background processing.

#### macOS
```bash
# Using Homebrew
brew install redis

# Start Redis service
brew services start redis

# Verify installation
redis-cli ping
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install redis-server

# Start and enable Redis
sudo systemctl start redis
sudo systemctl enable redis

# Verify installation
redis-cli ping
```

#### Linux (CentOS/RHEL/Fedora)
```bash
sudo dnf install redis  # Fedora/newer CentOS
# OR
sudo yum install redis  # Older CentOS

# Start and enable Redis
sudo systemctl start redis
sudo systemctl enable redis

# Verify installation
redis-cli ping
```

#### Windows
Option 1: Use Windows Subsystem for Linux (WSL)
Option 2: Use Docker:
```bash
docker run -d -p 6379:6379 --name redis redis:alpine
```

### 3. Install Node.js Dependencies

```bash
npm install
```

### 4. Set Up Environment Variables

Create a `.env.local` file in the project root:

```env
# OpenAI API Configuration (Required)
OPENAI_API_KEY=your-openai-api-key-here

# Database Configuration
DATABASE_URL="file:./dev.db"

# Redis Configuration (Optional - defaults to localhost:6379)
REDIS_HOST=localhost
REDIS_PORT=6379
# REDIS_PASSWORD=your-redis-password-if-needed

# NextAuth Configuration
NEXTAUTH_SECRET=your-nextauth-secret-here
NEXTAUTH_URL=http://localhost:3000

# FFmpeg Configuration (Optional - only if FFmpeg is not in PATH)
# FFMPEG_PATH=/usr/local/bin/ffmpeg
# FFPROBE_PATH=/usr/local/bin/ffprobe
```

### 5. Set Up Database

```bash
npm run db:generate
npm run db:push
```

## Verification

### Test All Dependencies

```bash
npm run test:dependencies
```

This will run a comprehensive test that checks:
- ✅ Required npm packages
- ✅ Directory structure
- ✅ FFmpeg installation and capabilities
- ✅ Redis connection and operations
- ✅ OpenAI API key and Whisper service

### Manual Verification Commands

```bash
# Test FFmpeg
ffmpeg -version
ffmpeg -formats | grep mp4
ffmpeg -codecs | grep x264

# Test Redis
redis-cli ping
redis-cli info server

# Test Node.js packages
node -e "console.log(require('fluent-ffmpeg'))"
node -e "console.log(require('bull'))"
```

## Troubleshooting

### FFmpeg Issues

**Error: `spawn ffmpeg ENOENT`**
- FFmpeg is not installed or not in PATH
- Install FFmpeg using the instructions above
- Or set `FFMPEG_PATH` in your `.env.local`

**Error: `ffmpeg was killed with signal SIGKILL`**
- FFmpeg crashed, usually due to missing codecs
- Reinstall FFmpeg with all codecs: `brew install ffmpeg --with-all`

### Redis Issues

**Error: `Redis connection failed`**
- Redis is not running
- Start Redis: `brew services start redis` (macOS) or `sudo systemctl start redis` (Linux)

**Error: `Connection timeout`**
- Check if Redis is listening: `netstat -an | grep 6379`
- Check Redis configuration: `redis-cli config get "*"`

### OpenAI/Whisper Issues

**Error: `OPENAI_API_KEY environment variable not set`**
- Get an API key from [OpenAI Platform](https://platform.openai.com/api-keys)
- Add it to your `.env.local` file

**Error: `Whisper model not available`**
- Check your API key is valid and has sufficient credits
- Verify access to Whisper API in your OpenAI dashboard

### Permission Issues

**Error: `EACCES: permission denied`**
- Make sure the setup script is executable: `chmod +x setup-dependencies.sh`
- Check directory permissions for uploads: `chmod 755 public/uploads`

## Required Dependencies Summary

### System Dependencies
- **FFmpeg**: Video processing, audio extraction, thumbnail generation
- **Redis**: Job queuing, background processing
- **Node.js**: Runtime environment

### npm Packages (Already in package.json)
- `fluent-ffmpeg@2.1.3`: FFmpeg wrapper
- `bull@4.16.5`: Redis-based job queue
- `ioredis@5.4.1`: Redis client
- `node-cron@3.0.3`: Scheduled tasks
- `whisper-node@1.2.0`: Whisper client (alternative)
- `openai@4.80.0`: OpenAI API client
- `@prisma/client@7.8.0`: Database ORM

### Environment Variables
- `OPENAI_API_KEY`: Required for transcription
- `REDIS_HOST`, `REDIS_PORT`: Redis connection (optional)
- `FFMPEG_PATH`, `FFPROBE_PATH`: FFmpeg paths (optional)

## Getting Help

If you encounter issues:

1. **Run the diagnostic script**: `npm run test:dependencies`
2. **Check the logs**: Look for error messages in the console
3. **Verify versions**: Make sure you have the latest versions
4. **Check system requirements**: Ensure your OS is supported

### Support Commands

```bash
# Get help
npm run help:video-processing

# Test specific components
npm run test:ffmpeg
ffmpeg -version
redis-cli ping

# Check service status (Linux)
sudo systemctl status redis

# Check service status (macOS)
brew services list | grep redis
```

## Next Steps

After successful installation:

1. **Start the development server**: `npm run dev`
2. **Upload a test video**: Use the web interface to test video processing
3. **Monitor processing**: Check the processing dashboard for progress
4. **Review clips**: Examine generated clips and transcriptions

The application will automatically:
- Extract video metadata
- Generate thumbnails
- Extract audio for transcription
- Transcribe using OpenAI Whisper
- Detect potential clips using AI analysis
- Queue all operations using Redis

Enjoy your video processing capabilities! 🎬✨