"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Button } from './button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { Badge } from './badge';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Eye, 
  Heart, 
  Share2, 
  Download,
  Target,
  BarChart3,
  Calendar,
  Filter,
  RefreshCw,
  Zap,
  Award,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';

interface RevenueAnalyticsData {
  overview: {
    totalRevenue: number;
    projectedRevenue: number;
    monthlyGrowth: number;
    averageRPM: number;
    totalViews: number;
    totalContent: number;
    bestPerformingPlatform: string;
    revenueByPlatform: { [key: string]: number };
  };
  platformMetrics: {
    [platform: string]: {
      revenue: number;
      views: number;
      engagement: number;
      rpm: number;
      growth: number;
      contentCount: number;
      topContent: any[];
    };
  };
  timeSeriesData: Array<{
    date: string;
    revenue: number;
    views: number;
    engagement: number;
    contentCount: number;
  }>;
  forecasting: {
    nextMonth: {
      projectedRevenue: number;
      projectedViews: number;
      confidence: number;
    };
    nextQuarter: {
      projectedRevenue: number;
      projectedViews: number;
      confidence: number;
    };
    yearEnd: {
      projectedRevenue: number;
      projectedViews: number;
      confidence: number;
    };
  };
  contentInsights: {
    topPerformers: any[];
    underperformers: any[];
    viralContent: any[];
    optimizationSuggestions: string[];
  };
  monetizationMetrics: {
    adRevenue: number;
    sponsorshipRevenue: number;
    platformIncentives: number;
    estimatedMissedRevenue: number;
    revenueOptimizationScore: number;
  };
}

interface RevenueAnalyticsDashboardProps {
  className?: string;
}

