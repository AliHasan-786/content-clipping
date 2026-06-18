"use client";

import React, { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { ProcessingStatus } from './processing-status';
import { ClipsPreview } from './clips-preview';
import { ChatInterface } from './chat-interface';
import { ChatContextManager, useChatIntegration } from './chat-context-manager';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  AlertCircle, 
  CheckCircle2, 
  PlayCircle, 
  Settings, 
  Download, 
  MessageSquare,
  Bot,
  Sparkles 
} from 'lucide-react';

interface EnhancedProcessingDashboardProps {
  videoId: string;
  initialVideoData?: {
    id: string;
    title: string;
    status: string;
    processingStage?: string;
    thumbnail?: string;
    url: string;
  };
}

interface VideoData {
  id: string;
  title: string;
  status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'ERROR';
  processingStage?: string;
  thumbnail?: string;
  url: string;
  duration?: number;
  transcription?: {
    id: string;
    language: string;
    text: string;
  };
  clipsCount?: number;
  approvedClipsCount?: number;
  clips?: any[];
}

function DashboardContent({ videoId, initialVideoData }: EnhancedProcessingDashboardProps) {
  const [videoData, setVideoData] = useState<VideoData | null>(initialVideoData || null);
  const [activeTab, setActiveTab] = useState<'status' | 'clips' | 'transcription' | 'chat'>('status');
  const [processingComplete, setProcessingComplete] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [conversationId, setConversationId] = useState<string>();
  const [showChatSuggestions, setShowChatSuggestions] = useState(true);

  const { context, onClipSelect, onVideoChange } = useChatIntegration();

  // Update chat context when video data changes
  useEffect(() => {
    if (videoData) {
      onVideoChange(videoData as any);
    }
  }, [videoData, onVideoChange]);

  // Initialize WebSocket connection
  useEffect(() => {
    if (!videoId) return;

    // Initialize Socket.IO connection
    fetch('/api/socket');
    
    const socketInstance = io('/api/socket', {
      path: '/api/socket',
    });

    socketInstance.on('connect', () => {
      console.log('Connected to WebSocket');
      setIsConnected(true);
      socketInstance.emit('join-video', videoId);
    });

    socketInstance.on('disconnect', () => {
      console.log('Disconnected from WebSocket');
      setIsConnected(false);
    });

    // Listen for processing progress updates
    socketInstance.on('processing-progress', (update: any) => {
      if (update.videoId === videoId) {
        setVideoData(prev => prev ? {
          ...prev,
          processingStage: update.stage,
          processingProgress: update.progress,
          errorMessage: update.errorMessage,
        } : null);
      }
    });

    // Listen for processing completion
    socketInstance.on('processing-complete', (data: any) => {
      if (data.videoId === videoId) {
        setVideoData(prev => prev ? {
          ...prev,
          status: 'READY',
          processingStage: 'COMPLETED',
          processingProgress: 100,
          ...data.result,
        } : null);
        setProcessingComplete(true);
        setActiveTab('clips');
        setShowChatSuggestions(true); // Show chat suggestions when processing completes
      }
    });

    // Listen for processing errors
    socketInstance.on('processing-error', (data: any) => {
      if (data.videoId === videoId) {
        setVideoData(prev => prev ? {
          ...prev,
          status: 'ERROR',
          processingStage: 'FAILED',
          errorMessage: data.error,
        } : null);
      }
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.emit('leave-video', videoId);
      socketInstance.disconnect();
    };
  }, [videoId]);

  // Switch to clips tab when processing is complete
  useEffect(() => {
    if (videoData?.status === 'READY' && !processingComplete) {
      setProcessingComplete(true);
      setActiveTab('clips');
    }
  }, [videoData?.status, processingComplete]);

  const handleProcessingComplete = (video: any) => {
    setVideoData(prev => ({
      ...prev,
      ...video,
      status: 'READY',
    }));
    setProcessingComplete(true);
    setActiveTab('clips');
  };

  const handleProcessingError = (error: string) => {
    console.error('Processing failed:', error);
    setVideoData(prev => prev ? {
      ...prev,
      status: 'ERROR',
    } : null);
  };

  const startProcessing = async () => {
    try {
      const response = await fetch('/api/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ videoId }),
      });

      const data = await response.json();
      
      if (response.ok) {
        setVideoData(prev => prev ? {
          ...prev,
          status: 'PROCESSING',
          processingStage: 'UPLOADED',
        } : null);
      } else {
        throw new Error(data.error || 'Failed to start processing');
      }
    } catch (error) {
      console.error('Failed to start processing:', error);
    }
  };

  const handleChatContextUpdate = (update: any) => {
    // Handle context updates from chat
    if (update.selectedClips) {
      // Update UI to reflect selected clips
      console.log('Chat selected clips:', update.selectedClips);
    }
  };

  const handleClipSelectionChange = (selectedClips: string[]) => {
    onClipSelect(selectedClips);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'READY':
        return 'text-green-600 bg-green-50 border-green-200';
      case 'PROCESSING':
        return 'text-blue-600 bg-blue-50 border-blue-200';
      case 'ERROR':
        return 'text-red-600 bg-red-50 border-red-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const canStartProcessing = videoData?.status === 'UPLOADING' || videoData?.status === 'ERROR';
  const isProcessing = videoData?.status === 'PROCESSING';
  const isComplete = videoData?.status === 'READY';

  const chatSuggestions = [
    "Find clips with the strongest hooks",
    "Generate highlights for social media",
    "Export clips in TikTok format",
    "Suggest improvements for engagement"
  ];

  return (
    <div className="space-y-6 relative">
      {/* Video Header */}
      {videoData && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex space-x-4">
                {videoData.thumbnail && (
                  <img
                    src={videoData.thumbnail}
                    alt="Video thumbnail"
                    className="w-24 h-16 object-cover rounded-lg bg-gray-100"
                  />
                )}
                <div>
                  <CardTitle className="text-xl">{videoData.title}</CardTitle>
                  <CardDescription>
                    Video ID: {videoData.id}
                    {videoData.duration && (
                      <span className="ml-2">• Duration: {Math.floor(videoData.duration / 60)}:{(videoData.duration % 60).toString().padStart(2, '0')}</span>
                    )}
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Badge 
                  variant="outline" 
                  className={getStatusColor(videoData.status)}
                >
                  {videoData.status}
                </Badge>
                {isProcessing && (
                  <Badge 
                    variant="outline" 
                    className={isConnected ? 'text-green-600 bg-green-50 border-green-200' : 'text-gray-600 bg-gray-50 border-gray-200'}
                  >
                    {isConnected ? '🟢 Live' : '🔴 Offline'}
                  </Badge>
                )}
                {canStartProcessing && (
                  <Button onClick={startProcessing} size="sm">
                    <PlayCircle className="h-4 w-4 mr-1" />
                    Start Processing
                  </Button>
                )}
                {isComplete && (
                  <Button 
                    onClick={() => setActiveTab('chat')} 
                    size="sm" 
                    variant="outline"
                    className="bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200 text-blue-700 hover:from-blue-100 hover:to-purple-100"
                  >
                    <Bot className="h-4 w-4 mr-1" />
                    Ask Claude
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
        </Card>
      )}

      {/* Chat Suggestions Banner */}
      {isComplete && showChatSuggestions && (
        <Card className="bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-3">
                <div className="flex items-center justify-center w-8 h-8 bg-blue-100 rounded-full">
                  <Sparkles className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <h4 className="font-medium text-blue-900">Try asking Claude for help!</h4>
                  <p className="text-sm text-blue-700 mt-1">
                    Your video is ready. Ask Claude to help you find the best clips, create highlights, or optimize for different platforms.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {chatSuggestions.map((suggestion, index) => (
                      <Button
                        key={index}
                        variant="outline"
                        size="sm"
                        className="text-xs bg-white/50 border-blue-200 text-blue-700 hover:bg-white/80"
                        onClick={() => {
                          setActiveTab('chat');
                          // Could auto-fill the suggestion in chat input
                        }}
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowChatSuggestions(false)}
                className="text-blue-600 hover:text-blue-800 hover:bg-blue-100/50"
              >
                ×
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="status" className="flex items-center space-x-1">
            <Settings className="h-4 w-4" />
            <span>Processing Status</span>
          </TabsTrigger>
          <TabsTrigger 
            value="clips" 
            disabled={!isComplete}
            className="flex items-center space-x-1"
          >
            <PlayCircle className="h-4 w-4" />
            <span>Generated Clips</span>
            {videoData?.clipsCount && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {videoData.clipsCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger 
            value="transcription" 
            disabled={!videoData?.transcription}
            className="flex items-center space-x-1"
          >
            <AlertCircle className="h-4 w-4" />
            <span>Transcription</span>
          </TabsTrigger>
          <TabsTrigger 
            value="chat" 
            className="flex items-center space-x-1 bg-gradient-to-r from-blue-50 to-purple-50 data-[state=active]:from-blue-100 data-[state=active]:to-purple-100"
          >
            <Bot className="h-4 w-4" />
            <span>Claude AI Chat</span>
            <Badge variant="secondary" className="ml-1 text-xs bg-blue-100 text-blue-700">
              New
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="status" className="space-y-4">
          {videoData?.status === 'UPLOADING' && !isProcessing && (
            <Card>
              <CardContent className="p-6 text-center">
                <div className="space-y-4">
                  <div className="flex items-center justify-center space-x-2">
                    <CheckCircle2 className="h-8 w-8 text-green-500" />
                    <h3 className="text-lg font-medium">Upload Complete</h3>
                  </div>
                  <p className="text-gray-600">
                    Your video has been successfully uploaded. Click "Start Processing" to begin 
                    generating clips automatically.
                  </p>
                  <Button onClick={startProcessing} className="mt-4">
                    <PlayCircle className="h-4 w-4 mr-2" />
                    Start Processing
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {(isProcessing || isComplete) && (
            <ProcessingStatus
              videoId={videoId}
              onComplete={handleProcessingComplete}
              onError={handleProcessingError}
              autoRefresh={isProcessing}
            />
          )}

          {videoData?.status === 'ERROR' && (
            <Card>
              <CardContent className="p-6">
                <div className="flex items-start space-x-3 text-red-600">
                  <AlertCircle className="h-5 w-5 mt-0.5" />
                  <div>
                    <h3 className="font-medium">Processing Failed</h3>
                    <p className="text-sm mt-1">
                      There was an error processing your video. You can try processing again.
                    </p>
                    <Button
                      onClick={startProcessing}
                      variant="outline"
                      size="sm"
                      className="mt-3"
                    >
                      Retry Processing
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="clips" className="space-y-4">
          {isComplete ? (
            <ClipsPreview 
              videoId={videoId}
              videoUrl={videoData?.url}
              onClipApprove={(clipId, approved) => {
                console.log(`Clip ${clipId} ${approved ? 'approved' : 'rejected'}`);
              }}
              onClipExport={(clipId) => {
                console.log(`Clip ${clipId} exported`);
              }}
              onClipEdit={(clip) => {
                console.log('Edit clip:', clip);
              }}
              onSelectionChange={handleClipSelectionChange}
              selectedClips={context.selectedClips}
            />
          ) : (
            <Card>
              <CardContent className="p-6 text-center">
                <p className="text-gray-500">
                  Clips will be available after processing is complete.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="transcription" className="space-y-4">
          {videoData?.transcription ? (
            <Card>
              <CardHeader>
                <CardTitle>Transcription</CardTitle>
                <CardDescription>
                  Language: {videoData.transcription.language || 'Auto-detected'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="bg-gray-50 p-4 rounded-lg max-h-96 overflow-y-auto">
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">
                      {videoData.transcription.text}
                    </p>
                  </div>
                  <div className="flex justify-end">
                    <Button variant="outline" size="sm">
                      <Download className="h-4 w-4 mr-1" />
                      Download Transcript
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-6 text-center">
                <p className="text-gray-500">
                  Transcription will be available after processing is complete.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="chat" className="space-y-4">
          <Card className="bg-gradient-to-br from-blue-50/50 to-purple-50/50">
            <CardHeader className="pb-4">
              <div className="flex items-center space-x-2">
                <Bot className="h-5 w-5 text-blue-600" />
                <CardTitle className="text-blue-900">Claude AI Assistant</CardTitle>
              </div>
              <CardDescription>
                Ask Claude to help you find clips, create highlights, export content, or get suggestions for better engagement.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="h-96 relative">
                <ChatInterface 
                  conversationId={conversationId}
                  context={context}
                  onContextUpdate={handleChatContextUpdate}
                  className="static w-full h-full shadow-none border-0"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Floating Chat Interface (when not on chat tab) */}
      {activeTab !== 'chat' && isComplete && (
        <ChatInterface 
          conversationId={conversationId}
          context={context}
          onContextUpdate={handleChatContextUpdate}
        />
      )}
    </div>
  );
}

export function EnhancedProcessingDashboard(props: EnhancedProcessingDashboardProps) {
  return (
    <ChatContextManager videoId={props.videoId}>
      <DashboardContent {...props} />
    </ChatContextManager>
  );
}