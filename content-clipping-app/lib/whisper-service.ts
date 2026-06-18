import { OpenAI } from 'openai';
import fs from 'fs/promises';
import path from 'path';

// Initialize OpenAI client for Whisper API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface TranscriptionSegment {
  id: number;
  text: string;
  start: number;
  end: number;
  confidence?: number;
  speakerLabel?: string;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  segments: TranscriptionSegment[];
  duration: number;
}

export interface TranscriptionOptions {
  language?: string;
  prompt?: string;
  temperature?: number;
  responseFormat?: 'json' | 'text' | 'verbose_json';
  timestampGranularities?: ('word' | 'segment')[];
}

export class WhisperService {
  /**
   * Transcribe audio file using OpenAI Whisper API
   */
  static async transcribeAudio(
    audioPath: string, 
    options: TranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
    try {
      // Check if file exists and get its size
      const stats = await fs.stat(audioPath);
      if (stats.size === 0) {
        throw new Error('Audio file is empty');
      }

      // Check file size limit (25MB for OpenAI Whisper)
      const maxSize = 25 * 1024 * 1024; // 25MB
      if (stats.size > maxSize) {
        throw new Error(`Audio file too large. Maximum size is ${maxSize} bytes`);
      }

      // Create file stream
      const audioFile = await fs.readFile(audioPath);
      const file = new File([audioFile], path.basename(audioPath));

      const {
        language,
        prompt,
        temperature = 0,
        responseFormat = 'verbose_json',
        timestampGranularities = ['segment']
      } = options;

      // Call OpenAI Whisper API
      const transcription = await openai.audio.transcriptions.create({
        file: file,
        model: 'whisper-1',
        language: language,
        prompt: prompt,
        temperature: temperature,
        response_format: responseFormat,
        timestamp_granularities: timestampGranularities,
      });

      // Parse response based on format
      if (responseFormat === 'verbose_json') {
        const result = transcription as any;
        
        // Convert OpenAI segments to our format
        const segments: TranscriptionSegment[] = (result.segments || []).map((segment: any, index: number) => ({
          id: index,
          text: segment.text.trim(),
          start: segment.start,
          end: segment.end,
          confidence: segment.confidence || undefined,
        }));

        return {
          text: result.text,
          language: result.language,
          segments: segments,
          duration: segments.length > 0 ? segments[segments.length - 1].end : 0
        };
      } else {
        // For text or json format, create a single segment
        const text = typeof transcription === 'string' ? transcription : (transcription as any).text;
        
        return {
          text: text,
          language: language,
          segments: [{
            id: 0,
            text: text,
            start: 0,
            end: 0, // We don't have timing info for non-verbose formats
            confidence: undefined
          }],
          duration: 0
        };
      }
    } catch (error: any) {
      if (error?.response?.data) {
        throw new Error(`Whisper API error: ${error.response.data.error?.message || error.message}`);
      }
      throw new Error(`Transcription failed: ${error.message}`);
    }
  }

  /**
   * Transcribe audio in chunks for very large files
   */
  static async transcribeAudioChunked(
    audioPath: string,
    chunkDurationSeconds: number = 300, // 5 minutes per chunk
    options: TranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
    try {
      // First, we need to split the audio file into chunks
      // This would require FFmpeg to split the audio
      const chunks = await this.splitAudioIntoChunks(audioPath, chunkDurationSeconds);
      
      const allSegments: TranscriptionSegment[] = [];
      let fullText = '';
      let currentOffset = 0;
      let detectedLanguage: string | undefined;

      for (const chunkPath of chunks) {
        try {
          const chunkResult = await this.transcribeAudio(chunkPath, options);
          
          if (!detectedLanguage && chunkResult.language) {
            detectedLanguage = chunkResult.language;
          }

          // Adjust segment timestamps to account for chunk offset
          const adjustedSegments = chunkResult.segments.map(segment => ({
            ...segment,
            id: allSegments.length + segment.id,
            start: segment.start + currentOffset,
            end: segment.end + currentOffset,
          }));

          allSegments.push(...adjustedSegments);
          fullText += (fullText ? ' ' : '') + chunkResult.text;
          
          // Update offset for next chunk
          if (adjustedSegments.length > 0) {
            currentOffset = adjustedSegments[adjustedSegments.length - 1].end;
          } else {
            currentOffset += chunkDurationSeconds;
          }

          // Clean up chunk file
          await fs.unlink(chunkPath);
        } catch (error) {
          console.error(`Failed to transcribe chunk ${chunkPath}:`, error);
          // Clean up chunk file even on error
          try {
            await fs.unlink(chunkPath);
          } catch {}
        }
      }

      return {
        text: fullText,
        language: detectedLanguage,
        segments: allSegments,
        duration: currentOffset
      };
    } catch (error) {
      throw new Error(`Chunked transcription failed: ${error}`);
    }
  }

