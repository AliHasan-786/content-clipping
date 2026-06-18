import { TranscriptionSegment } from './whisper-service';
import { FFmpegService } from './ffmpeg-service';

export interface DetectedClip {
  startTime: number;
  endTime: number;
  duration: number;
  title: string;
  description: string;
  text: string;
  score: number;
  confidence: number;
  reason: string;
  tags: string[];
}

export interface SilenceSegment {
  start: number;
  end: number;
  duration: number;
}

export interface ClipDetectionOptions {
  minClipDuration?: number; // seconds
  maxClipDuration?: number; // seconds
  maxClips?: number;
  silenceThreshold?: number; // dB
  silenceDuration?: number; // seconds
  scoreThreshold?: number;
}

export class ClipDetectionService {
  private static readonly DEFAULT_OPTIONS: ClipDetectionOptions = {
    minClipDuration: 5,
    maxClipDuration: 60,
    maxClips: 10,
    silenceThreshold: -30,
    silenceDuration: 0.8,
    scoreThreshold: 3.0
  };

  /**
   * Main method to detect and generate clips from video and transcription
   */
  static async detectClips(
    videoPath: string,
    transcriptionSegments: TranscriptionSegment[],
    options: ClipDetectionOptions = {}
  ): Promise<DetectedClip[]> {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };

