"use client";

import React, { useState, useEffect } from 'react';
import { ProcessingDashboard } from '@/components/ui/processing-dashboard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface VideoData {
  id: string;
  title: string;
  status: string;
  processingStage?: string;
  thumbnail?: string;
  url: string;
  duration?: number;
}

export default function ProcessingPage() {
  const params = useParams();
  const videoId = params.id as string;
  const [videoData, setVideoData] = useState<VideoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchVideoData = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/videos/${videoId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch video data');
      }

      setVideoData(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (videoId) {
      fetchVideoData();
    }
  }, [videoId]);

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center space-x-2 mb-6">
          <Link href="/">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Processing Video</h1>
        </div>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span>Loading video information...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !videoData) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center space-x-2 mb-6">
          <Link href="/">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Processing Video</h1>
        </div>
        
        <Card>
          <CardContent className="p-6 text-center">
            <div className="space-y-4">
              <p className="text-red-600">
                Error: {error || 'Video not found'}
              </p>
              <Button 
                onClick={fetchVideoData}
                variant="outline"
                size="sm"
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-2">
          <Link href="/">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Video Processing</h1>
        </div>
        
        <Button 
          onClick={fetchVideoData}
          variant="outline"
          size="sm"
        >
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>
      </div>

      {/* Processing Dashboard */}
      <ProcessingDashboard 
        videoId={videoId}
        initialVideoData={videoData}
      />
    </div>
  );
}