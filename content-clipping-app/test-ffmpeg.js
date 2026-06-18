#!/usr/bin/env node

/**
 * Video Processing Dependencies Verification Script
 * This script tests all required dependencies for video processing functionality
 */

const ffmpeg = require('fluent-ffmpeg');
const Redis = require('ioredis');
const path = require('path');
const fs = require('fs');

// Import our services to test them
let FFmpegService, WhisperService, JobQueueManager;
try {
  FFmpegService = require('./lib/ffmpeg-service').FFmpegService;
  WhisperService = require('./lib/whisper-service').WhisperService;
  JobQueueManager = require('./lib/job-queue').JobQueueManager;
} catch (error) {
  console.error('❌ Failed to import services:', error.message);
}

async function testFFmpegInstallation() {
  console.log('🔍 Testing FFmpeg installation...\n');

  try {
    // Test 1: Check FFmpeg version
    console.log('Test 1: Checking FFmpeg version...');
    const version = await new Promise((resolve, reject) => {
      ffmpeg().version((err, version) => {
        if (err) {
          reject(err);
        } else {
          resolve(version);
        }
      });
    });
    console.log('✅ FFmpeg version detected');
    console.log(`   Version: ${version.ffmpeg_version || 'Unknown'}`);
    console.log(`   Copyright: ${version.copyright || 'N/A'}`);
    console.log('✅ FFmpeg installation confirmed!\n');

    // Test 2: Check available formats
    console.log('Test 2: Checking available formats...');
    const formats = await new Promise((resolve, reject) => {
      ffmpeg.getAvailableFormats((err, formats) => {
        if (err) {
          reject(err);
        } else {
          resolve(formats);
        }
      });
    });
    console.log('✅ Available formats:', Object.keys(formats).length, 'formats found');
    console.log('   - MP4 support:', formats.mp4 ? '✅' : '❌');
    console.log('   - WebM support:', formats.webm ? '✅' : '❌');
    console.log('   - AVI support:', formats.avi ? '✅' : '❌');
    console.log('   - MOV support:', formats.mov ? '✅' : '❌');

    // Test 3: Check available codecs
    console.log('\nTest 3: Checking available codecs...');
    const codecs = await new Promise((resolve, reject) => {
      ffmpeg.getAvailableCodecs((err, codecs) => {
        if (err) {
          reject(err);
        } else {
          resolve(codecs);
        }
      });
    });
    console.log('✅ Available codecs:', Object.keys(codecs).length, 'codecs found');
    console.log('   - H.264 (libx264):', codecs.libx264 ? '✅' : '❌');
    console.log('   - H.265 (libx265):', codecs.libx265 ? '✅' : '❌');
    console.log('   - AAC audio:', codecs.aac ? '✅' : '❌');
    console.log('   - MP3 (libmp3lame):', codecs.libmp3lame ? '✅' : '❌');

    // Test 4: Test our FFmpegService
    if (FFmpegService) {
      console.log('\nTest 4: Testing FFmpegService validation...');
      try {
        const isValid = await FFmpegService.validateInstallation();
        if (isValid) {
          console.log('✅ FFmpegService validation passed');
        } else {
          console.log('❌ FFmpegService validation failed');
        }
      } catch (error) {
        console.log('❌ FFmpegService validation error:', error.message);
      }
    }

    return true;

  } catch (error) {
    console.error('❌ FFmpeg installation test failed:');
    console.error('Error:', error.message);
    
    if (error.message.includes('ffmpeg was killed with signal SIGKILL')) {
      console.log('\n💡 Troubleshooting tips:');
      console.log('1. FFmpeg might not be installed. Install it using:');
      console.log('   - macOS: brew install ffmpeg');
      console.log('   - Linux: sudo apt install ffmpeg (Ubuntu/Debian) or sudo yum install ffmpeg (CentOS/RHEL)');
      console.log('   - Windows: Download from https://ffmpeg.org/download.html');
    } else if (error.message.includes('spawn ffmpeg ENOENT')) {
      console.log('\n💡 FFmpeg not found in PATH. Try:');
      console.log('1. Install FFmpeg using your package manager');
      console.log('2. Set FFMPEG_PATH environment variable to the FFmpeg binary location');
      console.log('3. Verify installation with: ffmpeg -version');
    }

    return false;
  }
}

