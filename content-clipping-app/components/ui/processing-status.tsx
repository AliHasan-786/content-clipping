"use client";

import React, { useState, useEffect } from 'react';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle2, Clock, PlayCircle, RefreshCw, X } from 'lucide-react';

interface ProcessingStage {
  key: string;
  label: string;
  description: string;
  completed: boolean;
}

interface ProcessingStatusProps {
  videoId: string;
  onComplete?: (video: any) => void;
  onError?: (error: string) => void;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface VideoProcessingStatus {
  id: string;
  title: string;
  status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'ERROR';
  processingStage: string;
  processingProgress: number;
  errorMessage?: string;
  stages: {
    metadataExtracted: boolean;
    thumbnailGenerated: boolean;
    audioExtracted: boolean;
    transcriptionCompleted: boolean;
    clipsGenerated: boolean;
  };
  transcription?: {
    id: string;
    language: string;
  };
  clipsCount: number;
  approvedClipsCount: number;
  lastUpdated: string;
}

export function ProcessingStatus({
  videoId,
  onComplete,
  onError,
  autoRefresh = true,
  refreshInterval = 3000
}: ProcessingStatusProps) {
  const [status, setStatus] = useState<VideoProcessingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const response = await fetch(`/api/process?videoId=${videoId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch status');
      }

      const newStatus = data.video;
      setStatus(newStatus);
      setError(null);

      // Check for completion or error
      if (newStatus.status === 'READY' && onComplete) {
        onComplete(newStatus);
      } else if (newStatus.status === 'ERROR' && onError) {
        onError(newStatus.errorMessage || 'Processing failed');
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      if (onError) {
        onError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();

    if (autoRefresh) {
      const interval = setInterval(() => {
        if (status?.status === 'PROCESSING') {
          fetchStatus();
        }
      }, refreshInterval);

      return () => clearInterval(interval);
    }
  }, [videoId, autoRefresh, refreshInterval, status?.status]);

  const getProcessingStages = (): ProcessingStage[] => {
    if (!status) return [];

    return [
      {
        key: 'metadataExtracted',
        label: 'Extract Metadata',
        description: 'Analyzing video properties and duration',
        completed: status.stages.metadataExtracted,
      },
      {
        key: 'thumbnailGenerated',
        label: 'Generate Thumbnail',
        description: 'Creating video preview image',
        completed: status.stages.thumbnailGenerated,
      },
      {
        key: 'audioExtracted',
        label: 'Extract Audio',
        description: 'Preparing audio for transcription',
        completed: status.stages.audioExtracted,
      },
      {
        key: 'transcriptionCompleted',
        label: 'Transcribe Audio',
        description: 'Converting speech to text with timestamps',
        completed: status.stages.transcriptionCompleted,
      },
      {
        key: 'clipsGenerated',
        label: 'Generate Clips',
        description: 'Identifying and creating potential clips',
        completed: status.stages.clipsGenerated,
      },
    ];
  };

  const getStatusIcon = (stage: ProcessingStage, isActive: boolean) => {
    if (stage.completed) {
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    } else if (isActive) {
      return <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />;
    } else {
      return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusBadge = () => {
    if (!status) return null;

    switch (status.status) {
      case 'PROCESSING':
        return <Badge variant="default" className="bg-blue-500">Processing</Badge>;
      case 'READY':
        return <Badge variant="default" className="bg-green-500">Ready</Badge>;
      case 'ERROR':
        return <Badge variant="destructive">Error</Badge>;
      case 'UPLOADING':
        return <Badge variant="secondary">Uploading</Badge>;
      default:
        return <Badge variant="outline">{status.status}</Badge>;
    }
  };

  const getCurrentStageIndex = (): number => {
    if (!status) return -1;
    
    const stages = getProcessingStages();
    for (let i = 0; i < stages.length; i++) {
      if (!stages[i].completed) {
        return i;
      }
    }
    return stages.length - 1;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center space-x-2">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span>Loading processing status...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center space-x-2 text-red-600">
            <AlertCircle className="h-4 w-4" />
            <span>Error: {error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchStatus}
              className="ml-auto"
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!status) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-gray-500">
            No processing status available
          </div>
        </CardContent>
      </Card>
    );
  }

  const stages = getProcessingStages();
  const currentStageIndex = getCurrentStageIndex();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">{status.title}</CardTitle>
            <CardDescription>Processing Status</CardDescription>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Overall Progress</span>
            <span>{status.processingProgress}%</span>
          </div>
          <Progress 
            value={status.processingProgress} 
            className="w-full" 
          />
        </div>

        {/* Error Message */}
        {status.status === 'ERROR' && status.errorMessage && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <div className="flex items-start space-x-2">
              <AlertCircle className="h-4 w-4 text-red-500 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">Processing Error</p>
                <p className="text-sm text-red-600">{status.errorMessage}</p>
              </div>
            </div>
          </div>
        )}

        {/* Processing Stages */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Processing Stages</h4>
          <div className="space-y-2">
            {stages.map((stage, index) => {
              const isActive = index === currentStageIndex && status.status === 'PROCESSING';
              const isCompleted = stage.completed;

              return (
                <div
                  key={stage.key}
                  className={`flex items-center space-x-3 p-2 rounded-lg transition-colors ${
                    isActive 
                      ? 'bg-blue-50 border border-blue-200' 
                      : isCompleted
                      ? 'bg-green-50 border border-green-200'
                      : 'bg-gray-50'
                  }`}
                >
                  {getStatusIcon(stage, isActive)}
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${
                      isCompleted ? 'text-green-700' : isActive ? 'text-blue-700' : 'text-gray-600'
                    }`}>
                      {stage.label}
                    </p>
                    <p className={`text-xs ${
                      isCompleted ? 'text-green-600' : isActive ? 'text-blue-600' : 'text-gray-500'
                    }`}>
                      {stage.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Results Summary */}
        {status.status === 'READY' && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-start space-x-2">
              <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-green-800">Processing Complete</p>
                <div className="mt-2 space-y-1 text-sm text-green-700">
                  {status.transcription && (
                    <p>• Transcription completed ({status.transcription.language || 'auto-detected'})</p>
                  )}
                  {status.clipsCount > 0 && (
                    <p>• {status.clipsCount} clips generated ({status.approvedClipsCount} approved)</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-between pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchStatus}
            disabled={loading}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>

          {status.status === 'READY' && status.clipsCount > 0 && (
            <Button size="sm">
              <PlayCircle className="h-4 w-4 mr-1" />
              View Clips
            </Button>
          )}
        </div>

        {/* Last Updated */}
        <p className="text-xs text-gray-500 text-center">
          Last updated: {new Date(status.lastUpdated).toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}