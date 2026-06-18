import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getChatConversationService } from '@/lib/chat-conversation-service';
import { ChatContextUpdate } from '@/types';

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' }, 
        { status: 401 }
      );
    }

    const body: { conversationId: string; context: ChatContextUpdate } = await request.json();
    const { conversationId, context } = body;

    if (!conversationId) {
      return NextResponse.json(
        { error: 'Conversation ID is required' },
        { status: 400 }
      );
    }

    const conversationService = getChatConversationService();
    
    // Verify conversation ownership
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

    // Update context
    const updatedContext = await conversationService.updateContext(
      conversationId,
      context
    );

    return NextResponse.json({ 
      context: updatedContext,
      message: 'Context updated successfully'
    });

  } catch (error) {
    console.error('Chat context API error:', error);
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

    return NextResponse.json({ 
      context: conversation.context 
    });

  } catch (error) {
    console.error('Chat context GET API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}