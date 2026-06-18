import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getClaudeService } from '@/lib/claude-service';
import { getChatConversationService } from '@/lib/chat-conversation-service';
import { getChatActionExecutor } from '@/lib/chat-action-executor';
import { 
  ChatRequest, 
  ChatResponse, 
  ChatContext,
  ChatMessage 
} from '@/types';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' }, 
        { status: 401 }
      );
    }

    const body: ChatRequest = await request.json();
    const { message, conversationId, context: contextUpdate } = body;

    if (!message || message.trim().length === 0) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    const claudeService = getClaudeService();
    const conversationService = getChatConversationService();
    const actionExecutor = getChatActionExecutor();

    let conversation;
    let conversationContext: ChatContext;

    // Get or create conversation
    if (conversationId) {
      conversation = await conversationService.getConversation(conversationId, session.user.id);
      if (!conversation) {
        return NextResponse.json(
          { error: 'Conversation not found' },
          { status: 404 }
        );
      }
      conversationContext = conversation.context;
    } else {
      // Create new conversation
      const videoId = contextUpdate?.videoId;
      const title = await claudeService.generateConversationTitle(message);
      conversation = await conversationService.createConversation(
        session.user.id,
        videoId,
        title,
        contextUpdate
      );
      conversationContext = conversation.context;
    }

    // Update context if provided
    if (contextUpdate) {
      conversationContext = await conversationService.updateContext(
        conversation.id,
        contextUpdate
      );
    }

    // Add user message to conversation
    const userMessage = await conversationService.addMessage(
      conversation.id,
      message,
      'user'
    );

    // Get conversation history for context
    const recentMessages = await conversationService.getMessages(
      conversation.id,
      20 // Last 20 messages for context
    );

    // Generate Claude response
    const claudeResponse = await claudeService.generateResponse(
      message,
      conversationContext,
      recentMessages.slice(0, -1) // Exclude the message we just added
    );

    // Execute any actions Claude identified
    const executedActions = [];
    const contextUpdates: Partial<ChatContext> = {};

    if (claudeResponse.actions && claudeResponse.actions.length > 0) {
      console.log(`Executing ${claudeResponse.actions.length} actions from Claude response`);
      
      for (const action of claudeResponse.actions) {
        try {
          const result = await actionExecutor.executeAction(
            action,
            conversationContext,
            session.user.id
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

      // Update conversation context with any changes
      if (Object.keys(contextUpdates).length > 0) {
        conversationContext = await conversationService.updateContext(
          conversation.id,
          contextUpdates
        );
      }
    }

    // Add Claude's response message to conversation
    const assistantMessage = await conversationService.addMessage(
      conversation.id,
      claudeResponse.response,
      'assistant',
      {
        actions: executedActions,
        thinking: claudeResponse.thinking
      }
    );

    const response: ChatResponse = {
      message: assistantMessage,
      actions: executedActions,
      contextUpdate: Object.keys(contextUpdates).length > 0 ? contextUpdates : undefined
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' }, 
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');
    const videoId = searchParams.get('videoId');
    const limit = parseInt(searchParams.get('limit') || '50');

    const conversationService = getChatConversationService();

    if (conversationId) {
      // Get specific conversation
      const conversation = await conversationService.getConversation(
        conversationId, 
        session.user.id
      );
      
      if (!conversation) {
        return NextResponse.json(
          { error: 'Conversation not found' },
          { status: 404 }
        );
      }
      
      return NextResponse.json({ conversation });
    } else if (videoId) {
      // Get conversations for a specific video
      const conversations = await conversationService.getVideoConversations(
        videoId,
        session.user.id,
        limit
      );
      return NextResponse.json({ conversations });
    } else {
      // Get all user conversations
      const conversations = await conversationService.getUserConversations(
        session.user.id,
        false,
        limit
      );
      return NextResponse.json({ conversations });
    }

  } catch (error) {
    console.error('Chat GET API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}