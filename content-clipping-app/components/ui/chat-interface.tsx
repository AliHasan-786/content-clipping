"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { 
  Send, 
  Bot, 
  User, 
  Loader2, 
  Video, 
  Scissors, 
  Download,
  MessageSquare,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import { ChatMessage, ChatResponse, ChatContext } from '@/types';

interface ChatInterfaceProps {
  conversationId?: string;
  context?: ChatContext;
  onContextUpdate?: (context: Partial<ChatContext>) => void;
  className?: string;
}

export function ChatInterface({ 
  conversationId, 
  context, 
  onContextUpdate,
  className = '' 
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (conversationId) {
      loadConversation();
    }
  }, [conversationId]);

  const loadConversation = async () => {
    if (!conversationId) return;
    
    try {
      const response = await fetch(`/api/chat?conversationId=${conversationId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.conversation?.messages) {
          setMessages(data.conversation.messages);
        }
      }
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const userMessage = inputMessage.trim();
    setInputMessage('');
    setIsLoading(true);

    // Add user message immediately to UI
    const tempUserMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      content: userMessage,
      role: 'user',
      timestamp: new Date(),
      conversationId: conversationId || '',
    };
    setMessages(prev => [...prev, tempUserMessage]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          conversationId,
          context: context ? {
            videoId: context.currentVideo?.id,
            selectedClips: context.selectedClips,
            preferences: context.preferences
          } : undefined
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const data: ChatResponse = await response.json();
      
      // Replace temp message and add assistant response
      setMessages(prev => {
        const filtered = prev.filter(msg => msg.id !== tempUserMessage.id);
        return [...filtered, 
          { ...tempUserMessage, id: data.message.id.replace('assistant', 'user') },
          data.message
        ];
      });

      // Update context if provided
      if (data.contextUpdate && onContextUpdate) {
        onContextUpdate(data.contextUpdate);
      }

    } catch (error) {
      console.error('Failed to send message:', error);
      // Show error message
      setMessages(prev => [
        ...prev.filter(msg => msg.id !== tempUserMessage.id),
        tempUserMessage,
        {
          id: `error-${Date.now()}`,
          content: 'Sorry, I encountered an error processing your request. Please try again.',
          role: 'assistant',
          timestamp: new Date(),
          conversationId: conversationId || '',
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTimestamp = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(new Date(date));
  };

  if (isCollapsed) {
    return (
      <Card className={`fixed bottom-4 right-4 w-80 z-50 shadow-lg ${className}`}>
        <CardHeader 
          className="p-3 cursor-pointer bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-t-lg"
          onClick={() => setIsCollapsed(false)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Bot className="h-5 w-5" />
              <span className="font-medium">Claude Assistant</span>
            </div>
            <ChevronUp className="h-4 w-4" />
          </div>
          {context?.currentVideo && (
            <div className="text-xs opacity-90 flex items-center space-x-1">
              <Video className="h-3 w-3" />
              <span>{context.currentVideo.title}</span>
            </div>
          )}
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className={`fixed bottom-4 right-4 w-96 h-[600px] z-50 shadow-lg flex flex-col ${className}`}>
      <CardHeader 
        className="p-3 cursor-pointer bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-t-lg flex-shrink-0"
        onClick={() => setIsCollapsed(true)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Bot className="h-5 w-5" />
            <span className="font-medium">Claude Assistant</span>
          </div>
          <ChevronDown className="h-4 w-4" />
        </div>
        {context?.currentVideo && (
          <div className="text-xs opacity-90 flex items-center space-x-1 mt-1">
            <Video className="h-3 w-3" />
            <span className="truncate">{context.currentVideo.title}</span>
            {context.selectedClips && context.selectedClips.length > 0 && (
              <span className="ml-2 bg-white/20 px-1 rounded">
                {context.selectedClips.length} clips
              </span>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <MessageSquare className="h-12 w-12 mb-4" />
              <p className="text-sm text-center">
                Start a conversation with Claude to get help with your video editing!
              </p>
              <div className="mt-4 space-y-2 text-xs">
                <p className="font-medium">Try asking:</p>
                <ul className="space-y-1 text-gray-400">
                  <li>"Find clips with strong hooks"</li>
                  <li>"Generate highlights from this video"</li>
                  <li>"Export clips for TikTok"</li>
                </ul>
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <MessageBubble 
                key={message.id} 
                message={message} 
                onActionClick={(action) => console.log('Action clicked:', action)}
              />
            ))
          )}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-lg p-3 max-w-[80%]">
                <div className="flex items-center space-x-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-gray-600">Claude is thinking...</span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t p-4 flex-shrink-0">
          <div className="flex space-x-2">
            <Input
              ref={inputRef}
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask Claude about your video..."
              className="flex-1"
              disabled={isLoading}
            />
            <Button 
              onClick={sendMessage} 
              disabled={!inputMessage.trim() || isLoading}
              size="sm"
              className="px-3"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  onActionClick?: (action: any) => void;
}

function MessageBubble({ message, onActionClick }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const actions = message.metadata?.actions || [];

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] ${isUser ? 'order-2' : 'order-1'}`}>
        <div
          className={`rounded-lg p-3 ${
            isUser
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-900 border'
          }`}
        >
          <div className="text-sm">{message.content}</div>
          
          {/* Show actions for assistant messages */}
          {!isUser && actions.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="text-xs font-medium text-gray-600">Actions Executed:</div>
              {actions.map((action: any, index: number) => (
                <ActionBadge 
                  key={index} 
                  action={action} 
                  onClick={() => onActionClick?.(action)} 
                />
              ))}
            </div>
          )}
        </div>
        
        <div className={`text-xs text-gray-500 mt-1 ${isUser ? 'text-right' : 'text-left'}`}>
          <div className="flex items-center space-x-1">
            {isUser ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
            <span>{formatTimestamp(message.timestamp)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ActionBadgeProps {
  action: any;
  onClick?: () => void;
}

function ActionBadge({ action, onClick }: ActionBadgeProps) {
  const getActionIcon = (type: string) => {
    switch (type) {
      case 'find_clips':
      case 'generate_clips':
        return <Scissors className="h-3 w-3" />;
      case 'export_clips':
        return <Download className="h-3 w-3" />;
      case 'analyze_video':
        return <Video className="h-3 w-3" />;
      default:
        return <MessageSquare className="h-3 w-3" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'processing':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <button
      className={`inline-flex items-center space-x-1 px-2 py-1 rounded text-xs ${getStatusColor(action.status)} hover:opacity-80 transition-opacity`}
      onClick={onClick}
      title={action.description}
    >
      {getActionIcon(action.type)}
      <span className="capitalize">{action.type.replace('_', ' ')}</span>
      {action.status === 'processing' && <Loader2 className="h-3 w-3 animate-spin" />}
    </button>
  );
}