"use client";

import React, { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { ProcessingStatus } from './processing-status';
import { ClipsPreview } from './clips-preview';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, CheckCircle2, PlayCircle, Settings, Download } from 'lucide-react';

interface ProcessingDashboardProps {
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
}

export function ProcessingDashboard({ 
  videoId, 
  initialVideoData 
}: ProcessingDashboardProps) {
  const [videoData, setVideoData] = useState<VideoData | null>(initialVideoData || null);
  const [activeTab, setActiveTab] = useState<'status' | 'clips' | 'transcription'>('status');
  const [processingComplete, setProcessingComplete] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

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

  return (
    <div className="space-y-6">
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
              </div>
            </div>
          </CardHeader>
        </Card>
      )}

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)}>
        <TabsList className="grid w-full grid-cols-3">
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
      </Tabs>
    </div>
  );
}