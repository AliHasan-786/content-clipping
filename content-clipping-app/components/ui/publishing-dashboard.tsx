'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Button } from './button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { Badge } from './badge';
import { Progress } from './progress';
import { 
  Play, 
  Pause, 
  CheckCircle, 
  AlertCircle, 
  Clock, 
  TrendingUp,
  Users,
  BarChart3,
  RefreshCw,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  Calendar,
  Settings,
  Plus,
  ExternalLink
} from 'lucide-react';

interface PublishingDashboardProps {
  userId: string;
}

interface Campaign {
  id: string;
  title: string;
  status: string;
  platform: {
    name: string;
    displayName: string;
  };
  account: {
    username: string;
    displayName: string;
  };
  scheduledAt?: string;
  publishedAt?: string;
  createdAt: string;
  retryCount: number;
  errorMessage?: string;
  publishedContent: Array<{
    id: string;
    url?: string;
    platformPostId?: string;
  }>;
  progress?: {
    status: string;
    completed: number;
    total: number;
  };
}

interface Analytics {
  overview: {
    totalCampaigns: number;
    successfulCampaigns: number;
    failedCampaigns: number;
    successRate: number;
    totalViews: number;
    totalLikes: number;
    totalComments: number;
    totalShares: number;
    avgEngagementRate: number;
  };
  topContent: Array<{
    id: string;
    title: string;
    platform: string;
    analytics: {
      views: number;
      likes: number;
      comments: number;
      engagementRate: number;
    };
    url?: string;
  }>;
  platformPerformance: Array<{
    platform: {
      name: string;
      displayName: string;
    };
    totalCampaigns: number;
    totalViews: number;
    avgEngagementRate: number;
  }>;
}

interface ConnectedAccount {
  id: string;
  platform: {
    name: string;
    displayName: string;
  };
  username: string;
  displayName: string;
  profilePicture?: string;
  isActive: boolean;
  lastSyncAt?: string;
  connectedAt: string;
}

