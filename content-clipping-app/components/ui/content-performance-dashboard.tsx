"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Button } from './button';
import { Badge } from './badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { 
  TrendingUp, 
  TrendingDown, 
  Eye, 
  Clock, 
  BarChart3,
  Star,
  AlertCircle,
  CheckCircle,
  Filter,
  Search,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  Play,
  MessageSquare,
  Share,
  Heart,
  Bookmark,
  ExternalLink
} from 'lucide-react';

interface ContentPerformanceData {
  overview: {
    totalContent: number;
    averageViews: number;
    averageEngagement: number;
    viralThreshold: number;
    topPerformerGrowth: number;
  };
  contentList: Array<{
    id: string;
    title: string;
    platform: string;
    publishedAt: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    duration: number;
    engagementRate: number;
    revenue: number;
    status: 'viral' | 'trending' | 'steady' | 'declining' | 'underperforming';
    tags: string[];
    thumbnailUrl?: string;
  }>;
  trends: {
    trending: any[];
    viral: any[];
    declining: any[];
    opportunities: any[];
  };
  insights: {
    bestPerformingTags: Array<{ tag: string; avgViews: number; count: number }>;
    optimalPostingTimes: Array<{ hour: number; day: string; performance: number }>;
    contentTypes: Array<{ type: string; performance: number; count: number }>;
    platformComparison: Array<{ platform: string; avgEngagement: number; avgViews: number }>;
  };
}

interface ContentPerformanceDashboardProps {
  className?: string;
  timeframe?: string;
  platforms?: string[];
}

