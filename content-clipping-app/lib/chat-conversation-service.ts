import { prisma } from './prisma';
import { 
  ChatConversation, 
  ChatMessage, 
  ChatContext, 
  ChatContextUpdate,
  Video,
  Clip 
} from '../types';

export class ChatConversationService {
  /**
   * Create a new chat conversation
   */
  async createConversation(
    userId: string,
    videoId?: string,
    title?: string,
    initialContext: Partial<ChatContext> = {}
  ): Promise<ChatConversation> {
    try {
      // If videoId is provided, fetch video details for context
      let videoContext = undefined;
      if (videoId) {
        const video = await prisma.video.findUnique({
          where: { id: videoId },
          include: {
            clips: {
              orderBy: { score: 'desc' }
            },
            transcription: true
          }
        });

        if (video) {
          videoContext = {
            id: video.id,
            title: video.title,
            duration: video.duration,
            processingStage: video.processingStage,
            clips: video.clips,
            transcription: video.transcription?.text
          };
        }
      }

      const context: ChatContext = {
        currentVideo: videoContext,
        selectedClips: [],
        preferences: {
          exportFormat: 'mp4',
          resolution: '1080p',
          aspectRatio: '16:9'
        },
        ...initialContext
      };

      const conversation = await prisma.chatConversation.create({
        data: {
          title,
          userId,
          videoId,
          context: context as any,
          isActive: true
        },
        include: {
          messages: {
            orderBy: { createdAt: 'asc' }
          },
          video: true,
          user: true
        }
      });

      return this.formatConversation(conversation);
    } catch (error) {
      console.error('Error creating chat conversation:', error);
      throw new Error(`Failed to create conversation: ${error.message}`);
    }
  }

  /**
   * Get a conversation by ID
   */
  async getConversation(conversationId: string, userId?: string): Promise<ChatConversation | null> {
    try {
      const whereClause = userId 
        ? { id: conversationId, userId }
        : { id: conversationId };

      const conversation = await prisma.chatConversation.findUnique({
        where: whereClause,
        include: {
          messages: {
            orderBy: { createdAt: 'asc' }
          },
          video: {
            include: {
              clips: {
                orderBy: { score: 'desc' }
              },
              transcription: true
            }
          },
          user: true
        }
      });

      return conversation ? this.formatConversation(conversation) : null;
    } catch (error) {
      console.error('Error getting conversation:', error);
      throw new Error(`Failed to get conversation: ${error.message}`);
    }
  }

  /**
   * Get all conversations for a user
   */
  async getUserConversations(
    userId: string,
    includeInactive = false,
    limit = 50
  ): Promise<ChatConversation[]> {
    try {
      const conversations = await prisma.chatConversation.findMany({
        where: {
          userId,
          ...(includeInactive ? {} : { isActive: true })
        },
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1 // Just the latest message for preview
          },
          video: true,
          user: true
        },
        orderBy: { updatedAt: 'desc' },
        take: limit
      });