  /**
   * Split audio file into chunks using FFmpeg
   */
  private static async splitAudioIntoChunks(
    audioPath: string,
    chunkDurationSeconds: number
  ): Promise<string[]> {
    // This would use FFmpeg to split the audio
    // For now, this is a placeholder - in a real implementation,
    // you'd use fluent-ffmpeg to split the audio file
    
    // Import ffmpeg service (avoiding circular dependency)
    const ffmpeg = require('fluent-ffmpeg');
    
    const chunks: string[] = [];
    const outputDir = path.join(path.dirname(audioPath), 'chunks');
    
    // Ensure chunks directory exists
    await fs.mkdir(outputDir, { recursive: true });

    return new Promise((resolve, reject) => {
      // Get audio duration first
      ffmpeg.ffprobe(audioPath, (err: any, metadata: any) => {
        if (err) {
          reject(err);
          return;
        }

        const duration = parseFloat(metadata.format.duration);
        const numChunks = Math.ceil(duration / chunkDurationSeconds);
        let completedChunks = 0;

        for (let i = 0; i < numChunks; i++) {
          const startTime = i * chunkDurationSeconds;
          const chunkPath = path.join(outputDir, `chunk_${i}.mp3`);
          chunks.push(chunkPath);

          ffmpeg(audioPath)
            .seekInput(startTime)
            .duration(chunkDurationSeconds)
            .output(chunkPath)
            .on('end', () => {
              completedChunks++;
              if (completedChunks === numChunks) {
                resolve(chunks);
              }
            })
            .on('error', (err: any) => {
              reject(err);
            })
            .run();
        }
      });
    });
  }

  /**
   * Find key phrases and sentences that might make good clips
   */
  static analyzeTranscriptForClips(segments: TranscriptionSegment[]): Array<{
    startTime: number;
    endTime: number;
    text: string;
    score: number;
    reason: string;
  }> {
    const potentialClips: Array<{
      startTime: number;
      endTime: number;
      text: string;
      score: number;
      reason: string;
    }> = [];

    // Keywords that often indicate interesting content
    const engagementKeywords = [
      'amazing', 'incredible', 'unbelievable', 'wow', 'shocking', 'surprising',
      'important', 'key', 'crucial', 'essential', 'critical',
      'breakthrough', 'discovery', 'secret', 'reveal', 'truth',
      'tip', 'trick', 'hack', 'method', 'technique',
      'story', 'example', 'case', 'instance'
    ];

    const questionWords = ['what', 'how', 'why', 'when', 'where', 'who'];
    const emotionWords = ['love', 'hate', 'excited', 'frustrated', 'happy', 'sad'];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const text = segment.text.toLowerCase();
      let score = 0;
      const reasons: string[] = [];

      // Score based on engagement keywords
      engagementKeywords.forEach(keyword => {
        if (text.includes(keyword)) {
          score += 2;
          reasons.push(`contains "${keyword}"`);
        }
      });

      // Score based on questions
      questionWords.forEach(word => {
        if (text.includes(word) && text.includes('?')) {
          score += 3;
          reasons.push('contains question');
        }
      });

      // Score based on emotional language
      emotionWords.forEach(word => {
        if (text.includes(word)) {
          score += 1.5;
          reasons.push('contains emotional language');
        }
      });

      // Score based on segment length (prefer medium-length segments)
      const words = text.split(' ').length;
      if (words >= 10 && words <= 50) {
        score += 1;
        reasons.push('good length');
      }

      // Score based on confidence (if available)
      if (segment.confidence && segment.confidence > 0.8) {
        score += 1;
        reasons.push('high confidence');
      }

      // Look for multi-segment clips (extend current segment with following segments)
      if (score > 2) {
        let endSegmentIndex = i;
        let clipText = segment.text;
        let clipDuration = segment.end - segment.start;

        // Try to extend the clip to include following segments (up to 30 seconds)
        while (endSegmentIndex < segments.length - 1 && clipDuration < 30) {
          const nextSegment = segments[endSegmentIndex + 1];
          const potentialDuration = nextSegment.end - segment.start;
          
          if (potentialDuration <= 30) {
            endSegmentIndex++;
            clipText += ' ' + nextSegment.text;
            clipDuration = potentialDuration;
          } else {
            break;
          }
        }

        potentialClips.push({
          startTime: Math.max(0, segment.start - 1), // Add 1 second buffer
          endTime: segments[endSegmentIndex].end + 1, // Add 1 second buffer
          text: clipText,
          score: score,
          reason: reasons.join(', ')
        });
      }
    }

    // Sort by score and return top clips
    return potentialClips
      .sort((a, b) => b.score - a.score)
      .slice(0, 10) // Return top 10 potential clips
      .filter(clip => clip.endTime - clip.startTime >= 5); // Minimum 5 seconds
  }

  /**
   * Validate Whisper API configuration
   */
  static async validateConfiguration(): Promise<boolean> {
    try {
      if (!process.env.OPENAI_API_KEY) {
        console.error('OPENAI_API_KEY environment variable is not set');
        return false;
      }

      // Test with a minimal API call
      const models = await openai.models.list();
      const whisperModel = models.data.find(model => model.id === 'whisper-1');
      
      if (!whisperModel) {
        console.error('Whisper model not available');
        return false;
      }

      console.log('Whisper service configuration validated successfully');
      return true;
    } catch (error) {
      console.error('Whisper configuration validation failed:', error);
      return false;
    }
  }
}