export function RevenueAnalyticsDashboard({ className }: RevenueAnalyticsDashboardProps) {
  const [data, setData] = useState<RevenueAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState('month');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadAnalyticsData();
  }, [timeframe, selectedPlatforms]);

  const loadAnalyticsData = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        type: 'revenue',
        timeframe,
        ...(selectedPlatforms.length > 0 && { platforms: selectedPlatforms.join(',') })
      });

      const response = await fetch(`/api/analytics?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch analytics data');
      }

      const analyticsData = await response.json();
      setData(analyticsData);
    } catch (err) {
      console.error('Error loading analytics:', err);
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAnalyticsData();
    setRefreshing(false);
  };

  const handleExport = async (format: string) => {
    try {
      const params = new URLSearchParams({
        format,
        timeframe,
        ...(selectedPlatforms.length > 0 && { platforms: selectedPlatforms.join(',') })
      });

      const response = await fetch(`/api/analytics/export?${params}`);
      if (!response.ok) {
        throw new Error('Export failed');
      }

      // Trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `revenue-analytics-${timeframe}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Export error:', err);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  const formatPercentage = (percentage: number) => {
    return `${(percentage >= 0 ? '+' : '')}${percentage.toFixed(1)}%`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center space-y-4">
          <RefreshCw className="h-8 w-8 animate-spin text-blue-500" />
          <p className="text-gray-500">Loading revenue analytics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center space-y-4">
          <AlertTriangle className="h-8 w-8 text-red-500" />
          <p className="text-red-600">{error}</p>
          <Button onClick={loadAnalyticsData} variant="outline">
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-gray-500">No analytics data available</p>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Revenue Analytics</h1>
          <p className="text-gray-500">
            Comprehensive insights into your content monetization performance
          </p>
        </div>
        
        <div className="flex flex-col space-y-2 sm:flex-row sm:items-center sm:space-y-0 sm:space-x-2">
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="week">Last Week</option>
            <option value="month">Last Month</option>
            <option value="quarter">Last Quarter</option>
            <option value="year">Last Year</option>
          </select>
          
          <Button
            onClick={handleRefresh}
            disabled={refreshing}
            variant="outline"
            size="sm"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          
          <Button
            onClick={() => handleExport('csv')}
            variant="outline"
            size="sm"
          >
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(data.overview.totalRevenue)}
            </div>
            <div className="flex items-center space-x-1 text-xs text-gray-500">
              {data.overview.monthlyGrowth >= 0 ? (
                <ArrowUpRight className="h-3 w-3 text-green-500" />
              ) : (
                <ArrowDownRight className="h-3 w-3 text-red-500" />
              )}
              <span className={data.overview.monthlyGrowth >= 0 ? 'text-green-600' : 'text-red-600'}>
                {formatPercentage(data.overview.monthlyGrowth)}
              </span>
              <span>from last period</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Views</CardTitle>
            <Eye className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {formatNumber(data.overview.totalViews)}
            </div>
            <p className="text-xs text-gray-500">
              Across {data.overview.totalContent} pieces of content
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average RPM</CardTitle>
            <Target className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {formatCurrency(data.overview.averageRPM)}
            </div>
            <p className="text-xs text-gray-500">Revenue per 1,000 views</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Projected Revenue</CardTitle>
            <TrendingUp className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {formatCurrency(data.overview.projectedRevenue)}
            </div>
            <p className="text-xs text-gray-500">Next month forecast</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="platforms">Platforms</TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="forecasting">Forecasting</TabsTrigger>
          <TabsTrigger value="optimization">Optimization</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Revenue Chart */}
            <Card className="col-span-2">
              <CardHeader>
                <CardTitle>Revenue Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80 flex items-center justify-center border border-gray-200 rounded-lg">
                  <p className="text-gray-500">Revenue chart would be rendered here</p>
                  {/* Revenue trend chart visualization */}
                </div>
              </CardContent>
            </Card>

            {/* Platform Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle>Revenue by Platform</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(data.overview.revenueByPlatform).map(([platform, revenue]) => (
                    <div key={platform} className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                        <span className="text-sm font-medium capitalize">{platform}</span>
                      </div>
                      <span className="text-sm font-semibold text-green-600">
                        {formatCurrency(revenue)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Monetization Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle>Monetization Sources</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Ad Revenue</span>
                    <span className="text-sm font-semibold text-green-600">
                      {formatCurrency(data.monetizationMetrics.adRevenue)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Sponsorships</span>
                    <span className="text-sm font-semibold text-green-600">
                      {formatCurrency(data.monetizationMetrics.sponsorshipRevenue)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Platform Incentives</span>
                    <span className="text-sm font-semibold text-green-600">
                      {formatCurrency(data.monetizationMetrics.platformIncentives)}
                    </span>
                  </div>
                  <hr />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-red-600">Missed Revenue</span>
                    <span className="text-sm font-semibold text-red-600">
                      -{formatCurrency(data.monetizationMetrics.estimatedMissedRevenue)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="platforms" className="space-y-4">
          <div className="grid gap-4">
            {Object.entries(data.platformMetrics).map(([platform, metrics]) => (
              <Card key={platform}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="capitalize">{platform}</span>
                    <Badge variant="outline">
                      {metrics.contentCount} content pieces
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-4">
                    <div>
                      <p className="text-sm text-gray-500">Revenue</p>
                      <p className="text-lg font-semibold text-green-600">
                        {formatCurrency(metrics.revenue)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Views</p>
                      <p className="text-lg font-semibold text-blue-600">
                        {formatNumber(metrics.views)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">RPM</p>
                      <p className="text-lg font-semibold text-purple-600">
                        {formatCurrency(metrics.rpm)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Growth</p>
                      <p className={`text-lg font-semibold ${metrics.growth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatPercentage(metrics.growth)}
                      </p>
                    </div>
                  </div>

                  {/* Top Content for Platform */}
                  {metrics.topContent.length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-sm font-medium mb-2">Top Performing Content</h4>
                      <div className="space-y-2">
                        {metrics.topContent.slice(0, 3).map((content, idx) => (
                          <div key={content.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                            <div className="flex items-center space-x-2">
                              <Badge variant="outline" className="text-xs">
                                #{idx + 1}
                              </Badge>
                              <span className="text-sm truncate max-w-xs">{content.title || 'Untitled'}</span>
                            </div>
                            <div className="flex items-center space-x-4 text-sm">
                              <span className="text-blue-600">{formatNumber(content.views)} views</span>
                              <span className="text-green-600">{formatCurrency(content.revenue)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="content" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Top Performers */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Award className="h-5 w-5 text-yellow-500" />
                  <span>Top Performers</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.contentInsights.topPerformers.slice(0, 5).map((content, idx) => (
                    <div key={content.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center space-x-3">
                        <Badge variant="default" className="bg-yellow-100 text-yellow-800">
                          #{idx + 1}
                        </Badge>
                        <div>
                          <p className="font-medium text-sm truncate max-w-xs">
                            {content.title || 'Untitled'}
                          </p>
                          <p className="text-xs text-gray-500 capitalize">
                            {content.platform} • {new Date(content.publishedAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-green-600 text-sm">
                          {formatCurrency(content.revenue)}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatNumber(content.views)} views
                        </p>
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
                  <Zap className="h-5 w-5 text-orange-500" />
                  <span>Viral Content</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.contentInsights.viralContent.length > 0 ? (
                    data.contentInsights.viralContent.slice(0, 5).map((content) => (
                      <div key={content.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center space-x-3">
                          <Badge variant="secondary" className="bg-orange-100 text-orange-800">
                            {content.viralScore.toFixed(1)}
                          </Badge>
                          <div>
                            <p className="font-medium text-sm truncate max-w-xs">
                              {content.title || 'Untitled'}
                            </p>
                            <p className="text-xs text-gray-500 capitalize">
                              {content.platform}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-orange-600 text-sm">
                            {content.engagementRate.toFixed(1)}%
                          </p>
                          <p className="text-xs text-gray-500">
                            engagement
                          </p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <Zap className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                      <p>No viral content detected yet</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Optimization Suggestions */}
          <Card>
            <CardHeader>
              <CardTitle>Optimization Suggestions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2">
                {data.contentInsights.optimizationSuggestions.map((suggestion, idx) => (
                  <div key={idx} className="flex items-start space-x-3 p-3 bg-blue-50 rounded-lg">
                    <Target className="h-5 w-5 text-blue-500 mt-0.5" />
                    <p className="text-sm text-blue-800">{suggestion}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="forecasting" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            {/* Next Month Forecast */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Next Month</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-gray-500">Projected Revenue</p>
                    <p className="text-xl font-bold text-green-600">
                      {formatCurrency(data.forecasting.nextMonth.projectedRevenue)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Projected Views</p>
                    <p className="text-lg font-semibold text-blue-600">
                      {formatNumber(data.forecasting.nextMonth.projectedViews)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Confidence</p>
                    <div className="flex items-center space-x-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-green-500 h-2 rounded-full" 
                          style={{ width: `${data.forecasting.nextMonth.confidence * 100}%` }}
                        ></div>
                      </div>
                      <span className="text-sm font-medium">
                        {Math.round(data.forecasting.nextMonth.confidence * 100)}%
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Next Quarter Forecast */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Next Quarter</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-gray-500">Projected Revenue</p>
                    <p className="text-xl font-bold text-green-600">
                      {formatCurrency(data.forecasting.nextQuarter.projectedRevenue)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Projected Views</p>
                    <p className="text-lg font-semibold text-blue-600">
                      {formatNumber(data.forecasting.nextQuarter.projectedViews)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Confidence</p>
                    <div className="flex items-center space-x-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-yellow-500 h-2 rounded-full" 
                          style={{ width: `${data.forecasting.nextQuarter.confidence * 100}%` }}
                        ></div>
                      </div>
                      <span className="text-sm font-medium">
                        {Math.round(data.forecasting.nextQuarter.confidence * 100)}%
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Year End Forecast */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Year End</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-gray-500">Projected Revenue</p>
                    <p className="text-xl font-bold text-green-600">
                      {formatCurrency(data.forecasting.yearEnd.projectedRevenue)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Projected Views</p>
                    <p className="text-lg font-semibold text-blue-600">
                      {formatNumber(data.forecasting.yearEnd.projectedViews)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Confidence</p>
                    <div className="flex items-center space-x-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-orange-500 h-2 rounded-full" 
                          style={{ width: `${data.forecasting.yearEnd.confidence * 100}%` }}
                        ></div>
                      </div>
                      <span className="text-sm font-medium">
                        {Math.round(data.forecasting.yearEnd.confidence * 100)}%
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Forecast Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Revenue Forecast Trajectory</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 flex items-center justify-center border border-gray-200 rounded-lg">
                <p className="text-gray-500">Forecast visualization chart would be rendered here</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="optimization" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Revenue Optimization Score */}
            <Card>
              <CardHeader>
                <CardTitle>Revenue Optimization Score</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center">
                  <div className="relative w-32 h-32">
                    <svg className="w-32 h-32 transform -rotate-90" viewBox="0 0 120 120">
                      <circle
                        cx="60"
                        cy="60"
                        r="54"
                        stroke="#e5e7eb"
                        strokeWidth="12"
                        fill="none"
                      />
                      <circle
                        cx="60"
                        cy="60"
                        r="54"
                        stroke="#10b981"
                        strokeWidth="12"
                        fill="none"
                        strokeLinecap="round"
                        strokeDasharray={`${(data.monetizationMetrics.revenueOptimizationScore / 100) * 339.292} 339.292`}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">
                          {Math.round(data.monetizationMetrics.revenueOptimizationScore)}
                        </div>
                        <div className="text-xs text-gray-500">Score</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Poor</span>
                    <span>Good</span>
                    <span>Excellent</span>
                  </div>
                  <div className="h-2 bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 rounded-full"></div>
                </div>
              </CardContent>
            </Card>

            {/* Underperforming Content */}
            <Card>
              <CardHeader>
                <CardTitle>Content Needing Optimization</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.contentInsights.underperformers.length > 0 ? (
                    data.contentInsights.underperformers.map((content) => (
                      <div key={content.id} className="p-3 border border-orange-200 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-medium text-sm truncate max-w-xs">
                            {content.title || 'Untitled'}
                          </p>
                          <Badge variant="outline" className="text-orange-600 border-orange-600">
                            Low Performance
                          </Badge>
                        </div>
                        <div className="space-y-1">
                          {content.suggestions.map((suggestion: string, idx: number) => (
                            <p key={idx} className="text-xs text-orange-700">
                              • {suggestion}
                            </p>
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <Award className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                      <p>All content is performing well!</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Global Optimization Strategies */}
          <Card>
            <CardHeader>
              <CardTitle>Strategic Recommendations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div className="p-4 bg-green-50 rounded-lg">
                  <h4 className="font-medium text-green-800 mb-2">Content Strategy</h4>
                  <ul className="space-y-1 text-sm text-green-700">
                    <li>• Focus on {data.overview.bestPerformingPlatform} - highest RPM</li>
                    <li>• Increase posting frequency</li>
                    <li>• Optimize content for peak engagement times</li>
                  </ul>
                </div>
                
                <div className="p-4 bg-blue-50 rounded-lg">
                  <h4 className="font-medium text-blue-800 mb-2">Monetization</h4>
                  <ul className="space-y-1 text-sm text-blue-700">
                    <li>• Enable monetization on all eligible content</li>
                    <li>• Explore sponsorship opportunities</li>
                    <li>• Optimize video length for ad placement</li>
                  </ul>
                </div>
                
                <div className="p-4 bg-purple-50 rounded-lg">
                  <h4 className="font-medium text-purple-800 mb-2">Growth</h4>
                  <ul className="space-y-1 text-sm text-purple-700">
                    <li>• Cross-promote on multiple platforms</li>
                    <li>• Analyze viral content patterns</li>
                    <li>• Improve thumbnail and title optimization</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}