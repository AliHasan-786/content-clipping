"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import { ChatContext, Video, Clip } from '@/types';

interface ChatContextManagerProps {
  children: React.ReactNode;
  videoId?: string;
  initialContext?: Partial<ChatContext>;
}

interface ChatContextState {
  context: ChatContext;
  updateContext: (update: Partial<ChatContext>) => void;
  setCurrentVideo: (video: Video) => void;
  selectClips: (clipIds: string[]) => void;
  clearSelectedClips: () => void;
  updatePreferences: (preferences: Partial<ChatContext['preferences']>) => void;
}

const ChatContextContext = createContext<ChatContextState | undefined>(undefined);

export function ChatContextManager({ 
  children, 
  videoId, 
  initialContext = {} 
}: ChatContextManagerProps) {
  const [context, setContext] = useState<ChatContext>({
    selectedClips: [],
    preferences: {
      exportFormat: 'mp4',
      resolution: '1080p',
      aspectRatio: '16:9'
    },
    ...initialContext
  });

  // Load video data when videoId changes
  useEffect(() => {
    if (videoId && videoId !== context.currentVideo?.id) {
      loadVideoContext(videoId);
    }
  }, [videoId]);

  const loadVideoContext = async (id: string) => {
    try {
      const response = await fetch(`/api/videos/${id}`);
      if (response.ok) {
        const { video } = await response.json();
        setCurrentVideo(video);
      }
    } catch (error) {
      console.error('Failed to load video context:', error);
    }
  };

  const updateContext = (update: Partial<ChatContext>) => {
    setContext(prev => ({
      ...prev,
      ...update
    }));
  };

  const setCurrentVideo = (video: Video) => {
    setContext(prev => ({
      ...prev,
      currentVideo: {
        id: video.id,
        title: video.title,
        duration: video.duration,
        processingStage: video.processingStage,
        clips: video.clips,
        transcription: video.transcription?.text
      },
      selectedClips: [] // Clear selected clips when changing videos
    }));
  };

  const selectClips = (clipIds: string[]) => {
    setContext(prev => ({
      ...prev,
      selectedClips: clipIds
    }));
  };

  const clearSelectedClips = () => {
    setContext(prev => ({
      ...prev,
      selectedClips: []
    }));
  };

  const updatePreferences = (preferences: Partial<ChatContext['preferences']>) => {
    setContext(prev => ({
      ...prev,
      preferences: {
        ...prev.preferences,
        ...preferences
      }
    }));
  };

  const value: ChatContextState = {
    context,
    updateContext,
    setCurrentVideo,
    selectClips,
    clearSelectedClips,
    updatePreferences
  };

  return (
    <ChatContextContext.Provider value={value}>
      {children}
    </ChatContextContext.Provider>
  );
}

export function useChatContext() {
  const context = useContext(ChatContextContext);
  if (context === undefined) {
    throw new Error('useChatContext must be used within a ChatContextManager');
  }
  return context;
}

// Hook for components that need to sync with chat context
export function useChatIntegration() {
  const chatContext = useChatContext();
  
  const handleClipSelect = (clips: Clip[] | string[]) => {
    const clipIds = Array.isArray(clips) 
      ? clips.map(clip => typeof clip === 'string' ? clip : clip.id)
      : clips;
    chatContext.selectClips(clipIds);
  };

  const handleVideoChange = (video: Video) => {
    chatContext.setCurrentVideo(video);
  };

  const handleFormatChange = (format: string, resolution?: string, aspectRatio?: string) => {
    chatContext.updatePreferences({
      exportFormat: format as any,
      ...(resolution && { resolution: resolution as any }),
      ...(aspectRatio && { aspectRatio: aspectRatio as any })
    });
  };

  return {
    context: chatContext.context,
    onClipSelect: handleClipSelect,
    onVideoChange: handleVideoChange,
    onFormatChange: handleFormatChange,
    selectClips: chatContext.selectClips,
    clearSelection: chatContext.clearSelectedClips
  };
}