async function testRedisConnection() {
  console.log('\n🔍 Testing Redis connection...\n');

  const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    retryDelayOnFailover: 100,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 3,
    connectTimeout: 5000,
  };

  let redis;
  try {
    console.log('Test 1: Connecting to Redis...');
    console.log(`   Host: ${redisConfig.host}:${redisConfig.port}`);
    
    redis = new Redis(redisConfig);
    
    // Wait for connection
    await new Promise((resolve, reject) => {
      redis.on('connect', () => resolve());
      redis.on('error', (err) => reject(err));
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });
    
    console.log('✅ Redis connection established');

    // Test basic operations
    console.log('\nTest 2: Testing basic Redis operations...');
    await redis.set('test-key', 'test-value', 'EX', 10);
    const value = await redis.get('test-key');
    if (value === 'test-value') {
      console.log('✅ Redis read/write operations working');
    } else {
      console.log('❌ Redis read/write test failed');
    }

    // Test job queue functionality
    if (JobQueueManager) {
      console.log('\nTest 3: Testing job queue stats...');
      try {
        const stats = await JobQueueManager.getQueueStats();
        console.log('✅ Job queue stats retrieved:');
        console.log(`   Video queue: ${JSON.stringify(stats.video)}`);
        console.log(`   Transcription queue: ${JSON.stringify(stats.transcription)}`);
        console.log(`   Clips queue: ${JSON.stringify(stats.clips)}`);
      } catch (error) {
        console.log('❌ Job queue stats failed:', error.message);
      }
    }

    await redis.disconnect();
    return true;

  } catch (error) {
    console.error('❌ Redis connection test failed:');
    console.error('Error:', error.message);
    
    console.log('\n💡 Troubleshooting tips:');
    console.log('1. Install Redis:');
    console.log('   - macOS: brew install redis && brew services start redis');
    console.log('   - Linux: sudo apt install redis-server (Ubuntu/Debian)');
    console.log('   - Windows: Download from https://redis.io/download');
    console.log('2. Start Redis server: redis-server');
    console.log('3. Test connection: redis-cli ping');
    console.log('4. Check if Redis is running: ps aux | grep redis');
    
    if (redis) {
      try {
        await redis.disconnect();
      } catch {}
    }
    return false;
  }
}

