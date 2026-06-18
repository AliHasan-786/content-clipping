"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Button } from './button';
import { Badge } from './badge';
import { 
  Heart, 
  MessageCircle, 
  Share2, 
  Eye, 
  Clock, 
  TrendingUp,
  TrendingDown,
  Users,
  PlayCircle,
  Pause,
  BarChart3,
  Activity,
  Target
} from 'lucide-react';

interface EngagementMetrics {
  overview: {
    totalEngagements: number;
    engagementRate: number;
    averageWatchTime: number;
    completionRate: number;
    retentionCurve: number[];
    socialShares: number;
    commentSentiment: number;
  };
  platformBreakdown: {
    [platform: string]: {
      likes: number;
      comments: number;
      shares: number;
      saves: number;
      views: number;
      engagementRate: number;
      bestPerformingContent: any[];
    };
  };
  engagementTrends: Array<{
    date: string;
    likes: number;
    comments: number;
    shares: number;
    views: number;
    engagementRate: number;
  }>;
  audienceInsights: {
    demographics: {
      ageGroups: { [key: string]: number };
      topCountries: { [key: string]: number };
      genderSplit: { male: number; female: number; other: number };
    };
    behaviorPatterns: {
      peakEngagementHours: number[];
      averageSessionDuration: number;
      returnViewerRate: number;
    };
  };
  contentPerformance: {
    topEngagingContent: any[];
    engagementByContentType: { [type: string]: number };
    optimalContentLength: { min: number; max: number; optimal: number };
  };
}

interface EngagementAnalyticsProps {
  className?: string;
  userId?: string;
  timeframe?: string;
  platforms?: string[];
}

