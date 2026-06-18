"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Badge } from './badge';
import { Button } from './button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { 
  TrendingUpIcon, 
  TrendingDownIcon, 
  DollarSignIcon, 
  EyeIcon, 
  HeartIcon,
  MessageSquareIcon,
  ShareIcon,
  TargetIcon,
  BarChart3Icon,
  LineChartIcon,
  PieChartIcon,
  DownloadIcon,
  RefreshCwIcon
} from 'lucide-react';

interface AnalyticsData {
  revenue: {
    totalRevenue: number;
    estimatedRevenue: number;
    actualRevenue: number;
    dailyAverage: number;
    monthlyProjection: number;
    growthRate: number;
  };
  engagement: {
    totalViews: number;
    totalLikes: number;
    totalComments: number;
    totalShares: number;
    totalWatchTime: number;
    avgEngagementRate: number;
    avgRetentionRate: number;
  };
  contentPerformance: {
    viralContent: any[];
    trendingContent: any[];
    topPerformingContent: any[];
    contentGrowthVelocity: number;
    avgViralScore: number;
  };
  roi: {
    totalROI: number;
    avgROI: number;
    profitMargin: number;
    paybackPeriod: number;
    totalCosts: number;
    costPerView: number;
  };
  platformComparison: {
    youtube: any;
    tiktok: any;
    instagram: any;
    twitter: any;
  };
  forecast: {
    dailyForecast: any[];
    weeklyForecast: any[];
    monthlyForecast: any[];
  };
  insights: {
    topRevenuePlatform: any;
    bestEngagementPlatform: any;
    contentRecommendations: any[];
    growthTrends: any;
    monetizationStatus: any;
    nextActionItems: any[];
  };
  lastUpdated: string;
}

interface AnalyticsDashboardProps {
  period?: 'day' | 'week' | 'month' | 'year';
  platform?: string;
}