export function ContentPerformanceDashboard({ 
  className,
  timeframe = 'month',
  platforms = []
}: ContentPerformanceDashboardProps) {
  const [data, setData] = useState<ContentPerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'views' | 'engagement' | 'revenue' | 'recent'>('views');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadContentPerformanceData();
  }, [timeframe, platforms]);

  const loadContentPerformanceData = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        type: 'content',
        timeframe,
        ...(platforms.length > 0 && { platforms: platforms.join(',') })
      });

      const response = await fetch(`/api/analytics?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch content performance data');
      }

      // For demo purposes, using mock data
      const mockData = generateMockContentData();
      setData(mockData);

    } catch (err) {
      console.error('Error loading content performance data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load content performance data');
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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'viral':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'trending':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'steady':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'declining':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'underperforming':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'viral':
        return <Star className="h-3 w-3" />;
      case 'trending':
        return <TrendingUp className="h-3 w-3" />;
      case 'steady':
        return <CheckCircle className="h-3 w-3" />;
      case 'declining':
        return <TrendingDown className="h-3 w-3" />;
      case 'underperforming':
        return <AlertCircle className="h-3 w-3" />;
      default:
        return null;
    }
  };

  const filteredAndSortedContent = React.useMemo(() => {
    if (!data) return [];

    let filtered = data.contentList;

    // Apply status filter
    if (filterStatus !== 'all') {
      filtered = filtered.filter(content => content.status === filterStatus);
    }

    // Apply search filter
    if (searchTerm) {
      filtered = filtered.filter(content => 
        content.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        content.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }

    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'views':
          return b.views - a.views;
        case 'engagement':
          return b.engagementRate - a.engagementRate;
        case 'revenue':
          return b.revenue - a.revenue;
        case 'recent':
          return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
        default:
          return 0;
      }
    });

    return filtered;
  }, [data, filterStatus, searchTerm, sortBy]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center space-y-4">
          <BarChart3 className="h-8 w-8 animate-pulse text-blue-500" />
          <p className="text-gray-500">Loading content performance...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center space-y-4">
          <p className="text-red-600">{error}</p>
          <Button onClick={loadContentPerformanceData} variant="outline">
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
        <h2 className="text-2xl font-bold tracking-tight">Content Performance</h2>
        <p className="text-gray-500">
          Analyze individual content performance and identify trends
        </p>
      </div>

      {/* Overview Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Content</CardTitle>
            <Play className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {data.overview.totalContent}
            </div>
            <p className="text-xs text-gray-500">
              Pieces published this {timeframe}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Views</CardTitle>
            <Eye className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatNumber(data.overview.averageViews)}
            </div>
            <div className="flex items-center space-x-1 text-xs">
              <ArrowUpRight className="h-3 w-3 text-green-500" />
              <span className="text-green-600">
                +{data.overview.topPerformerGrowth.toFixed(1)}%
              </span>
              <span className="text-gray-500">vs last period</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Engagement</CardTitle>
            <Heart className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {data.overview.averageEngagement.toFixed(1)}%
            </div>
            <p className="text-xs text-gray-500">
              Across all platforms
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Viral Threshold</CardTitle>
            <Star className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {formatNumber(data.overview.viralThreshold)}
            </div>
            <p className="text-xs text-gray-500">
              Views needed for viral status
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="content-list" className="space-y-4">
        <TabsList>
          <TabsTrigger value="content-list">Content List</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
        </TabsList>

        <TabsContent value="content-list" className="space-y-4">
          {/* Filters and Search */}
          <div className="flex flex-col space-y-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
            <div className="flex flex-col space-y-2 sm:flex-row sm:items-center sm:space-y-0 sm:space-x-4">
              <div className="relative">
                <Search className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search content..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Status</option>
                <option value="viral">Viral</option>
                <option value="trending">Trending</option>
                <option value="steady">Steady</option>
                <option value="declining">Declining</option>
                <option value="underperforming">Underperforming</option>
              </select>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="views">Sort by Views</option>
                <option value="engagement">Sort by Engagement</option>
                <option value="revenue">Sort by Revenue</option>
                <option value="recent">Sort by Recent</option>
              </select>
            </div>

            <div className="text-sm text-gray-500">
              Showing {filteredAndSortedContent.length} of {data.contentList.length} content pieces
            </div>
          </div>

          {/* Content List */}
          <div className="space-y-4">
            {filteredAndSortedContent.map((content) => (
              <Card key={content.id}>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-2">
                        <h3 className="font-semibold text-lg truncate">
                          {content.title}
                        </h3>
                        <Badge 
                          className={`${getStatusColor(content.status)} flex items-center space-x-1`}
                        >
                          {getStatusIcon(content.status)}
                          <span>{content.status}</span>
                        </Badge>
                      </div>

                      <div className="flex items-center space-x-4 text-sm text-gray-500 mb-4">
                        <span className="capitalize">{content.platform}</span>
                        <span>{new Date(content.publishedAt).toLocaleDateString()}</span>
                        <span>{formatDuration(content.duration)}</span>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                        <div className="flex items-center space-x-2">
                          <Eye className="h-4 w-4 text-blue-500" />
                          <span className="text-sm font-medium">
                            {formatNumber(content.views)}
                          </span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Heart className="h-4 w-4 text-red-500" />
                          <span className="text-sm font-medium">
                            {formatNumber(content.likes)}
                          </span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <MessageSquare className="h-4 w-4 text-blue-500" />
                          <span className="text-sm font-medium">
                            {formatNumber(content.comments)}
                          </span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Share className="h-4 w-4 text-green-500" />
                          <span className="text-sm font-medium">
                            {formatNumber(content.shares)}
                          </span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className="text-sm font-medium text-green-600">
                            {formatCurrency(content.revenue)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="text-sm text-gray-500">Engagement:</span>
                          <span className="text-sm font-semibold text-blue-600">
                            {content.engagementRate.toFixed(1)}%
                          </span>
                        </div>

                        <div className="flex items-center space-x-2">
                          {content.tags.slice(0, 3).map((tag) => (
                            <Badge key={tag} variant="outline" className="text-xs">
                              #{tag}
                            </Badge>
                          ))}
                          {content.tags.length > 3 && (
                            <span className="text-xs text-gray-500">
                              +{content.tags.length - 3} more
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="ml-4">
                      <Button variant="outline" size="sm">
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {filteredAndSortedContent.length === 0 && (
              <div className="text-center py-12">
                <Search className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No content found</h3>
                <p className="text-gray-500">
                  Try adjusting your search terms or filters
                </p>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="trends" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Trending Content */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <TrendingUp className="h-5 w-5 text-green-500" />
                  <span>Trending Content</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.trends.trending.map((content, idx) => (
                    <div key={content.id} className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                      <div>
                        <p className="font-medium text-sm">{content.title}</p>
                        <p className="text-xs text-gray-500">{content.platform}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-green-600">
                          +{content.growth.toFixed(1)}%
                        </p>
                        <p className="text-xs text-gray-500">growth</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Viral Content */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Star className="h-5 w-5 text-purple-500" />
                  <span>Viral Content</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.trends.viral.map((content) => (
                    <div key={content.id} className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
                      <div>
                        <p className="font-medium text-sm">{content.title}</p>
                        <p className="text-xs text-gray-500">{content.platform}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-purple-600">
                          {formatNumber(content.views)}
                        </p>
                        <p className="text-xs text-gray-500">views</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Declining Content */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <TrendingDown className="h-5 w-5 text-red-500" />
                  <span>Declining Content</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.trends.declining.map((content) => (
                    <div key={content.id} className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                      <div>
                        <p className="font-medium text-sm">{content.title}</p>
                        <p className="text-xs text-gray-500">{content.platform}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-red-600">
                          {content.decline.toFixed(1)}%
                        </p>
                        <p className="text-xs text-gray-500">decline</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Opportunities */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <AlertCircle className="h-5 w-5 text-orange-500" />
                  <span>Opportunities</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.trends.opportunities.map((opportunity, idx) => (
                    <div key={idx} className="p-3 bg-orange-50 rounded-lg">
                      <p className="font-medium text-sm text-orange-800">
                        {opportunity.title}
                      </p>
                      <p className="text-xs text-orange-600 mt-1">
                        {opportunity.suggestion}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="insights" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Best Performing Tags */}
            <Card>
              <CardHeader>
                <CardTitle>Best Performing Tags</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.insights.bestPerformingTags.map((tag, idx) => (
                    <div key={tag.tag} className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Badge variant="outline">#{tag.tag}</Badge>
                        <span className="text-sm text-gray-500">({tag.count} uses)</span>
                      </div>
                      <span className="text-sm font-semibold">
                        {formatNumber(tag.avgViews)} avg views
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Platform Comparison */}
            <Card>
              <CardHeader>
                <CardTitle>Platform Comparison</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.insights.platformComparison.map((platform) => (
                    <div key={platform.platform} className="flex items-center justify-between">
                      <span className="font-medium capitalize">{platform.platform}</span>
                      <div className="text-right">
                        <p className="text-sm font-semibold">
                          {platform.avgEngagement.toFixed(1)}% engagement
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatNumber(platform.avgViews)} avg views
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Optimal Posting Times */}
            <Card>
              <CardHeader>
                <CardTitle>Optimal Posting Times</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.insights.optimalPostingTimes.map((time) => (
                    <div key={`${time.day}-${time.hour}`} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <span className="text-sm">{time.day} at {time.hour}:00</span>
                      <div className="flex items-center space-x-2">
                        <div className="w-20 bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-blue-500 h-2 rounded-full" 
                            style={{ width: `${time.performance}%` }}
                          ></div>
                        </div>
                        <span className="text-sm font-medium">{time.performance}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Content Types Performance */}
            <Card>
              <CardHeader>
                <CardTitle>Content Types Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.insights.contentTypes.map((type) => (
                    <div key={type.type} className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium capitalize">{type.type}</span>
                        <span className="text-sm text-gray-500">({type.count} pieces)</span>
                      </div>
                      <span className="text-sm font-semibold text-green-600">
                        {type.performance.toFixed(1)}% engagement
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Mock data generator for demo purposes
function generateMockContentData(): ContentPerformanceData {
  const statuses: Array<'viral' | 'trending' | 'steady' | 'declining' | 'underperforming'> = 
    ['viral', 'trending', 'steady', 'declining', 'underperforming'];
  
  const platforms = ['youtube', 'tiktok', 'instagram', 'twitter'];
  const tags = ['productivity', 'lifestyle', 'tech', 'tutorial', 'entertainment', 'education', 'travel', 'food'];

  const contentList = Array.from({ length: 25 }, (_, i) => ({
    id: `content-${i + 1}`,
    title: `Amazing content piece ${i + 1} that will blow your mind`,
    platform: platforms[Math.floor(Math.random() * platforms.length)],
    publishedAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
    views: Math.floor(Math.random() * 1000000) + 1000,
    likes: Math.floor(Math.random() * 50000) + 100,
    comments: Math.floor(Math.random() * 5000) + 10,
    shares: Math.floor(Math.random() * 2000) + 5,
    saves: Math.floor(Math.random() * 3000) + 20,
    duration: Math.floor(Math.random() * 300) + 30,
    engagementRate: Math.random() * 10 + 1,
    revenue: Math.random() * 500 + 10,
    status: statuses[Math.floor(Math.random() * statuses.length)],
    tags: tags.sort(() => 0.5 - Math.random()).slice(0, Math.floor(Math.random() * 4) + 1),
    thumbnailUrl: `https://example.com/thumbnail-${i + 1}.jpg`
  }));

  return {
    overview: {
      totalContent: contentList.length,
      averageViews: contentList.reduce((sum, c) => sum + c.views, 0) / contentList.length,
      averageEngagement: contentList.reduce((sum, c) => sum + c.engagementRate, 0) / contentList.length,
      viralThreshold: 100000,
      topPerformerGrowth: 25.6
    },
    contentList: contentList,
    trends: {
      trending: contentList.filter(c => c.status === 'trending').slice(0, 3).map(c => ({ ...c, growth: Math.random() * 50 + 10 })),
      viral: contentList.filter(c => c.status === 'viral').slice(0, 3),
      declining: contentList.filter(c => c.status === 'declining').slice(0, 3).map(c => ({ ...c, decline: Math.random() * 30 + 5 })),
      opportunities: [
        {
          title: 'Increase posting frequency on TikTok',
          suggestion: 'Your TikTok content performs 40% better than average'
        },
        {
          title: 'Create more tutorial content',
          suggestion: 'Tutorial videos have 3x higher engagement'
        },
        {
          title: 'Post during 6-8 PM for better reach',
          suggestion: 'Peak engagement hours show 60% more interactions'
        }
      ]
    },
    insights: {
      bestPerformingTags: tags.map(tag => ({
        tag,
        avgViews: Math.floor(Math.random() * 500000) + 50000,
        count: Math.floor(Math.random() * 10) + 2
      })).sort((a, b) => b.avgViews - a.avgViews).slice(0, 5),
      optimalPostingTimes: [
        { hour: 18, day: 'Monday', performance: 85 },
        { hour: 19, day: 'Tuesday', performance: 92 },
        { hour: 20, day: 'Wednesday', performance: 78 },
        { hour: 17, day: 'Thursday', performance: 88 },
        { hour: 19, day: 'Friday', performance: 95 }
      ],
      contentTypes: [
        { type: 'tutorial', performance: 7.2, count: 8 },
        { type: 'entertainment', performance: 6.1, count: 12 },
        { type: 'lifestyle', performance: 5.8, count: 6 },
        { type: 'educational', performance: 6.9, count: 4 }
      ],
      platformComparison: platforms.map(platform => ({
        platform,
        avgEngagement: Math.random() * 5 + 3,
        avgViews: Math.floor(Math.random() * 200000) + 50000
      }))
    }
  };
}