      return conversations.map(conv => this.formatConversation(conv));
    } catch (error) {
      console.error('Error getting user conversations:', error);
      throw new Error(`Failed to get conversations: ${error.message}`);
    }
  }

  /**
   * Add a message to a conversation
   */
  async addMessage(
    conversationId: string,
    content: string,
    role: 'user' | 'assistant',
    metadata?: any
  ): Promise<ChatMessage> {
    try {
      // Update conversation's updatedAt timestamp
      await prisma.chatConversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() }
      });

      const message = await prisma.chatMessage.create({
        data: {
          conversationId,
          content,
          role,
          metadata: metadata as any
        }
      });

      return this.formatMessage(message);
    } catch (error) {
      console.error('Error adding message:', error);
      throw new Error(`Failed to add message: ${error.message}`);
    }
  }

  /**
   * Update conversation context
   */
  async updateContext(
    conversationId: string,
    contextUpdate: ChatContextUpdate
  ): Promise<ChatContext> {
    try {
      const conversation = await prisma.chatConversation.findUnique({
        where: { id: conversationId },
        include: {
          video: {
            include: {
              clips: {
                orderBy: { score: 'desc' }
              },
              transcription: true
            }
          }
        }
      });

      if (!conversation) {
        throw new Error('Conversation not found');
      }

      let currentContext = conversation.context as ChatContext;
      
      // Update video context if videoId changed
      if (contextUpdate.videoId && contextUpdate.videoId !== conversation.videoId) {
        const video = await prisma.video.findUnique({
          where: { id: contextUpdate.videoId },
          include: {
            clips: {
              orderBy: { score: 'desc' }
            },
            transcription: true
          }
        });

        if (video) {
          currentContext.currentVideo = {
            id: video.id,
            title: video.title,
            duration: video.duration,
            processingStage: video.processingStage,
            clips: video.clips,
            transcription: video.transcription?.text
          };
        }
      }

      // Update other context fields
      if (contextUpdate.selectedClips !== undefined) {
        currentContext.selectedClips = contextUpdate.selectedClips;
      }

      if (contextUpdate.preferences) {
        currentContext.preferences = {
          ...currentContext.preferences,
          ...contextUpdate.preferences
        };
      }

      // Save updated context
      await prisma.chatConversation.update({
        where: { id: conversationId },
        data: {
          context: currentContext as any,
          videoId: contextUpdate.videoId || conversation.videoId,
          updatedAt: new Date()
        }
      });

      return currentContext;
    } catch (error) {
      console.error('Error updating conversation context:', error);
      throw new Error(`Failed to update context: ${error.message}`);
    }
  }

  /**
   * Update conversation title
   */
  async updateTitle(conversationId: string, title: string): Promise<void> {
    try {
      await prisma.chatConversation.update({
        where: { id: conversationId },
        data: { 
          title,
          updatedAt: new Date()
        }
      });
    } catch (error) {
      console.error('Error updating conversation title:', error);
      throw new Error(`Failed to update title: ${error.message}`);
    }
  }

  /**
   * Archive/deactivate a conversation
   */
  async archiveConversation(conversationId: string): Promise<void> {
    try {
      await prisma.chatConversation.update({
        where: { id: conversationId },
        data: { 
          isActive: false,
          updatedAt: new Date()
        }
      });
    } catch (error) {
      console.error('Error archiving conversation:', error);
      throw new Error(`Failed to archive conversation: ${error.message}`);
    }
  }

  /**
   * Delete a conversation and all its messages
   */
  async deleteConversation(conversationId: string): Promise<void> {
    try {
      await prisma.chatConversation.delete({
        where: { id: conversationId }
      });
    } catch (error) {
      console.error('Error deleting conversation:', error);
      throw new Error(`Failed to delete conversation: ${error.message}`);
    }
  }

  /**
   * Get conversation messages with pagination
   */
  async getMessages(
    conversationId: string,
    limit = 50,
    offset = 0
  ): Promise<ChatMessage[]> {
    try {
      const messages = await prisma.chatMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        skip: offset,
        take: limit
      });

      return messages.map(msg => this.formatMessage(msg));
    } catch (error) {
      console.error('Error getting messages:', error);
      throw new Error(`Failed to get messages: ${error.message}`);
    }
  }

  /**
   * Search conversations by content
   */
  async searchConversations(
    userId: string,
    query: string,
    limit = 20
  ): Promise<ChatConversation[]> {
    try {
      const conversations = await prisma.chatConversation.findMany({
        where: {
          userId,
          isActive: true,
          OR: [
            {
              title: {
                contains: query,
                mode: 'insensitive'
              }
            },
            {
              messages: {
                some: {
                  content: {
                    contains: query,
                    mode: 'insensitive'
                  }
                }
              }
            }
          ]
        },
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1
          },
          video: true,
          user: true
        },
        orderBy: { updatedAt: 'desc' },
        take: limit
      });

      return conversations.map(conv => this.formatConversation(conv));
    } catch (error) {
      console.error('Error searching conversations:', error);
      throw new Error(`Failed to search conversations: ${error.message}`);
    }
  }

  /**
   * Get conversations for a specific video
   */
  async getVideoConversations(
    videoId: string,
    userId?: string,
    limit = 20
  ): Promise<ChatConversation[]> {
    try {
      const whereClause = userId 
        ? { videoId, userId, isActive: true }
        : { videoId, isActive: true };

      const conversations = await prisma.chatConversation.findMany({
        where: whereClause,
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1
          },
          video: true,
          user: true
        },
        orderBy: { updatedAt: 'desc' },
        take: limit
      });

      return conversations.map(conv => this.formatConversation(conv));
    } catch (error) {
      console.error('Error getting video conversations:', error);
      throw new Error(`Failed to get video conversations: ${error.message}`);
    }
  }

  /**
   * Format database conversation object to match our TypeScript interface
   */
  private formatConversation(conversation: any): ChatConversation {
    return {
      id: conversation.id,
      title: conversation.title,
      userId: conversation.userId,
      videoId: conversation.videoId,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: conversation.messages?.map((msg: any) => this.formatMessage(msg)) || [],
      context: conversation.context as ChatContext,
      isActive: conversation.isActive
    };
  }

  /**
   * Format database message object to match our TypeScript interface
   */
  private formatMessage(message: any): ChatMessage {
    return {
      id: message.id,
      content: message.content,
      role: message.role as 'user' | 'assistant',
      timestamp: message.createdAt,
      conversationId: message.conversationId,
      metadata: message.metadata
    };
  }
}

// Singleton instance
let chatConversationServiceInstance: ChatConversationService | null = null;

export function getChatConversationService(): ChatConversationService {
  if (!chatConversationServiceInstance) {
    chatConversationServiceInstance = new ChatConversationService();
  }
  return chatConversationServiceInstance;
}