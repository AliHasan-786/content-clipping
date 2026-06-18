import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getChatConversationService } from '@/lib/chat-conversation-service';
import { getChatActionExecutor } from '@/lib/chat-action-executor';
import { ChatActionRequest, ChatActionResponse } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' }, 
        { status: 401 }
      );
    }

    const body: ChatActionRequest = await request.json();
    const { conversationId, action } = body;

    if (!conversationId || !action) {
      return NextResponse.json(
        { error: 'Conversation ID and action are required' },
        { status: 400 }
      );
    }

    const conversationService = getChatConversationService();
    const actionExecutor = getChatActionExecutor();
    
    // Verify conversation ownership and get context
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

    // Execute the action
    const result = await actionExecutor.executeAction(
      action,
      conversation.context,
      session.user.id
    );

    // Update conversation context if needed
    let updatedContext = conversation.context;
    if (result.success && result.contextUpdate) {
      updatedContext = await conversationService.updateContext(
        conversationId,
        result.contextUpdate
      );
    }

    // Log action execution result
    await conversationService.addMessage(
      conversationId,
      `Action executed: ${action.type}`,
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

    const response: ChatActionResponse = {
      success: result.success,
      result: result.result,
      error: result.error,
      updatedContext: result.contextUpdate ? updatedContext : undefined
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Chat actions API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET endpoint to retrieve available actions based on context
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

    if (!conversationId) {
      return NextResponse.json(
        { error: 'Conversation ID is required' },
        { status: 400 }
      );
    }

    const conversationService = getChatConversationService();
    
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

    // Return available actions based on current context
    const availableActions = getAvailableActions(conversation.context);

    return NextResponse.json({ 
      actions: availableActions,
      context: conversation.context
    });

  } catch (error) {
    console.error('Chat actions GET API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function getAvailableActions(context: any) {
  const actions = [
    {
      type: 'analyze_video',
      name: 'Analyze Video',
      description: 'Get detailed analysis of the current video',
      enabled: !!context.currentVideo
    },
    {
      type: 'find_clips',
      name: 'Find Clips',
      description: 'Search for clips based on criteria',
      enabled: !!context.currentVideo?.clips?.length
    },
    {
      type: 'generate_clips',
      name: 'Generate Clips',
      description: 'Create new clips from the video',
      enabled: !!context.currentVideo
    },
    {
      type: 'edit_clip',
      name: 'Edit Clip',
      description: 'Modify existing clips',
      enabled: !!context.selectedClips?.length
    },
    {
      type: 'export_clips',
      name: 'Export Clips',
      description: 'Export clips in various formats',
      enabled: !!context.selectedClips?.length || !!context.currentVideo?.clips?.length
    },
    {
      type: 'suggest_improvements',
      name: 'Suggest Improvements',
      description: 'Get recommendations for better engagement',
      enabled: !!context.currentVideo
    },
    {
      type: 'create_highlights',
      name: 'Create Highlights',
      description: 'Generate highlight reels from best clips',
      enabled: !!context.currentVideo?.clips?.length
    },
    {
      type: 'change_format',
      name: 'Change Format',
      description: 'Update export format preferences',
      enabled: true
    }
  ];

  return actions.filter(action => action.enabled);
}