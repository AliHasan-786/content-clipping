"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Play, 
  Pause, 
  Download, 
  Check, 
  X, 
  Star, 
  Clock, 
  Tag,
  Edit,
  Eye,
  RefreshCw
} from 'lucide-react';
import { formatDuration } from '@/lib/utils';

interface Clip {
  id: string;
  title: string;
  description?: string;
  startTime: number;
  endTime: number;
  duration: number;
  score?: number;
  confidence?: number;
  reason?: string;
  tags: string[];
  approved: boolean;
  exported: boolean;
  exportUrl?: string;
  createdAt: string;
}

interface ClipsPreviewProps {
  videoId: string;
  videoUrl?: string;
  onClipApprove?: (clipId: string, approved: boolean) => void;
  onClipExport?: (clipId: string) => void;
  onClipEdit?: (clip: Clip) => void;
  onSelectionChange?: (selectedClipIds: string[]) => void;
  selectedClips?: string[];
}

export function ClipsPreview({ 
  videoId, 
  videoUrl,
  onClipApprove,
  onClipExport,
  onClipEdit,
  onSelectionChange,
  selectedClips = []
}: ClipsPreviewProps) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [stats, setStats] = useState({
    totalClips: 0,
    averageScore: 0,
    approvedClips: 0,
    exportedClips: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [filterApproved, setFilterApproved] = useState<'all' | 'approved' | 'pending'>('all');

  const handleClipSelection = (clipId: string, isSelected: boolean) => {
    if (!onSelectionChange) return;
    
    let newSelection: string[];
    if (isSelected) {
      newSelection = [...selectedClips, clipId];
    } else {
      newSelection = selectedClips.filter(id => id !== clipId);
    }
    onSelectionChange(newSelection);
  };

  const handleSelectAll = () => {
    if (!onSelectionChange) return;
    
    const visibleClipIds = clips.map(clip => clip.id);
    if (selectedClips.length === visibleClipIds.length) {
      onSelectionChange([]); // Deselect all
    } else {
      onSelectionChange(visibleClipIds); // Select all visible
    }
  };

  const fetchClips = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ videoId });
      
      if (filterApproved === 'approved') {
        params.set('approved', 'true');
      } else if (filterApproved === 'pending') {
        params.set('approved', 'false');
      }

      const response = await fetch(`/api/clips/generate?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch clips');
      }

      setClips(data.clips || []);
      setStats(data.stats || {});
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClips();
  }, [videoId, filterApproved]);

  const handleApprovalToggle = async (clipId: string, currentApproval: boolean) => {
    try {
      const response = await fetch('/api/clips/generate', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clipId,
          approved: !currentApproval,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update clip');
      }

      // Update local state
      setClips(clips.map(clip => 
        clip.id === clipId 
          ? { ...clip, approved: !currentApproval }
          : clip
      ));

      if (onClipApprove) {
        onClipApprove(clipId, !currentApproval);
      }
    } catch (err) {
      console.error('Failed to update clip approval:', err);
    }
  };

  const handleExport = async (clipId: string) => {
    try {
      const response = await fetch('/api/clips/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clipId,
          format: 'mp4',
          quality: 'medium',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to export clip');
      }

      const data = await response.json();
      
      // Update local state
      setClips(clips.map(clip => 
        clip.id === clipId 
          ? { ...clip, exported: true, exportUrl: data.clip.exportUrl }
          : clip
      ));

      if (onClipExport) {
        onClipExport(clipId);
      }
    } catch (err) {
      console.error('Failed to export clip:', err);
    }
  };

  const getScoreColor = (score?: number) => {
    if (!score) return 'bg-gray-500';
    if (score >= 4) return 'bg-green-500';
    if (score >= 3) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getScoreLabel = (score?: number) => {
    if (!score) return 'Unknown';
    if (score >= 4) return 'High';
    if (score >= 3) return 'Medium';
    return 'Low';
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center space-x-2">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span>Loading clips...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-red-600">
            <p>Error loading clips: {error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchClips}
              className="mt-2"
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <Card>
        <CardHeader>
          <CardTitle>Generated Clips</CardTitle>
          <CardDescription>
            {stats.totalClips} clips detected with average quality score of {stats.averageScore.toFixed(1)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{stats.totalClips}</div>
              <div className="text-sm text-gray-500">Total Clips</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{stats.approvedClips}</div>
              <div className="text-sm text-gray-500">Approved</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{stats.exportedClips}</div>
              <div className="text-sm text-gray-500">Exported</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{stats.averageScore.toFixed(1)}</div>
              <div className="text-sm text-gray-500">Avg Score</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filter Controls */}
      <div className="flex space-x-2">
        <Button
          variant={filterApproved === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilterApproved('all')}
        >
          All Clips
        </Button>
        <Button
          variant={filterApproved === 'approved' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilterApproved('approved')}
        >
          Approved
        </Button>
        <Button
          variant={filterApproved === 'pending' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilterApproved('pending')}
        >
          Pending
        </Button>
      </div>

      {/* Clips Grid */}
      {clips.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-gray-500">No clips found for the current filter.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {clips.map((clip) => (
            <Card 
              key={clip.id} 
              className={`transition-all hover:shadow-md ${
                clip.approved ? 'ring-2 ring-green-200' : ''
              }`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-sm line-clamp-2">
                      {clip.title}
                    </CardTitle>
                    {clip.description && (
                      <CardDescription className="text-xs line-clamp-2 mt-1">
                        {clip.description}
                      </CardDescription>
                    )}
                  </div>
                  {clip.score && (
                    <Badge 
                      variant="outline" 
                      className={`ml-2 ${getScoreColor(clip.score)} text-white border-0`}
                    >
                      {getScoreLabel(clip.score)}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Clip Info */}
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <div className="flex items-center space-x-1">
                    <Clock className="h-3 w-3" />
                    <span>{formatDuration(clip.startTime)} - {formatDuration(clip.endTime)}</span>
                  </div>
                  <span>{formatDuration(clip.duration)}</span>
                </div>

                {/* Tags */}
                {clip.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {clip.tags.slice(0, 3).map((tag) => (
                      <Badge 
                        key={tag} 
                        variant="secondary" 
                        className="text-xs"
                      >
                        {tag}
                      </Badge>
                    ))}
                    {clip.tags.length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{clip.tags.length - 3}
                      </Badge>
                    )}
                  </div>
                )}

                {/* Quality Score */}
                {clip.score && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span>Quality Score</span>
                      <span>{clip.score.toFixed(1)}/5</span>
                    </div>
                    <Progress value={(clip.score / 5) * 100} className="h-1" />
                  </div>
                )}

                {/* Reason */}
                {clip.reason && (
                  <p className="text-xs text-gray-600 line-clamp-2">
                    {clip.reason}
                  </p>
                )}

                {/* Actions */}
                <div className="flex space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleApprovalToggle(clip.id, clip.approved)}
                    className={`flex-1 ${
                      clip.approved 
                        ? 'bg-green-50 text-green-700 hover:bg-green-100' 
                        : ''
                    }`}
                  >
                    {clip.approved ? (
                      <>
                        <Check className="h-3 w-3 mr-1" />
                        Approved
                      </>
                    ) : (
                      <>
                        <Eye className="h-3 w-3 mr-1" />
                        Review
                      </>
                    )}
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleExport(clip.id)}
                    disabled={clip.exported}
                  >
                    {clip.exported ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Download className="h-3 w-3" />
                    )}
                  </Button>

                  {onClipEdit && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onClipEdit(clip)}
                    >
                      <Edit className="h-3 w-3" />
                    </Button>
                  )}
                </div>

                {/* Export Status */}
                {clip.exported && clip.exportUrl && (
                  <div className="bg-green-50 border border-green-200 rounded p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-green-700">Exported</span>
                      <a
                        href={clip.exportUrl}
                        download
                        className="text-xs text-green-600 hover:underline"
                      >
                        Download
                      </a>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
