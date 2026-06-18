import { getClaudeService } from './claude-service';
import { getChatConversationService } from './chat-conversation-service';
import { getChatActionExecutor } from './chat-action-executor';
import { 
  ChatContext, 
  ChatMessage, 
  ChatAction, 
  ChatResponse,
  Video,
  Clip 
} from '../types';

export interface ChatIntegrationConfig {
  autoExecuteActions?: boolean;
  maxActionsPerMessage?: number;
  enableContextPersistence?: boolean;
}

export class ChatIntegrationService {
  private claudeService = getClaudeService();
  private conversationService = getChatConversationService();
  private actionExecutor = getChatActionExecutor();

  constructor(private config: ChatIntegrationConfig = {}) {
    this.config = {
      autoExecuteActions: true,
      maxActionsPerMessage: 3,
      enableContextPersistence: true,
      ...config
    };
  }

  /**
   * Process a complete chat interaction: message -> Claude response -> action execution
   */
  async processUserMessage(
    userId: string,
    message: string,
    context: ChatContext,
    conversationId?: string
  ): Promise<{
    response: ChatMessage;
    actions: ChatAction[];
    contextUpdate?: Partial<ChatContext>;
    conversationId: string;
  }> {
    try {
      // Get or create conversation
      let conversation;
      if (conversationId) {
        conversation = await this.conversationService.getConversation(conversationId, userId);
        if (!conversation) {
          throw new Error('Conversation not found');
        }
      } else {
        const title = await this.claudeService.generateConversationTitle(message);
        conversation = await this.conversationService.createConversation(
          userId,
          context.currentVideo?.id,
          title,
          context
        );
      }

      // Update conversation context
      if (this.config.enableContextPersistence) {
        context = await this.conversationService.updateContext(conversation.id, context);
      }

      // Add user message
      const userMessage = await this.conversationService.addMessage(
        conversation.id,
        message,
        'user'
      );

      // Get recent conversation history
      const recentMessages = await this.conversationService.getMessages(
        conversation.id,
        20
      );

      // Generate Claude response
      const claudeResponse = await this.claudeService.generateResponse(
        message,
        context,
        recentMessages.slice(0, -1) // Exclude the message we just added
      );

      // Execute actions if enabled
      const executedActions: ChatAction[] = [];
      const contextUpdates: Partial<ChatContext> = {};

      if (this.config.autoExecuteActions && claudeResponse.actions.length > 0) {
        const actionsToExecute = claudeResponse.actions.slice(
          0, 
          this.config.maxActionsPerMessage
        );

        for (const action of actionsToExecute) {
          try {
            const result = await this.actionExecutor.executeAction(
              action,
              context,
              userId
            );
            
            action.status = result.success ? 'completed' : 'failed';
            action.result = result.result;
            action.error = result.error;
            
            executedActions.push(action);

            // Merge context updates
            if (result.contextUpdate) {
              Object.assign(contextUpdates, result.contextUpdate);
            }
          } catch (actionError) {
            console.error('Action execution error:', actionError);
            action.status = 'failed';
            action.error = actionError.message;
            executedActions.push(action);
          }
        }

        // Update conversation context with changes
        if (Object.keys(contextUpdates).length > 0) {
          context = await this.conversationService.updateContext(
            conversation.id,
            contextUpdates
          );
        }
      }

      // Add Claude's response message
      const assistantMessage = await this.conversationService.addMessage(
        conversation.id,
        claudeResponse.response,
        'assistant',
        {
          actions: executedActions,
          thinking: claudeResponse.thinking
        }
      );

      return {
        response: assistantMessage,
        actions: executedActions,
        contextUpdate: contextUpdates,
        conversationId: conversation.id
      };

    } catch (error) {
      console.error('Chat integration error:', error);
      throw new Error(`Failed to process message: ${error.message}`);
    }
  }