export function AnalyticsDashboard({ period = 'month', platform }: AnalyticsDashboardProps) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState(period);
  const [selectedPlatform, setSelectedPlatform] = useState(platform);

  useEffect(() => {
    fetchAnalyticsData();
  }, [selectedPeriod, selectedPlatform]);

  const fetchAnalyticsData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        period: selectedPeriod,
        ...(selectedPlatform && { platform: selectedPlatform })
      });
      
      const response = await fetch(`/api/analytics/dashboard?${params}`);
      const result = await response.json();
      
      if (result.success) {
        setData(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => 
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

  const formatNumber = (num: number) => 
    new Intl.NumberFormat('en-US').format(num);

  const formatPercentage = (num: number) => 
    `${num.toFixed(1)}%`;

  const exportData = async (format: 'csv' | 'json') => {
    try {
      const response = await fetch('/api/analytics/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'export_data',
          data: { format, period: selectedPeriod }
        })
      });
      
      const result = await response.json();
      if (result.success) {
        if (format === 'csv' && result.downloadUrl) {
          const link = document.createElement('a');
          link.href = result.downloadUrl;
          link.download = `analytics-${selectedPeriod}-${Date.now()}.csv`;
          link.click();
        } else {
          const blob = new Blob([JSON.stringify(result.data, null, 2)], {
            type: 'application/json'
          });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `analytics-${selectedPeriod}-${Date.now()}.json`;
          link.click();
          URL.revokeObjectURL(url);
        }
      }
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCwIcon className="w-8 h-8 animate-spin" />
        <span className="ml-2">Loading analytics...</span>
      </div>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-96">
          <div className="text-center">
            <p className="text-gray-500 mb-4">No analytics data available</p>
            <Button onClick={fetchAnalyticsData}>Retry</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with controls */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Analytics Dashboard</h1>
          <p className="text-gray-500">
            Last updated: {new Date(data.lastUpdated).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => exportData('csv')}>
            <DownloadIcon className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
          <Button variant="outline" onClick={() => exportData('json')}>
            <DownloadIcon className="w-4 h-4 mr-2" />
            Export JSON
          </Button>
          <Button onClick={fetchAnalyticsData}>
            <RefreshCwIcon className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Period and Platform selectors */}
      <div className="flex gap-4">
        <Tabs value={selectedPeriod} onValueChange={setSelectedPeriod}>
          <TabsList>
            <TabsTrigger value="day">Day</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="year">Year</TabsTrigger>
          </TabsList>
        </Tabs>

        <Tabs value={selectedPlatform || 'all'} onValueChange={(value) => 
          setSelectedPlatform(value === 'all' ? undefined : value)}>
          <TabsList>
            <TabsTrigger value="all">All Platforms</TabsTrigger>
            <TabsTrigger value="youtube">YouTube</TabsTrigger>
            <TabsTrigger value="tiktok">TikTok</TabsTrigger>
            <TabsTrigger value="instagram">Instagram</TabsTrigger>
            <TabsTrigger value="twitter">Twitter</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSignIcon className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(data.revenue.totalRevenue)}
            </div>
            <div className="flex items-center text-sm text-gray-500 mt-1">
              {data.revenue.growthRate > 0 ? (
                <TrendingUpIcon className="w-4 h-4 text-green-500 mr-1" />
              ) : (
                <TrendingDownIcon className="w-4 h-4 text-red-500 mr-1" />
              )}
              {formatPercentage(Math.abs(data.revenue.growthRate))} vs last period
            </div>
            <div className="text-xs text-gray-400 mt-1">
              Daily avg: {formatCurrency(data.revenue.dailyAverage)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Views</CardTitle>
            <EyeIcon className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {formatNumber(data.engagement.totalViews)}
            </div>
            <div className="flex items-center text-sm text-gray-500 mt-1">
              <TargetIcon className="w-4 h-4 mr-1" />
              {formatPercentage(data.engagement.avgEngagementRate)} engagement
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {Math.round(data.engagement.totalWatchTime / 3600)}h watch time
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">ROI</CardTitle>
            <BarChart3Icon className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {formatPercentage(data.roi.avgROI)}
            </div>
            <div className="flex items-center text-sm text-gray-500 mt-1">
              <DollarSignIcon className="w-4 h-4 mr-1" />
              {formatPercentage(data.roi.profitMargin)} profit margin
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {data.roi.paybackPeriod ? 
                `${Math.round(data.roi.paybackPeriod)}d payback` : 
                'No payback period'
              }
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Viral Score</CardTitle>
            <TrendingUpIcon className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {data.contentPerformance.avgViralScore.toFixed(1)}
            </div>
            <div className="flex items-center text-sm text-gray-500 mt-1">
              <LineChartIcon className="w-4 h-4 mr-1" />
              {formatNumber(data.contentPerformance.contentGrowthVelocity)} views/hr
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {data.contentPerformance.viralContent.length} viral clips
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Insights and Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle>AI Insights & Recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold mb-3">Platform Performance</h4>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span>Top Revenue:</span>
                  <Badge variant="secondary">
                    {data.insights.topRevenuePlatform.platform} - 
                    {formatCurrency(data.insights.topRevenuePlatform.revenue)}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span>Best Engagement:</span>
                  <Badge variant="outline">
                    {data.insights.bestEngagementPlatform.platform} - 
                    {formatPercentage(data.insights.bestEngagementPlatform.engagement)}
                  </Badge>
                </div>
              </div>
            </div>
            
            <div>
              <h4 className="font-semibold mb-3">Action Items</h4>
              <div className="space-y-2">
                {data.insights.nextActionItems.slice(0, 3).map((action, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <span className="text-sm">{action.action}</span>
                    <Badge 
                      variant={action.impact === 'high' ? 'default' : 'secondary'}
                      className={action.impact === 'high' ? 'bg-red-100 text-red-800' : ''}
                    >
                      {action.impact}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Platform Comparison */}
      <Card>
        <CardHeader>
          <CardTitle>Platform Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">Platform</th>
                  <th className="text-right py-2">Revenue</th>
                  <th className="text-right py-2">Views</th>
                  <th className="text-right py-2">Engagement</th>
                  <th className="text-right py-2">RPM</th>
                  <th className="text-right py-2">Growth</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.platformComparison).map(([platform, metrics]: [string, any]) => (
                  <tr key={platform} className="border-b">
                    <td className="py-2 capitalize">{platform}</td>
                    <td className="text-right py-2 text-green-600 font-medium">
                      {formatCurrency(metrics.revenue)}
                    </td>
                    <td className="text-right py-2">{formatNumber(metrics.views)}</td>
                    <td className="text-right py-2">{formatPercentage(metrics.engagement)}</td>
                    <td className="text-right py-2">${metrics.rpm.toFixed(2)}</td>
                    <td className="text-right py-2">
                      <span className={metrics.growth > 0 ? 'text-green-600' : 'text-red-600'}>
                        {formatPercentage(metrics.growth)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Content Performance */}
      <Card>
        <CardHeader>
          <CardTitle>Top Performing Content</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="viral">
            <TabsList className="mb-4">
              <TabsTrigger value="viral">Viral Content</TabsTrigger>
              <TabsTrigger value="trending">Trending Now</TabsTrigger>
              <TabsTrigger value="top">Top Performers</TabsTrigger>
            </TabsList>

            <TabsContent value="viral">
              <div className="space-y-3">
                {data.contentPerformance.viralContent.length > 0 ? (
                  data.contentPerformance.viralContent.map((content, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                      <div>
                        <p className="font-medium">{content.content?.campaign?.clip?.title || 'Untitled'}</p>
                        <p className="text-sm text-gray-500">
                          Viral Score: {content.viralScore.toFixed(1)} | 
                          Growth: {formatNumber(content.growthVelocity)} views/hr
                        </p>
                      </div>
                      <Badge variant="default" className="bg-orange-100 text-orange-800">
                        Viral
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500 text-center py-8">No viral content yet</p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="trending">
              <div className="space-y-3">
                {data.contentPerformance.trendingContent.length > 0 ? (
                  data.contentPerformance.trendingContent.map((content, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                      <div>
                        <p className="font-medium">{content.content?.campaign?.clip?.title || 'Untitled'}</p>
                        <p className="text-sm text-gray-500">
                          Trending Rank: #{content.trendingRank} | 
                          Growth: {formatNumber(content.growthVelocity)} views/hr
                        </p>
                      </div>
                      <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                        Trending
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500 text-center py-8">No trending content currently</p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="top">
              <div className="space-y-3">
                {data.contentPerformance.topPerformingContent.slice(0, 5).map((content, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-lg text-gray-400">#{index + 1}</span>
                      <div>
                        <p className="font-medium">{content.content?.campaign?.clip?.title || 'Untitled'}</p>
                        <p className="text-sm text-gray-500">
                          Revenue: {formatCurrency(content.totalRevenue)} | 
                          Score: {content.viralScore.toFixed(1)}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline">
                      Top Performer
                    </Badge>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Revenue Forecast */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue Forecast</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center">
                <h4 className="font-semibold text-sm text-gray-500">Next 7 Days</h4>
                <p className="text-2xl font-bold text-green-600">
                  {data.forecast.weeklyForecast.length > 0 ? 
                    formatCurrency(data.forecast.weeklyForecast[0].predictedRevenue) :
                    '$0.00'
                  }
                </p>
                <p className="text-xs text-gray-400">
                  {data.forecast.weeklyForecast.length > 0 ? 
                    `${(data.forecast.weeklyForecast[0].confidence * 100).toFixed(0)}% confidence` :
                    'No forecast data'
                  }
                </p>
              </div>
              
              <div className="text-center">
                <h4 className="font-semibold text-sm text-gray-500">Next 30 Days</h4>
                <p className="text-2xl font-bold text-blue-600">
                  {data.forecast.monthlyForecast.length > 0 ? 
                    formatCurrency(data.forecast.monthlyForecast[0].predictedRevenue) :
                    '$0.00'
                  }
                </p>
                <p className="text-xs text-gray-400">
                  {data.forecast.monthlyForecast.length > 0 ? 
                    `${(data.forecast.monthlyForecast[0].confidence * 100).toFixed(0)}% confidence` :
                    'No forecast data'
                  }
                </p>
              </div>
              
              <div className="text-center">
                <h4 className="font-semibold text-sm text-gray-500">Monthly Target</h4>
                <p className="text-2xl font-bold text-purple-600">
                  {formatCurrency(data.revenue.monthlyProjection)}
                </p>
                <p className="text-xs text-gray-400">
                  {((data.revenue.totalRevenue / data.revenue.monthlyProjection) * 100).toFixed(0)}% progress
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default AnalyticsDashboard;