export function PublishingDashboard({ userId }: PublishingDashboardProps) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTimeframe, setSelectedTimeframe] = useState('week');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, [selectedTimeframe]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      
      const [campaignsRes, analyticsRes, accountsRes] = await Promise.all([
        fetch('/api/publishing?limit=10'),
        fetch(`/api/analytics?timeframe=${selectedTimeframe}`),
        fetch('/api/accounts')
      ]);

      const [campaignsData, analyticsData, accountsData] = await Promise.all([
        campaignsRes.json(),
        analyticsRes.json(),
        accountsRes.json()
      ]);

      setCampaigns(campaignsData.campaigns || []);
      setAnalytics(analyticsData);
      setAccounts(accountsData.accounts || []);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshData = async () => {
    setRefreshing(true);
    await loadDashboardData();
    setRefreshing(false);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PUBLISHED':
        return 'bg-green-500';
      case 'FAILED':
        return 'bg-red-500';
      case 'PROCESSING':
      case 'PUBLISHING':
        return 'bg-blue-500';
      case 'SCHEDULED':
        return 'bg-yellow-500';
      case 'DRAFT':
        return 'bg-gray-500';
      default:
        return 'bg-gray-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PUBLISHED':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'FAILED':
        return <AlertCircle className="h-4 w-4 text-red-600" />;
      case 'PROCESSING':
      case 'PUBLISHING':
        return <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />;
      case 'SCHEDULED':
        return <Clock className="h-4 w-4 text-yellow-600" />;
      case 'DRAFT':
        return <Pause className="h-4 w-4 text-gray-600" />;
      default:
        return <Clock className="h-4 w-4 text-gray-600" />;
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Publishing Dashboard</h1>
          <p className="text-gray-600">Manage and monitor your social media campaigns</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={refreshData}
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button asChild>
            <a href="/publish">
              <Plus className="h-4 w-4 mr-2" />
              New Campaign
            </a>
          </Button>
        </div>
      </div>

      {/* Analytics Overview */}
      {analytics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Campaigns</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.overview.totalCampaigns}</div>
              <p className="text-xs text-muted-foreground">
                {analytics.overview.successRate.toFixed(1)}% success rate
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Views</CardTitle>
              <Eye className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatNumber(analytics.overview.totalViews)}</div>
              <p className="text-xs text-muted-foreground">
                Across all platforms
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Engagement</CardTitle>
              <Heart className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatNumber(analytics.overview.totalLikes + analytics.overview.totalComments)}
              </div>
              <p className="text-xs text-muted-foreground">
                {analytics.overview.avgEngagementRate.toFixed(2)}% avg rate
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Connected Accounts</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{accounts.filter(a => a.isActive).length}</div>
              <p className="text-xs text-muted-foreground">
                Active connections
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Content */}
      <Tabs defaultValue="campaigns" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        {/* Campaigns Tab */}
        <TabsContent value="campaigns" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Recent Campaigns</h2>
            <div className="flex items-center gap-2">
              <select
                value={selectedTimeframe}
                onChange={(e) => setSelectedTimeframe(e.target.value)}
                className="px-3 py-1 border rounded-md text-sm"
              >
                <option value="day">Last 24 hours</option>
                <option value="week">Last week</option>
                <option value="month">Last month</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4">
            {campaigns.map((campaign) => (
              <Card key={campaign.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(campaign.status)}
                      <h3 className="font-medium">{campaign.title}</h3>
                      <Badge variant="outline">
                        {campaign.platform.displayName}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      {campaign.publishedContent.length > 0 && (
                        <Button variant="outline" size="sm" asChild>
                          <a 
                            href={campaign.publishedContent[0].url} 
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="h-3 w-3 mr-1" />
                            View
                          </a>
                        </Button>
                      )}
                      <Badge className={getStatusColor(campaign.status)}>
                        {campaign.status}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-sm text-gray-600">
                    <div className="flex items-center gap-4">
                      <span>@{campaign.account.username}</span>
                      {campaign.scheduledAt && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(campaign.scheduledAt).toLocaleDateString()}
                        </span>
                      )}
                      {campaign.retryCount > 0 && (
                        <span className="text-orange-600">
                          Retry #{campaign.retryCount}
                        </span>
                      )}
                    </div>
                    <span>{new Date(campaign.createdAt).toLocaleDateString()}</span>
                  </div>

                  {campaign.progress && campaign.progress.status === 'uploading' && (
                    <div className="mt-2">
                      <Progress 
                        value={(campaign.progress.completed / campaign.progress.total) * 100}
                        className="h-2"
                      />
                      <p className="text-xs text-gray-600 mt-1">
                        {campaign.progress.completed} of {campaign.progress.total} platforms
                      </p>
                    </div>
                  )}

                  {campaign.errorMessage && (
                    <div className="mt-2 p-2 bg-red-50 rounded text-sm text-red-700">
                      {campaign.errorMessage}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}

            {campaigns.length === 0 && (
              <Card>
                <CardContent className="p-8 text-center">
                  <Play className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No campaigns yet</h3>
                  <p className="text-gray-600 mb-4">Create your first publishing campaign to get started.</p>
                  <Button asChild>
                    <a href="/publish">
                      <Plus className="h-4 w-4 mr-2" />
                      Create Campaign
                    </a>
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-4">
          {analytics && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Platform Performance */}
                <Card>
                  <CardHeader>
                    <CardTitle>Platform Performance</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {analytics.platformPerformance.map((platform) => (
                        <div key={platform.platform.name} className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{platform.platform.displayName}</p>
                            <p className="text-sm text-gray-600">
                              {platform.totalCampaigns} campaigns
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-medium">{formatNumber(platform.totalViews)} views</p>
                            <p className="text-sm text-gray-600">
                              {platform.avgEngagementRate.toFixed(2)}% engagement
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Top Content */}
                <Card>
                  <CardHeader>
                    <CardTitle>Top Performing Content</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {analytics.topContent.slice(0, 5).map((content, index) => (
                        <div key={content.id} className="flex items-center gap-3">
                          <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs flex items-center justify-center font-medium">
                            {index + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{content.title}</p>
                            <div className="flex items-center gap-4 text-xs text-gray-600">
                              <span className="flex items-center gap-1">
                                <Eye className="h-3 w-3" />
                                {formatNumber(content.analytics.views)}
                              </span>
                              <span className="flex items-center gap-1">
                                <Heart className="h-3 w-3" />
                                {formatNumber(content.analytics.likes)}
                              </span>
                              <span className="flex items-center gap-1">
                                <MessageCircle className="h-3 w-3" />
                                {formatNumber(content.analytics.comments)}
                              </span>
                            </div>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {content.platform}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        {/* Accounts Tab */}
        <TabsContent value="accounts" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Connected Accounts</h2>
            <Button asChild>
              <a href="/dashboard/accounts">
                <Plus className="h-4 w-4 mr-2" />
                Connect Account
              </a>
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {accounts.map((account) => (
              <Card key={account.id} className={account.isActive ? '' : 'opacity-50'}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 mb-3">
                    {account.profilePicture ? (
                      <img 
                        src={account.profilePicture} 
                        alt={account.displayName}
                        className="w-10 h-10 rounded-full"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                        <Users className="h-5 w-5 text-gray-500" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{account.displayName}</p>
                      <p className="text-sm text-gray-600 truncate">@{account.username}</p>
                    </div>
                    <Badge variant={account.isActive ? 'default' : 'secondary'}>
                      {account.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between text-sm text-gray-600">
                    <span>{account.platform.displayName}</span>
                    <span>
                      Connected {new Date(account.connectedAt).toLocaleDateString()}
                    </span>
                  </div>

                  {account.lastSyncAt && (
                    <p className="text-xs text-gray-500 mt-2">
                      Last synced: {new Date(account.lastSyncAt).toLocaleString()}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}

            {accounts.length === 0 && (
              <Card className="col-span-full">
                <CardContent className="p-8 text-center">
                  <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No accounts connected</h3>
                  <p className="text-gray-600 mb-4">Connect your social media accounts to start publishing.</p>
                  <Button asChild>
                    <a href="/dashboard/accounts">
                      <Plus className="h-4 w-4 mr-2" />
                      Connect Account
                    </a>
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Publishing Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-gray-600">
                Configure default settings for your publishing campaigns.
              </p>
              <Button variant="outline" asChild>
                <a href="/settings/publishing">
                  Manage Settings
                </a>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}