async function testWhisperService() {
  console.log('\n🔍 Testing Whisper/OpenAI configuration...\n');

  try {
    if (!process.env.OPENAI_API_KEY) {
      console.log('❌ OPENAI_API_KEY environment variable not set');
      console.log('\n💡 Set up OpenAI API:');
      console.log('1. Get an API key from https://platform.openai.com/api-keys');
      console.log('2. Set environment variable: export OPENAI_API_KEY=your-key-here');
      console.log('3. Or add to .env.local file: OPENAI_API_KEY=your-key-here');
      return false;
    }

    console.log('Test 1: Checking OpenAI API key...');
    console.log('✅ OPENAI_API_KEY is set');

    if (WhisperService) {
      console.log('\nTest 2: Validating Whisper service configuration...');
      try {
        const isValid = await WhisperService.validateConfiguration();
        if (isValid) {
          console.log('✅ Whisper service configuration validated');
        } else {
          console.log('❌ Whisper service configuration failed');
        }
      } catch (error) {
        console.log('❌ Whisper validation error:', error.message);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('❌ Whisper service test failed:', error.message);
    return false;
  }
}

async function testDirectoryStructure() {
  console.log('\n🔍 Testing directory structure...\n');

  const requiredDirs = [
    'public/uploads',
    'public/uploads/thumbnails',
    'temp',
    'temp/audio',
  ];

  let allGood = true;

  for (const dir of requiredDirs) {
    const fullPath = path.join(process.cwd(), dir);
    try {
      if (!fs.existsSync(fullPath)) {
        console.log(`📁 Creating directory: ${dir}`);
        fs.mkdirSync(fullPath, { recursive: true });
      }
      console.log(`✅ Directory exists: ${dir}`);
    } catch (error) {
      console.log(`❌ Failed to create directory ${dir}:`, error.message);
      allGood = false;
    }
  }

  return allGood;
}

async function testNodeModules() {
  console.log('\n🔍 Testing required npm packages...\n');

  const requiredPackages = {
    'fluent-ffmpeg': '2.1.3',
    'bull': '4.16.5',
    'ioredis': '5.4.1',
    'node-cron': '3.0.3',
    'whisper-node': '1.2.0',
    'openai': '4.80.0',
    '@prisma/client': '7.8.0',
  };

  let allGood = true;

  for (const [packageName, expectedVersion] of Object.entries(requiredPackages)) {
    try {
      const packagePath = path.join(process.cwd(), 'node_modules', packageName, 'package.json');
      if (fs.existsSync(packagePath)) {
        const packageInfo = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        console.log(`✅ ${packageName}@${packageInfo.version} (expected: ${expectedVersion})`);
      } else {
        console.log(`❌ ${packageName} not installed`);
        allGood = false;
      }
    } catch (error) {
      console.log(`❌ Error checking ${packageName}:`, error.message);
      allGood = false;
    }
  }

  return allGood;
}

async function runAllTests() {
  console.log('🚀 Starting video processing dependencies verification...\n');
  console.log('=' .repeat(60));

  const testResults = {
    nodeModules: false,
    directoryStructure: false,
    ffmpeg: false,
    redis: false,
    whisper: false,
  };

  try {
    // Test 1: Node modules
    testResults.nodeModules = await testNodeModules();
    
    // Test 2: Directory structure
    testResults.directoryStructure = await testDirectoryStructure();
    
    // Test 3: FFmpeg
    testResults.ffmpeg = await testFFmpegInstallation();
    
    // Test 4: Redis
    testResults.redis = await testRedisConnection();
    
    // Test 5: Whisper/OpenAI
    testResults.whisper = await testWhisperService();

  } catch (error) {
    console.error('❌ Unexpected error during testing:', error);
  }

  // Summary
  console.log('\n' + '=' .repeat(60));
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('=' .repeat(60));
  
  const allTests = Object.entries(testResults);
  const passedTests = allTests.filter(([name, passed]) => passed);
  const failedTests = allTests.filter(([name, passed]) => !passed);

  console.log(`✅ Passed: ${passedTests.length}/${allTests.length} tests`);
  if (passedTests.length > 0) {
    passedTests.forEach(([name]) => {
      console.log(`   ✅ ${name}`);
    });
  }

  if (failedTests.length > 0) {
    console.log(`\n❌ Failed: ${failedTests.length}/${allTests.length} tests`);
    failedTests.forEach(([name]) => {
      console.log(`   ❌ ${name}`);
    });
  }

  console.log('\n' + '=' .repeat(60));
  
  if (failedTests.length === 0) {
    console.log('🎉 ALL TESTS PASSED! Your system is ready for video processing.');
    console.log('\n📝 Next steps:');
    console.log('1. Start your development server: npm run dev');
    console.log('2. Upload a video to test the processing pipeline');
    console.log('3. Monitor the processing in the dashboard');
  } else {
    console.log('⚠️  SOME TESTS FAILED. Please fix the issues above before proceeding.');
    console.log('\n📝 Installation commands summary:');
    console.log('- Install FFmpeg: brew install ffmpeg (macOS) or see above');
    console.log('- Install Redis: brew install redis && brew services start redis (macOS)');
    console.log('- Set OpenAI API key: export OPENAI_API_KEY=your-key-here');
    console.log('- Install missing packages: npm install');
  }

  console.log('\n🔧 For more help, run: npm run help:video-processing');
  
  return failedTests.length === 0;
}

// Run all tests
runAllTests()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });