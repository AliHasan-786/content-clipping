import { prisma } from './prisma';
import { FFmpegService } from './ffmpeg-service';
import { 
  ChatAction, 
  ChatActionType, 
  ChatContext,
  Video,
  Clip,
  ClipCreateData 
} from '../types';

export interface ActionExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  contextUpdate?: Partial<ChatContext>;
}

export class ChatActionExecutor {
  private ffmpegService: FFmpegService;

  constructor() {
    this.ffmpegService = new FFmpegService();
  }

  /**
   * Execute a chat action
   */
  async executeAction(
    action: ChatAction,
    context: ChatContext,
    userId: string
  ): Promise<ActionExecutionResult> {
    try {
      console.log(`Executing action: ${action.type}`, action.parameters);

      switch (action.type) {
        case 'find_clips':
          return await this.findClips(action.parameters, context);
        
        case 'generate_clips':
          return await this.generateClips(action.parameters, context, userId);
        
        case 'edit_clip':
          return await this.editClip(action.parameters, context);
        
        case 'export_clips':
          return await this.exportClips(action.parameters, context);
        
        case 'analyze_video':
          return await this.analyzeVideo(action.parameters, context);
        
        case 'suggest_improvements':
          return await this.suggestImprovements(action.parameters, context);
        
        case 'create_highlights':
          return await this.createHighlights(action.parameters, context);
        
        case 'adjust_captions':
          return await this.adjustCaptions(action.parameters, context);
        
        case 'change_format':
          return await this.changeFormat(action.parameters, context);
        
        default:
          return {
            success: false,
            error: `Unknown action type: ${action.type}`
          };
      }
    } catch (error) {
      console.error('Error executing action:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Find clips based on criteria
   */
  private async findClips(
    parameters: any,
    context: ChatContext
  ): Promise<ActionExecutionResult> {
    if (!context.currentVideo) {
      return {
        success: false,
        error: 'No video selected. Please select a video first.'
      };
    }

    const { criteria, minScore = 0.5, limit = 10 } = parameters;
    
    try {
      const clips = await prisma.clip.findMany({
        where: {
          videoId: context.currentVideo.id,
          ...(minScore && { score: { gte: minScore } })
        },
        orderBy: { score: 'desc' },
        take: limit
      });

      // Filter clips based on criteria
      let filteredClips = clips;
      if (criteria) {
        const searchTerms = criteria.toLowerCase().split(' ');
        filteredClips = clips.filter(clip => {
          const searchText = `${clip.title} ${clip.description} ${clip.reason}`.toLowerCase();
          return searchTerms.some(term => searchText.includes(term));
        });
      }

      return {
        success: true,
        result: {
          clips: filteredClips,
          total: filteredClips.length,
          criteria: criteria
        },
        contextUpdate: {
          selectedClips: filteredClips.map(c => c.id)
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to find clips: ${error.message}`
      };
    }
  }

  /**
   * Generate new clips from video
   */
  private async generateClips(
    parameters: any,
    context: ChatContext,
    userId: string
  ): Promise<ActionExecutionResult> {
    if (!context.currentVideo) {
      return {
        success: false,
        error: 'No video selected. Please select a video first.'
      };
    }

    const { 
      count = 5, 
      minDuration = 30, 
      maxDuration = 60, 
      focusArea = 'engaging' 
    } = parameters;

    try {
      // Get video with transcription for clip detection
      const video = await prisma.video.findUnique({
        where: { id: context.currentVideo.id },
        include: {
          transcription: {
            include: { segments: true }
          }
        }
      });

      if (!video) {
        return {
          success: false,
          error: 'Video not found'
        };
      }

      // Generate clips based on transcription segments and engagement patterns
      const clips = await this.generateClipsFromTranscription(
        video,
        { count, minDuration, maxDuration, focusArea }
      );

      // Create clips in database
      const createdClips = [];
      for (const clipData of clips) {
        const clip = await prisma.clip.create({
          data: {
            videoId: video.id,
            title: clipData.title,
            description: clipData.description,
            startTime: clipData.startTime,
            endTime: clipData.endTime,
            tags: clipData.tags || [],
            score: clipData.score || 0.5,
            reason: clipData.reason
          }
        });
        createdClips.push(clip);
      }

      return {
        success: true,
        result: {
          clips: createdClips,
          total: createdClips.length,
          parameters: { count, minDuration, maxDuration, focusArea }
        },
        contextUpdate: {
          selectedClips: createdClips.map(c => c.id)
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to generate clips: ${error.message}`
      };
    }
  }

  /**
   * Edit an existing clip
   */
  private async editClip(
    parameters: any,
    context: ChatContext
  ): Promise<ActionExecutionResult> {
    const { clipId, title, startTime, endTime, description, tags } = parameters;

    if (!clipId) {
      return {
        success: false,
        error: 'Clip ID is required for editing'
      };
    }

    try {
      const updateData: any = {};
      if (title !== undefined) updateData.title = title;
      if (startTime !== undefined) updateData.startTime = startTime;
      if (endTime !== undefined) updateData.endTime = endTime;
      if (description !== undefined) updateData.description = description;
      if (tags !== undefined) updateData.tags = tags;

      const updatedClip = await prisma.clip.update({
        where: { id: clipId },
        data: updateData
      });

      return {
        success: true,
        result: {
          clip: updatedClip,
          changes: updateData
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to edit clip: ${error.message}`
      };
    }
  }

  /**
   * Export clips in specified format
   */
  private async exportClips(
    parameters: any,
    context: ChatContext
  ): Promise<ActionExecutionResult> {
    const { 
      clipIds, 
      format = 'mp4', 
      resolution = '1080p',
      aspectRatio = '16:9',
      platform 
    } = parameters;

    let clipsToExport = clipIds;
    if (!clipsToExport && context.selectedClips) {
      clipsToExport = context.selectedClips;
    }

    if (!clipsToExport || clipsToExport.length === 0) {
      return {
        success: false,
        error: 'No clips selected for export'
      };
    }

    try {
      const clips = await prisma.clip.findMany({
        where: { id: { in: clipsToExport } },
        include: { video: true }
      });

      const exportResults = [];
      for (const clip of clips) {
        try {
          // Generate export based on platform requirements
          const exportConfig = this.getExportConfig(platform, format, resolution, aspectRatio);
          const exportUrl = await this.ffmpegService.exportClip(
            clip.video.url,
            clip.startTime,
            clip.endTime,
            exportConfig
          );

          // Update clip with export URL
          await prisma.clip.update({
            where: { id: clip.id },
            data: { 
              exported: true,
              exportUrl: exportUrl
            }
          });

          exportResults.push({
            clipId: clip.id,
            title: clip.title,
            exportUrl: exportUrl,
            success: true
          });
        } catch (clipError) {
          exportResults.push({
            clipId: clip.id,
            title: clip.title,
            success: false,
            error: clipError.message
          });
        }
      }

      return {
        success: true,
        result: {
          exports: exportResults,
          totalClips: clips.length,
          successfulExports: exportResults.filter(r => r.success).length
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to export clips: ${error.message}`
      };
    }
  }

  /**
   * Analyze video content
   */
  private async analyzeVideo(
    parameters: any,
    context: ChatContext
  ): Promise<ActionExecutionResult> {
    if (!context.currentVideo) {
      return {
        success: false,
        error: 'No video selected for analysis'
      };
    }

    try {
      const video = await prisma.video.findUnique({
        where: { id: context.currentVideo.id },
        include: {
          clips: true,
          transcription: { include: { segments: true } }
        }
      });

      if (!video) {
        return {
          success: false,
          error: 'Video not found'
        };
      }

      const analysis = {
        duration: video.duration,
        fileSize: video.fileSize,
        resolution: `${video.width}x${video.height}`,
        fps: video.fps,
        codec: video.codec,
        clips: {
          total: video.clips.length,
          averageScore: video.clips.reduce((sum, c) => sum + (c.score || 0), 0) / video.clips.length,
          highQuality: video.clips.filter(c => (c.score || 0) > 0.8).length
        },
        transcription: video.transcription ? {
          language: video.transcription.language,
          segments: video.transcription.segments.length,
          averageSegmentLength: video.transcription.segments.length > 0 
            ? video.transcription.segments.reduce((sum, s) => sum + (s.endTime - s.startTime), 0) / video.transcription.segments.length
            : 0
        } : null
      };

      return {
        success: true,
        result: analysis
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to analyze video: ${error.message}`
      };
    }
  }

  /**
   * Suggest improvements for clips or video
   */
  private async suggestImprovements(
    parameters: any,
    context: ChatContext
  ): Promise<ActionExecutionResult> {
    const { target = 'clips', focus = 'engagement' } = parameters;

    if (!context.currentVideo) {
      return {
        success: false,
        error: 'No video selected for suggestions'
      };
    }

    try {
      const suggestions = [];

      if (target === 'clips' && context.currentVideo.clips) {
        // Analyze clips for improvement opportunities
        for (const clip of context.currentVideo.clips) {
          const clipSuggestions = [];

          if ((clip.score || 0) < 0.5) {
            clipSuggestions.push('Consider adjusting timing for better pacing');
          }

          if (clip.endTime - clip.startTime > 90) {
            clipSuggestions.push('Clip might be too long for social media - consider splitting');
          }

          if (!clip.description || clip.description.length < 20) {
            clipSuggestions.push('Add a more detailed description for better discoverability');
          }

          if (clip.tags.length < 3) {
            clipSuggestions.push('Add more relevant tags for categorization');
          }

          if (clipSuggestions.length > 0) {
            suggestions.push({
              clipId: clip.id,
              title: clip.title,
              suggestions: clipSuggestions
            });
          }
        }
      }

      // General video suggestions
      if (context.currentVideo.duration > 600) {
        suggestions.push({
          type: 'video',
          suggestion: 'Long videos often benefit from multiple shorter clips for better engagement'
        });
      }

      if (!context.currentVideo.clips || context.currentVideo.clips.length === 0) {
        suggestions.push({
          type: 'video',
          suggestion: 'Generate clips to increase content discoverability and engagement'
        });
      }

      return {
        success: true,
        result: {
          suggestions,
          focus,
          totalSuggestions: suggestions.length
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to generate suggestions: ${error.message}`
      };
    }
  }

  /**
   * Create highlight reels
   */
  private async createHighlights(
    parameters: any,
    context: ChatContext
  ): Promise<ActionExecutionResult> {
    const { duration = 60, theme = 'best moments' } = parameters;

    if (!context.currentVideo?.clips) {
      return {
        success: false,
        error: 'No clips available to create highlights'
      };
    }

    try {
      // Select top clips based on score
      const topClips = context.currentVideo.clips
        .filter(clip => (clip.score || 0) > 0.6)
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 5);

      if (topClips.length === 0) {
        return {
          success: false,
          error: 'No high-quality clips found for highlights'
        };
      }

      // Create a new highlight clip
      const highlightClip = await prisma.clip.create({
        data: {
          videoId: context.currentVideo.id,
          title: `${theme} Highlights`,
          description: `Automatically generated highlights featuring the best moments`,
          startTime: Math.min(...topClips.map(c => c.startTime)),
          endTime: Math.max(...topClips.map(c => c.endTime)),
          tags: ['highlights', theme, 'auto-generated'],
          score: 0.9,
          reason: `Generated from top ${topClips.length} clips`
        }
      });

      return {
        success: true,
        result: {
          highlightClip,
          sourceClips: topClips,
          duration: highlightClip.endTime - highlightClip.startTime
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create highlights: ${error.message}`
      };
    }
  }

  /**
   * Adjust captions (placeholder - would integrate with caption service)
   */
  private async adjustCaptions(
    parameters: any,
    context: ChatContext
  ): Promise<ActionExecutionResult> {
    const { style = 'modern', position = 'bottom' } = parameters;

    // This would integrate with a caption generation service
    // For now, return a success message
    return {
      success: true,
      result: {
        message: `Caption style updated to ${style} with ${position} positioning`,
        settings: { style, position }
      }
    };
  }

  /**
   * Change video format
   */
  private async changeFormat(
    parameters: any,
    context: ChatContext
  ): Promise<ActionExecutionResult> {
    const { format, resolution, aspectRatio } = parameters;

    if (!context.currentVideo) {
      return {
        success: false,
        error: 'No video selected for format change'
      };
    }

    try {
      // Update preferences in context
      const newPreferences = {
        ...context.preferences,
        exportFormat: format || context.preferences?.exportFormat,
        resolution: resolution || context.preferences?.resolution,
        aspectRatio: aspectRatio || context.preferences?.aspectRatio
      };

      return {
        success: true,
        result: {
          message: 'Format preferences updated',
          newPreferences
        },
        contextUpdate: {
          preferences: newPreferences
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to change format: ${error.message}`
      };
    }
  }

  /**
   * Generate clips from transcription segments
   */
  private async generateClipsFromTranscription(
    video: any,
    options: { count: number; minDuration: number; maxDuration: number; focusArea: string }
  ): Promise<ClipCreateData[]> {
    const clips: ClipCreateData[] = [];

    if (!video.transcription?.segments) {
      // Generate basic clips based on duration
      const clipDuration = Math.min(options.maxDuration, video.duration / options.count);
      for (let i = 0; i < options.count && i * clipDuration < video.duration; i++) {
        clips.push({
          title: `Clip ${i + 1}`,
          startTime: Math.floor(i * clipDuration),
          endTime: Math.floor(Math.min((i + 1) * clipDuration, video.duration)),
          description: `Auto-generated clip ${i + 1}`,
          tags: ['auto-generated']
        });
      }
      return clips;
    }

    // Use transcription segments for intelligent clipping
    const segments = video.transcription.segments;
    const engagingKeywords = [
      'exciting', 'amazing', 'incredible', 'wow', 'awesome', 
      'important', 'key', 'crucial', 'breakthrough', 'discovery',
      'funny', 'hilarious', 'laugh', 'joke', 'humor'
    ];

    // Find segments with engaging content
    const scoredSegments = segments.map((segment: any) => {
      let score = 0.5; // Base score
      
      // Increase score for engaging keywords
      const text = segment.text.toLowerCase();
      engagingKeywords.forEach(keyword => {
        if (text.includes(keyword)) score += 0.1;
      });

      // Increase score for questions
      if (text.includes('?')) score += 0.1;

      // Increase score for exclamations
      if (text.includes('!')) score += 0.1;

      return { ...segment, score };
    });

    // Sort by score and create clips
    const topSegments = scoredSegments
      .sort((a, b) => b.score - a.score)
      .slice(0, options.count * 2); // Get more than needed for grouping

    // Group consecutive segments into clips
    let currentClip: any = null;
    let clipIndex = 1;

    for (const segment of topSegments) {
      if (clips.length >= options.count) break;

      if (!currentClip) {
        currentClip = {
          title: `Engaging Moment ${clipIndex}`,
          startTime: Math.floor(segment.startTime),
          endTime: Math.ceil(segment.endTime),
          description: segment.text.substring(0, 100) + '...',
          tags: ['engaging', 'auto-generated'],
          score: segment.score
        };
      } else {
        // Extend current clip if segments are close
        if (segment.startTime - currentClip.endTime < 5) {
          currentClip.endTime = Math.ceil(segment.endTime);
          currentClip.description += ` ${segment.text.substring(0, 50)}...`;
        } else {
          // Finalize current clip if it meets duration requirements
          const duration = currentClip.endTime - currentClip.startTime;
          if (duration >= options.minDuration && duration <= options.maxDuration) {
            clips.push(currentClip);
            clipIndex++;
          }
          currentClip = null;
        }
      }
    }

    // Add final clip if valid
    if (currentClip) {
      const duration = currentClip.endTime - currentClip.startTime;
      if (duration >= options.minDuration && duration <= options.maxDuration) {
        clips.push(currentClip);
      }
    }

    return clips;
  }

  /**
   * Get export configuration based on platform and preferences
   */
  private getExportConfig(
    platform?: string,
    format = 'mp4',
    resolution = '1080p',
    aspectRatio = '16:9'
  ): any {
    const baseConfig = {
      format,
      resolution,
      aspectRatio
    };

    switch (platform?.toLowerCase()) {
      case 'tiktok':
        return {
          ...baseConfig,
          aspectRatio: '9:16',
          resolution: '1080p',
          maxDuration: 60
        };
      case 'instagram':
        return {
          ...baseConfig,
          aspectRatio: '1:1',
          resolution: '1080p',
          maxDuration: 90
        };
      case 'youtube':
        return {
          ...baseConfig,
          aspectRatio: '16:9',
          resolution: '1080p'
        };
      default:
        return baseConfig;
    }
  }
}

// Singleton instance
let chatActionExecutorInstance: ChatActionExecutor | null = null;

export function getChatActionExecutor(): ChatActionExecutor {
  if (!chatActionExecutorInstance) {
    chatActionExecutorInstance = new ChatActionExecutor();
  }
  return chatActionExecutorInstance;
}