  /**
   * Execute a specific action manually
   */
  async executeAction(
    userId: string,
    conversationId: string,
    action: ChatAction
  ): Promise<{
    success: boolean;
    result?: any;
    error?: string;
    contextUpdate?: Partial<ChatContext>;
  }> {
    try {
      // Get conversation context
      const conversation = await this.conversationService.getConversation(
        conversationId,
        userId
      );
      
      if (!conversation) {
        throw new Error('Conversation not found');
      }

      // Execute action
      const result = await this.actionExecutor.executeAction(
        action,
        conversation.context,
        userId
      );

      // Update conversation context if needed
      if (result.success && result.contextUpdate) {
        await this.conversationService.updateContext(
          conversationId,
          result.contextUpdate
        );
      }

      // Log action execution
      await this.conversationService.addMessage(
        conversationId,
        `Executed action: ${action.type}`,
        'assistant',
        {
          action: {
            ...action,
            status: result.success ? 'completed' : 'failed',
            result: result.result,
            error: result.error
          }
        }
      );

      return result;

    } catch (error) {
      console.error('Action execution error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get smart suggestions based on current context
   */
  async getSmartSuggestions(context: ChatContext): Promise<string[]> {
    const suggestions: string[] = [];

    if (!context.currentVideo) {
      suggestions.push("Upload a video to get started with AI-powered editing");
      return suggestions;
    }

    const video = context.currentVideo;

    // Video analysis suggestions
    if (video.processingStage === 'COMPLETED') {
      suggestions.push("Analyze this video and tell me what makes it engaging");
    }

    // Clip-related suggestions
    if (video.clips && video.clips.length > 0) {
      suggestions.push("Find the clips with the strongest hooks");
      suggestions.push("Create a highlight reel from the best moments");
      
      if (context.selectedClips && context.selectedClips.length > 0) {
        suggestions.push(`Export these ${context.selectedClips.length} clips for TikTok`);
        suggestions.push("Suggest improvements for better engagement");
      } else {
        suggestions.push("Show me the top 3 clips ranked by engagement");
      }
    } else {
      suggestions.push("Generate clips from this video automatically");
    }

    // Export and optimization suggestions
    if (video.clips && video.clips.some(clip => clip.score && clip.score > 0.7)) {
      suggestions.push("Export the best clips in different formats");
      suggestions.push("Optimize clips for social media platforms");
    }

    // Content-specific suggestions
    if (video.transcription) {
      suggestions.push("Find the funniest moments in this video");
      suggestions.push("Extract educational highlights");
      suggestions.push("Generate clips focusing on key insights");
    }

    // Platform-specific suggestions
    suggestions.push("Create Instagram Reels from this content");
    suggestions.push("Make YouTube Shorts from the highlights");
    suggestions.push("Generate clips perfect for LinkedIn");

    return suggestions.slice(0, 6); // Return top 6 suggestions
  }

  /**
   * Parse natural language query into structured filters
   */
  async parseSearchQuery(
    query: string,
    context: ChatContext
  ): Promise<{
    filters: any;
    suggestions: string[];
  }> {
    try {
      const commands = await this.claudeService.parseNaturalLanguageCommand(
        query,
        context
      );

      const filters: any = {};
      const suggestions: string[] = [];

      for (const command of commands) {
        switch (command.intent) {
          case 'find_clips':
            if (command.entities.minScore) {
              filters.minScore = command.entities.minScore;
            }
            if (command.entities.tags) {
              filters.tags = command.entities.tags;
            }
            if (command.entities.duration) {
              filters.duration = command.entities.duration;
            }
            break;

          case 'export_clips':
            if (command.entities.format) {
              suggestions.push(`Export in ${command.entities.format} format`);
            }
            if (command.entities.platform) {
              suggestions.push(`Optimize for ${command.entities.platform}`);
            }
            break;
        }
      }

      return { filters, suggestions };

    } catch (error) {
      console.error('Query parsing error:', error);
      return { filters: {}, suggestions: [] };
    }
  }

  /**
   * Generate contextual help messages
   */
  getContextualHelp(context: ChatContext): string[] {
    const help: string[] = [];

    if (!context.currentVideo) {
      help.push("💡 Start by selecting a video to work with");
      help.push("🎬 Once uploaded, I can help you generate and edit clips");
      return help;
    }

    const video = context.currentVideo;

    if (video.processingStage !== 'COMPLETED') {
      help.push("⏳ Your video is still processing");
      help.push("📊 I'll be able to help more once processing completes");
      return help;
    }

    if (!video.clips || video.clips.length === 0) {
      help.push("🎯 Try: 'Generate clips from this video'");
      help.push("✨ I can automatically find the best moments");
    } else {
      help.push("🔍 Try: 'Find clips with strong hooks'");
      help.push("📱 Try: 'Export these clips for TikTok'");
      help.push("💡 Try: 'Suggest improvements for engagement'");
    }

    if (context.selectedClips && context.selectedClips.length > 0) {
      help.push(`📋 ${context.selectedClips.length} clips selected`);
      help.push("🎬 Ask me to edit, export, or analyze them");
    }

    return help;
  }
}

// Singleton instance
let chatIntegrationServiceInstance: ChatIntegrationService | null = null;

export function getChatIntegrationService(config?: ChatIntegrationConfig): ChatIntegrationService {
  if (!chatIntegrationServiceInstance) {
    chatIntegrationServiceInstance = new ChatIntegrationService(config);
  }
  return chatIntegrationServiceInstance;
}