    try {
      // Step 1: Analyze transcript for content-based clips
      const contentClips = this.analyzeTranscriptContent(transcriptionSegments, opts);

      // Step 2: Detect silence for natural cut points
      const silenceSegments = await this.detectSilenceSegments(videoPath, opts);

      // Step 3: Combine content analysis with silence detection
      const optimizedClips = this.optimizeClipBoundaries(contentClips, silenceSegments);

      // Step 4: Score and rank clips
      const scoredClips = this.scoreClips(optimizedClips, transcriptionSegments);

      // Step 5: Filter and sort by quality
      const finalClips = scoredClips
        .filter(clip => clip.score >= opts.scoreThreshold! && clip.duration >= opts.minClipDuration!)
        .sort((a, b) => b.score - a.score)
        .slice(0, opts.maxClips);

      return finalClips;
    } catch (error) {
      throw new Error(`Clip detection failed: ${error}`);
    }
  }

  /**
   * Analyze transcript content to find potential clips
   */
  private static analyzeTranscriptContent(
    segments: TranscriptionSegment[],
    options: ClipDetectionOptions
  ): DetectedClip[] {
    const potentialClips: DetectedClip[] = [];

    // High-value keywords and phrases
    const engagementKeywords = {
      high: ['breakthrough', 'revolutionary', 'game-changer', 'incredible', 'unbelievable', 'shocking', 'mind-blowing'],
      medium: ['amazing', 'important', 'key', 'crucial', 'essential', 'significant', 'powerful'],
      low: ['interesting', 'good', 'nice', 'cool', 'useful', 'helpful']
    };

    const contentTypes = {
      tutorial: ['how to', 'step by step', 'first', 'then', 'next', 'finally', 'tutorial', 'guide'],
      story: ['story', 'once', 'happened', 'experience', 'remember', 'tell you about'],
      insight: ['realize', 'understand', 'learned', 'discovery', 'insight', 'truth', 'secret'],
      question: ['what', 'why', 'how', 'when', 'where', 'who', 'question'],
      emotional: ['love', 'hate', 'excited', 'frustrated', 'happy', 'sad', 'angry', 'surprised']
    };

    for (let i = 0; i < segments.length; i++) {
      const windowSegments = this.getSegmentWindow(segments, i, options.maxClipDuration! / 2);
      const combinedText = windowSegments.map(s => s.text).join(' ').toLowerCase();
      
      let score = 0;
      let reasons: string[] = [];
      let tags: string[] = [];
      let contentType = 'general';

      // Score engagement keywords
      Object.entries(engagementKeywords).forEach(([level, keywords]) => {
        const multiplier = level === 'high' ? 3 : level === 'medium' ? 2 : 1;
        keywords.forEach(keyword => {
          if (combinedText.includes(keyword)) {
            score += multiplier;
            reasons.push(`${level} engagement: "${keyword}"`);
          }
        });
      });

      // Identify content type and add type-specific scoring
      Object.entries(contentTypes).forEach(([type, keywords]) => {
        const matches = keywords.filter(keyword => combinedText.includes(keyword));
        if (matches.length > 0) {
          score += matches.length * 1.5;
          tags.push(type);
          contentType = type;
          reasons.push(`${type} content`);
        }
      });

      // Score based on questions
      if (combinedText.includes('?')) {
        score += 2;
        reasons.push('contains question');
        tags.push('q&a');
      }

      // Score based on dialogue patterns
      if (this.hasDialoguePattern(combinedText)) {
        score += 1.5;
        reasons.push('dialogue pattern');
        tags.push('conversation');
      }

      // Score based on text complexity and length
      const words = combinedText.split(' ').length;
      if (words >= 15 && words <= 100) {
        score += 1;
        reasons.push('optimal length');
      }

      // Score based on segment confidence
      const avgConfidence = windowSegments.reduce((sum, s) => sum + (s.confidence || 0.8), 0) / windowSegments.length;
      if (avgConfidence > 0.85) {
        score += 1;
        reasons.push('high transcription confidence');
      }

      // Create clip if score is sufficient
      if (score > 1.5) {
        const startTime = Math.max(0, windowSegments[0].start - 1);
        const endTime = windowSegments[windowSegments.length - 1].end + 1;
        const duration = endTime - startTime;

        if (duration >= options.minClipDuration! && duration <= options.maxClipDuration!) {
          potentialClips.push({
            startTime,
            endTime,
            duration,
            title: this.generateClipTitle(combinedText, contentType),
            description: this.generateClipDescription(combinedText, contentType),
            text: windowSegments.map(s => s.text).join(' ').trim(),
            score,
            confidence: avgConfidence,
            reason: reasons.join(', '),
            tags: [...new Set(tags)] // Remove duplicates
          });
        }
      }
    }

    // Merge overlapping clips and remove duplicates
    return this.mergeOverlappingClips(potentialClips);
  }

  /**
   * Detect silence segments for natural cut points
   */
  private static async detectSilenceSegments(
    videoPath: string,
    options: ClipDetectionOptions
  ): Promise<SilenceSegment[]> {
    try {
      return await FFmpegService.detectSilence(videoPath, {
        silenceThreshold: options.silenceThreshold,
        silenceDuration: options.silenceDuration
      });
    } catch (error) {
      console.warn('Silence detection failed, using empty array:', error);
      return [];
    }
  }

  /**
   * Optimize clip boundaries using silence detection
   */
  private static optimizeClipBoundaries(
    clips: DetectedClip[],
    silenceSegments: SilenceSegment[]
  ): DetectedClip[] {
    return clips.map(clip => {
      // Find silence segments near the clip boundaries
      const startSilence = this.findNearestSilence(clip.startTime, silenceSegments, 3);
      const endSilence = this.findNearestSilence(clip.endTime, silenceSegments, 3);

      let optimizedStart = clip.startTime;
      let optimizedEnd = clip.endTime;

      // Adjust start time to silence boundary if beneficial
      if (startSilence && Math.abs(startSilence.start - clip.startTime) < 3) {
        optimizedStart = startSilence.end;
      }

      // Adjust end time to silence boundary if beneficial
      if (endSilence && Math.abs(endSilence.start - clip.endTime) < 3) {
        optimizedEnd = endSilence.start;
      }

      return {
        ...clip,
        startTime: optimizedStart,
        endTime: optimizedEnd,
        duration: optimizedEnd - optimizedStart
      };
    });
  }

  /**
   * Score clips based on various factors
   */
  private static scoreClips(clips: DetectedClip[], segments: TranscriptionSegment[]): DetectedClip[] {
    return clips.map(clip => {
      let finalScore = clip.score;

      // Bonus for optimal duration (15-30 seconds)
      if (clip.duration >= 15 && clip.duration <= 30) {
        finalScore += 2;
      } else if (clip.duration >= 10 && clip.duration <= 45) {
        finalScore += 1;
      }

      // Bonus for clips at the beginning (more likely to be introductions/hooks)
      if (clip.startTime < 60) {
        finalScore += 1.5;
      }

      // Penalty for clips that are too similar to others
      const similarity = clips.filter(other => 
        other !== clip && this.calculateTextSimilarity(clip.text, other.text) > 0.7
      ).length;
      finalScore -= similarity * 0.5;

      return {
        ...clip,
        score: Math.max(0, finalScore)
      };
    });
  }

  /**
   * Helper methods
   */
  private static getSegmentWindow(
    segments: TranscriptionSegment[],
    centerIndex: number,
    maxDuration: number
  ): TranscriptionSegment[] {
    const result = [segments[centerIndex]];
    let currentDuration = segments[centerIndex].end - segments[centerIndex].start;

    // Expand backwards
    let backIndex = centerIndex - 1;
    while (backIndex >= 0 && currentDuration < maxDuration) {
      const segment = segments[backIndex];
      const newDuration = segments[centerIndex].end - segment.start;
      if (newDuration <= maxDuration) {
        result.unshift(segment);
        currentDuration = newDuration;
        backIndex--;
      } else {
        break;
      }
    }

    // Expand forwards
    let forwardIndex = centerIndex + 1;
    while (forwardIndex < segments.length && currentDuration < maxDuration) {
      const segment = segments[forwardIndex];
      const newDuration = segment.end - segments[centerIndex].start;
      if (newDuration <= maxDuration) {
        result.push(segment);
        currentDuration = newDuration;
        forwardIndex++;
      } else {
        break;
      }
    }

    return result;
  }

  private static hasDialoguePattern(text: string): boolean {
    const dialogueIndicators = [
      'he said', 'she said', 'they said', 'i said', 'you said',
      'asking', 'answered', 'replied', 'responded', 'told',
      'conversation', 'discussion', 'talk about'
    ];
    return dialogueIndicators.some(indicator => text.includes(indicator));
  }

  private static generateClipTitle(text: string, contentType: string): string {
    const words = text.split(' ').slice(0, 8);
    let title = words.join(' ');
    
    if (title.length > 50) {
      title = title.substring(0, 47) + '...';
    }

    // Add content type prefix for context
    const prefixes: Record<string, string> = {
      tutorial: 'How to:',
      story: 'Story:',
      insight: 'Insight:',
      question: 'Q&A:',
      emotional: 'Moment:'
    };

    if (prefixes[contentType]) {
      return `${prefixes[contentType]} ${title}`;
    }

    return title || 'Interesting Moment';
  }

  private static generateClipDescription(text: string, contentType: string): string {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    if (sentences.length === 0) return text.substring(0, 200) + '...';

    const firstSentence = sentences[0].trim();
    return firstSentence.length > 200 
      ? firstSentence.substring(0, 197) + '...'
      : firstSentence;
  }

  private static findNearestSilence(
    time: number,
    silenceSegments: SilenceSegment[],
    maxDistance: number
  ): SilenceSegment | null {
    let nearest: SilenceSegment | null = null;
    let minDistance = maxDistance;

    for (const silence of silenceSegments) {
      const startDistance = Math.abs(silence.start - time);
      const endDistance = Math.abs(silence.end - time);
      const distance = Math.min(startDistance, endDistance);

      if (distance < minDistance) {
        minDistance = distance;
        nearest = silence;
      }
    }

    return nearest;
  }

  private static mergeOverlappingClips(clips: DetectedClip[]): DetectedClip[] {
    if (clips.length <= 1) return clips;

    const sortedClips = clips.sort((a, b) => a.startTime - b.startTime);
    const merged: DetectedClip[] = [];

    for (const clip of sortedClips) {
      const lastMerged = merged[merged.length - 1];

      if (!lastMerged || clip.startTime > lastMerged.endTime + 2) {
        // No overlap, add as new clip
        merged.push(clip);
      } else if (clip.score > lastMerged.score) {
        // Overlapping clip with higher score, replace
        merged[merged.length - 1] = {
          ...clip,
          startTime: Math.min(clip.startTime, lastMerged.startTime),
          endTime: Math.max(clip.endTime, lastMerged.endTime),
          text: clip.text.length > lastMerged.text.length ? clip.text : lastMerged.text
        };
      }
      // Otherwise ignore the overlapping clip with lower score
    }

    return merged;
  }

  private static calculateTextSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(' '));
    const words2 = new Set(text2.toLowerCase().split(' '));
    
    const intersection = new Set([...words1].filter(word => words2.has(word)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }
}