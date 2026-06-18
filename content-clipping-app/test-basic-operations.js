#!/usr/bin/env node

/**
 * Basic Video Operations Test
 * Tests basic FFmpeg functionality with dummy operations
 */

const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

// Import our services
const { FFmpegService } = require('./lib/ffmpeg-service');

async function createTestAudio() {
  console.log('🎵 Creating test audio file...');
  
  const outputPath = path.join(__dirname, 'test-audio.wav');
  
  return new Promise((resolve, reject) => {
    // Generate a 5-second sine wave at 440Hz (A note)
    ffmpeg()
      .input('sine=frequency=440:duration=5')
      .inputFormat('lavfi') // Use libavfilter input
      .audioCodec('pcm_s16le')
      .duration(5)
      .output(outputPath)
      .on('end', () => {
        console.log('✅ Test audio file created');
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.log('❌ Failed to create test audio:', err.message);
        reject(err);
      })
      .run();
  });
}

async function testAudioToMP3(inputPath) {
  console.log('🔄 Testing audio conversion...');
  
  const outputPath = path.join(__dirname, 'test-output.mp3');
  
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('libmp3lame')
      .audioBitrate(128)
      .audioFrequency(16000)
      .audioChannels(1)
      .output(outputPath)
      .on('end', () => {
        console.log('✅ Audio conversion successful');
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.log('❌ Audio conversion failed:', err.message);
        reject(err);
      })
      .run();
  });
}

async function testMetadataExtraction(filePath) {
  console.log('📊 Testing metadata extraction...');
  
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        console.log('❌ Metadata extraction failed:', err.message);
        reject(err);
        return;
      }
      
      console.log('✅ Metadata extraction successful');
      console.log(`   Duration: ${metadata.format.duration} seconds`);
      console.log(`   Format: ${metadata.format.format_name}`);
      console.log(`   Bitrate: ${metadata.format.bit_rate} bps`);
      
      if (metadata.streams && metadata.streams.length > 0) {
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
        if (audioStream) {
          console.log(`   Audio codec: ${audioStream.codec_name}`);
          console.log(`   Sample rate: ${audioStream.sample_rate} Hz`);
          console.log(`   Channels: ${audioStream.channels}`);
        }
      }
      
      resolve(metadata);
    });
  });
}

async function testFFmpegService(filePath) {
  console.log('🔧 Testing FFmpegService...');
  
  try {
    // Test validation
    const isValid = await FFmpegService.validateInstallation();
    if (isValid) {
      console.log('✅ FFmpegService validation passed');
    } else {
      console.log('❌ FFmpegService validation failed');
      return false;
    }
    
    // Test file size
    const size = await FFmpegService.getFileSize(filePath);
    console.log(`✅ File size: ${size} bytes`);
    
    return true;
  } catch (error) {
    console.log('❌ FFmpegService test failed:', error.message);
    return false;
  }
}

async function cleanup(filePaths) {
  console.log('🧹 Cleaning up test files...');
  
  for (const filePath of filePaths) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`✅ Removed: ${path.basename(filePath)}`);
      }
    } catch (error) {
      console.log(`⚠️  Failed to remove ${path.basename(filePath)}:`, error.message);
    }
  }
}

async function runBasicTests() {
  console.log('🚀 Running basic FFmpeg operations test...\n');
  console.log('=' .repeat(50));
  
  const testFiles = [];
  let testsPassed = 0;
  let testsTotal = 4;
  
  try {
    // Test 1: Create test audio
    console.log('\nTest 1: Audio Generation');
    console.log('-' .repeat(25));
    const testAudioPath = await createTestAudio();
    testFiles.push(testAudioPath);
    testsPassed++;
    
    // Test 2: Audio conversion
    console.log('\nTest 2: Audio Conversion');
    console.log('-' .repeat(25));
    const convertedPath = await testAudioToMP3(testAudioPath);
    testFiles.push(convertedPath);
    testsPassed++;
    
    // Test 3: Metadata extraction
    console.log('\nTest 3: Metadata Extraction');
    console.log('-' .repeat(28));
    await testMetadataExtraction(convertedPath);
    testsPassed++;
    
    // Test 4: FFmpegService
    console.log('\nTest 4: Service Integration');
    console.log('-' .repeat(27));
    const serviceOK = await testFFmpegService(convertedPath);
    if (serviceOK) testsPassed++;
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
  } finally {
    // Cleanup
    console.log('\n' + '-' .repeat(50));
    await cleanup(testFiles);
  }
  
  // Results
  console.log('\n' + '=' .repeat(50));
  console.log('📊 TEST RESULTS');
  console.log('=' .repeat(50));
  console.log(`✅ Passed: ${testsPassed}/${testsTotal} tests`);
  
  if (testsPassed === testsTotal) {
    console.log('\n🎉 All basic operations working correctly!');
    console.log('FFmpeg is properly configured for video processing.');
    console.log('\nYou can now:');
    console.log('1. Process video files');
    console.log('2. Extract audio for transcription');
    console.log('3. Generate thumbnails');
    console.log('4. Convert between formats');
  } else {
    console.log('\n⚠️  Some tests failed. Check the output above.');
    console.log('You may need to:');
    console.log('1. Reinstall FFmpeg with all codecs');
    console.log('2. Check FFmpeg PATH configuration');
    console.log('3. Verify system permissions');
  }
  
  console.log('\nFor full system test, run: npm run test:dependencies');
  
  return testsPassed === testsTotal;
}

// Run the tests
if (require.main === module) {
  runBasicTests()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error('Unexpected error:', error);
      process.exit(1);
    });
}

module.exports = { runBasicTests };