export function EngagementAnalytics({ 
  className, 
  userId, 
  timeframe = 'month',
  platforms = []
}: EngagementAnalyticsProps) {
  const [data, setData] = useState<EngagementMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMetric, setSelectedMetric] = useState('engagement');

  useEffect(() => {
    loadEngagementData();
  }, [timeframe, platforms]);

  const loadEngagementData = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        type: 'engagement',
        timeframe,
        ...(platforms.length > 0 && { platforms: platforms.join(',') })
      });

      const response = await fetch(`/api/analytics?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch engagement data');
      }

      // For demo purposes, using mock data
      const mockData = generateMockEngagementData();
      setData(mockData);

    } catch (err) {
      console.error('Error loading engagement data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load engagement data');
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  };

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center space-y-4">
          <Activity className="h-8 w-8 animate-pulse text-blue-500" />
          <p className="text-gray-500">Loading engagement analytics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center space-y-4">
          <p className="text-red-600">{error}</p>
          <Button onClick={loadEngagementData} variant="outline">
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Engagement Analytics</h2>
        <p className="text-gray-500">
          Deep dive into how your audience interacts with your content
        </p>
      </div>

      {/* Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Engagements</CardTitle>
            <Activity className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {formatNumber(data.overview.totalEngagements)}
            </div>
            <p className="text-xs text-gray-500">
              Across all content and platforms
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Engagement Rate</CardTitle>
            <Target className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {data.overview.engagementRate.toFixed(1)}%
            </div>
            <div className="flex items-center space-x-1 text-xs">
              {data.overview.engagementRate > 3 ? (
                <TrendingUp className="h-3 w-3 text-green-500" />
              ) : (
                <TrendingDown className="h-3 w-3 text-red-500" />
              )}
              <span className={data.overview.engagementRate > 3 ? 'text-green-600' : 'text-red-600'}>
                {data.overview.engagementRate > 3 ? 'Above average' : 'Below average'}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Watch Time</CardTitle>
            <Clock className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {formatTime(data.overview.averageWatchTime)}
            </div>
            <p className="text-xs text-gray-500">
              {data.overview.completionRate.toFixed(1)}% completion rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Social Shares</CardTitle>
            <Share2 className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {formatNumber(data.overview.socialShares)}
            </div>
            <p className="text-xs text-gray-500">
              Organic reach amplification
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Engagement Breakdown */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Platform Engagement */}
        <Card>
          <CardHeader>
            <CardTitle>Engagement by Platform</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(data.platformBreakdown).map(([platform, metrics]) => (
                <div key={platform} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-medium capitalize">{platform}</h4>
                    <Badge variant="outline">
                      {metrics.engagementRate.toFixed(1)}%
                    </Badge>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="flex items-center space-x-2">
                      <Heart className="h-4 w-4 text-red-500" />
                      <span>{formatNumber(metrics.likes)} likes</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <MessageCircle className="h-4 w-4 text-blue-500" />
                      <span>{formatNumber(metrics.comments)} comments</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Share2 className="h-4 w-4 text-green-500" />
                      <span>{formatNumber(metrics.shares)} shares</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Eye className="h-4 w-4 text-purple-500" />
                      <span>{formatNumber(metrics.views)} views</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Content Performance */}
        <Card>
          <CardHeader>
            <CardTitle>Top Engaging Content</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.contentPerformance.topEngagingContent.map((content, idx) => (
                <div key={content.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center space-x-3">
                    <Badge variant="default" className="bg-blue-100 text-blue-800">
                      #{idx + 1}
                    </Badge>
                    <div>
                      <p className="font-medium text-sm truncate max-w-xs">
                        {content.title || 'Untitled'}
                      </p>
                      <div className="flex items-center space-x-4 text-xs text-gray-500">
                        <span className="flex items-center space-x-1">
                          <Heart className="h-3 w-3" />
                          <span>{formatNumber(content.likes)}</span>
                        </span>
                        <span className="flex items-center space-x-1">
                          <MessageCircle className="h-3 w-3" />
                          <span>{formatNumber(content.comments)}</span>
                        </span>
                        <span className="flex items-center space-x-1">
                          <Share2 className="h-3 w-3" />
                          <span>{formatNumber(content.shares)}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-green-600 text-sm">
                      {content.engagementRate.toFixed(1)}%
                    </p>
                    <p className="text-xs text-gray-500">engagement</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Analytics */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Audience Demographics */}
        <Card>
          <CardHeader>
            <CardTitle>Audience Demographics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium mb-2">Age Groups</h4>
                <div className="space-y-2">
                  {Object.entries(data.audienceInsights.demographics.ageGroups).map(([age, percentage]) => (
                    <div key={age} className="flex items-center justify-between">
                      <span className="text-sm">{age}</span>
                      <div className="flex items-center space-x-2">
                        <div className="w-20 bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-blue-500 h-2 rounded-full" 
                            style={{ width: `${percentage}%` }}
                          ></div>
                        </div>
                        <span className="text-sm font-medium">{percentage}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-2">Top Countries</h4>
                <div className="space-y-2">
                  {Object.entries(data.audienceInsights.demographics.topCountries).slice(0, 3).map(([country, percentage]) => (
                    <div key={country} className="flex items-center justify-between">
                      <span className="text-sm">{country}</span>
                      <span className="text-sm font-medium">{percentage}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Behavior Patterns */}
        <Card>
          <CardHeader>
            <CardTitle>Behavior Patterns</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium mb-2">Peak Engagement Hours</h4>
                <div className="grid grid-cols-6 gap-1 text-xs">
                  {Array.from({ length: 24 }, (_, hour) => {
                    const isPeak = data.audienceInsights.behaviorPatterns.peakEngagementHours.includes(hour);
                    return (
                      <div
                        key={hour}
                        className={`p-1 rounded text-center ${
                          isPeak ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {hour}h
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-2">Session Metrics</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Avg Session Duration</span>
                    <span className="text-sm font-medium">
                      {formatTime(data.audienceInsights.behaviorPatterns.averageSessionDuration)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Return Viewer Rate</span>
                    <span className="text-sm font-medium">
                      {data.audienceInsights.behaviorPatterns.returnViewerRate.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Content Optimization */}
        <Card>
          <CardHeader>
            <CardTitle>Content Optimization</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium mb-2">Optimal Content Length</h4>
                <div className="bg-green-50 rounded-lg p-3">
                  <div className="text-center">
                    <p className="text-lg font-bold text-green-600">
                      {formatTime(data.contentPerformance.optimalContentLength.optimal)}
                    </p>
                    <p className="text-xs text-green-700">Sweet spot duration</p>
                  </div>
                  <div className="flex justify-between text-xs text-gray-600 mt-2">
                    <span>Min: {formatTime(data.contentPerformance.optimalContentLength.min)}</span>
                    <span>Max: {formatTime(data.contentPerformance.optimalContentLength.max)}</span>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-2">Engagement by Content Type</h4>
                <div className="space-y-2">
                  {Object.entries(data.contentPerformance.engagementByContentType).map(([type, rate]) => (
                    <div key={type} className="flex items-center justify-between">
                      <span className="text-sm capitalize">{type}</span>
                      <span className="text-sm font-medium">{rate.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Retention Analysis */}
      <Card>
        <CardHeader>
          <CardTitle>Audience Retention Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center border border-gray-200 rounded-lg">
            <div className="text-center">
              <BarChart3 className="h-12 w-12 mx-auto mb-2 text-gray-400" />
              <p className="text-gray-500">Retention curve visualization would be rendered here</p>
              <p className="text-xs text-gray-400">Shows audience drop-off throughout video duration</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Mock data generator for demo purposes
function generateMockEngagementData(): EngagementMetrics {
  return {
    overview: {
      totalEngagements: 127500,
      engagementRate: 4.2,
      averageWatchTime: 185, // 3:05
      completionRate: 68.5,
      retentionCurve: Array.from({ length: 100 }, (_, i) => 100 - i * 0.5),
      socialShares: 8750,
      commentSentiment: 0.75 // 75% positive
    },
    platformBreakdown: {
      youtube: {
        likes: 45000,
        comments: 12000,
        shares: 3500,
        saves: 8000,
        views: 850000,
        engagementRate: 5.1,
        bestPerformingContent: []
      },
      tiktok: {
        likes: 78000,
        comments: 15600,
        shares: 23000,
        saves: 12000,
        views: 1200000,
        engagementRate: 6.8,
        bestPerformingContent: []
      },
      instagram: {
        likes: 32000,
        comments: 8500,
        shares: 4200,
        saves: 15000,
        views: 680000,
        engagementRate: 4.7,
        bestPerformingContent: []
      }
    },
    engagementTrends: Array.from({ length: 30 }, (_, i) => ({
      date: new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      likes: 1000 + Math.random() * 2000,
      comments: 200 + Math.random() * 400,
      shares: 100 + Math.random() * 200,
      views: 10000 + Math.random() * 20000,
      engagementRate: 3 + Math.random() * 3
    })),
    audienceInsights: {
      demographics: {
        ageGroups: {
          '18-24': 32,
          '25-34': 28,
          '35-44': 22,
          '45-54': 12,
          '55+': 6
        },
        topCountries: {
          'United States': 35,
          'United Kingdom': 18,
          'Canada': 12,
          'Australia': 8,
          'Germany': 6
        },
        genderSplit: {
          male: 52,
          female: 46,
          other: 2
        }
      },
      behaviorPatterns: {
        peakEngagementHours: [12, 15, 18, 19, 20, 21],
        averageSessionDuration: 165, // 2:45
        returnViewerRate: 23.5
      }
    },
    contentPerformance: {
      topEngagingContent: [
        {
          id: '1',
          title: 'Amazing productivity hack that changed my life',
          likes: 15600,
          comments: 892,
          shares: 1240,
          engagementRate: 8.2
        },
        {
          id: '2',
          title: 'Behind the scenes of viral content creation',
          likes: 12400,
          comments: 567,
          shares: 890,
          engagementRate: 7.1
        },
        {
          id: '3',
          title: 'Day in the life of a content creator',
          likes: 9800,
          comments: 423,
          shares: 650,
          engagementRate: 6.4
        }
      ],
      engagementByContentType: {
        'tutorial': 7.2,
        'entertainment': 5.8,
        'lifestyle': 4.9,
        'educational': 6.1,
        'behind-the-scenes': 5.3
      },
      optimalContentLength: {
        min: 45,
        max: 300,
        optimal: 120
      }
    }
  };
}