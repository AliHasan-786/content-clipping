'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Button } from './button';
import { Input } from './input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { Badge } from './badge';
import { Checkbox } from '../ui/checkbox';
import { 
  Upload,
  Youtube,
  Instagram,
  Twitter,
  Settings,
  Eye,
  Calendar,
  Clock,
  Wand2,
  AlertCircle,
  CheckCircle,
  Image,
  Video,
  Hash,
  Type,
  FileText,
  Sparkles,
  Users,
  Target,
  TrendingUp,
  Share2
} from 'lucide-react';

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
}

interface ContentOptimization {
  video?: {
    estimatedSize: number;
    estimatedDuration: number;
    compressionRatio: number;
  };
  caption?: {
    title: string;
    description?: string;
    hashtags: string[];
    totalLength: number;
    variations?: any[];
  };
  hashtags?: Array<{
    hashtag: string;
    relevanceScore: number;
    trending: boolean;
    difficulty: number;
  }>;
  thumbnail?: {
    variations: Array<{
      outputPath?: string;
      width: number;
      height: number;
      fileSize: number;
      success: boolean;
    }>;
  };
}

interface PublishingFormData {
  title: string;
  description: string;
  tags: string[];
  videoFile: File | null;
  platforms: Array<{
    platform: string;
    accountId: string;
    contentType?: string;
    scheduledAt?: string;
    customization?: {
      title?: string;
      description?: string;
      tags?: string[];
    };
  }>;
  autoOptimize: boolean;
  approvalRequired: boolean;
  globalScheduledAt?: string;
}

const PLATFORM_ICONS = {
  youtube: Youtube,
  instagram: Instagram,
  twitter: Twitter,
  tiktok: Video,
};

const PLATFORM_COLORS = {
  youtube: 'bg-red-100 text-red-800',
  instagram: 'bg-purple-100 text-purple-800',
  twitter: 'bg-blue-100 text-blue-800',
  tiktok: 'bg-black text-white',
};

export function MultiPlatformPublisher() {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [formData, setFormData] = useState<PublishingFormData>({
    title: '',
    description: '',
    tags: [],
    videoFile: null,
    platforms: [],
    autoOptimize: true,
    approvalRequired: false,
  });
  const [optimizations, setOptimizations] = useState<ContentOptimization>({});
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [publishingResult, setPublishingResult] = useState<any>(null);

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const response = await fetch('/api/accounts');
      const data = await response.json();
      setAccounts(data.accounts || []);
    } catch (error) {
      console.error('Error loading accounts:', error);
    }
  };

  const handleVideoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setFormData(prev => ({ ...prev, videoFile: file }));
    }
  };

  const handlePlatformToggle = (platform: string, accountId: string, checked: boolean) => {
    setFormData(prev => {
      const platforms = [...prev.platforms];
      const existingIndex = platforms.findIndex(p => 
        p.platform === platform && p.accountId === accountId
      );

      if (checked && existingIndex === -1) {
        platforms.push({ platform, accountId });
      } else if (!checked && existingIndex !== -1) {
        platforms.splice(existingIndex, 1);
      }

      return { ...prev, platforms };
    });
  };

  const addTag = () => {
    if (newTag.trim() && !formData.tags.includes(newTag.trim())) {
      setFormData(prev => ({
        ...prev,
        tags: [...prev.tags, newTag.trim()]
      }));
      setNewTag('');
    }
  };

  const removeTag = (tagToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag !== tagToRemove)
    }));
  };

  const handleOptimizeContent = async () => {
    if (!formData.title || !formData.videoFile) return;

    setIsOptimizing(true);
    try {
      // Upload video file first (this would need to be implemented)
      const videoPath = '/temp/video.mp4'; // Placeholder

      const response = await fetch('/api/optimization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'all',
          content: {
            title: formData.title,
            description: formData.description,
            videoPath,
            platform: formData.platforms[0]?.platform || 'youtube',
            category: 'general',
          }
        })
      });

      const data = await response.json();
      setOptimizations(data);
    } catch (error) {
      console.error('Error optimizing content:', error);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handlePublish = async () => {
    if (!formData.title || !formData.videoFile || formData.platforms.length === 0) {
      return;
    }

    setIsPublishing(true);
    try {
      // This would include actual file upload logic
      const videoPath = '/temp/video.mp4'; // Placeholder

      const publishingRequest = {
        title: formData.title,
        description: formData.description,
        tags: formData.tags,
        platforms: formData.platforms,
        videoPath,
        autoOptimize: formData.autoOptimize,
        approvalRequired: formData.approvalRequired,
        globalScheduledAt: formData.globalScheduledAt,
      };

      const response = await fetch('/api/publishing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(publishingRequest)
      });

      const result = await response.json();
      setPublishingResult(result);
      
      if (result.success) {
        // Reset form or redirect to dashboard
        console.log('Publishing campaign created:', result.campaignId);
      }
    } catch (error) {
      console.error('Error publishing content:', error);
    } finally {
      setIsPublishing(false);
    }
  };

  const getPlatformIcon = (platformName: string) => {
    const IconComponent = PLATFORM_ICONS[platformName] || Video;
    return <IconComponent className="h-4 w-4" />;
  };

  const groupAccountsByPlatform = () => {
    return accounts.reduce((acc, account) => {
      const platform = account.platform.name;
      if (!acc[platform]) {
        acc[platform] = [];
      }
      acc[platform].push(account);
      return acc;
    }, {} as Record<string, ConnectedAccount[]>);
  };

  const platformGroups = groupAccountsByPlatform();

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Create Publishing Campaign</h1>
          <p className="text-gray-600">Publish your content across multiple social media platforms</p>
        </div>
      </div>

      {publishingResult && (
        <Card className={publishingResult.success ? 'border-green-200' : 'border-red-200'}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              {publishingResult.success ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-600" />
              )}
              <p className={publishingResult.success ? 'text-green-800' : 'text-red-800'}>
                {publishingResult.message}
              </p>
            </div>
            {publishingResult.success && publishingResult.campaignId && (
              <Button variant="outline" size="sm" className="mt-2" asChild>
                <a href={`/campaigns/${publishingResult.campaignId}`}>
                  View Campaign
                </a>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Video Upload */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Video Content
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Video File</label>
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleVideoUpload}
                  className="w-full p-2 border border-gray-300 rounded-md"
                />
                {formData.videoFile && (
                  <p className="text-sm text-gray-600 mt-1">
                    Selected: {formData.videoFile.name} ({(formData.videoFile.size / (1024 * 1024)).toFixed(1)}MB)
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Content Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Type className="h-5 w-5" />
                Content Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Title</label>
                <Input
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Enter your content title..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Describe your content..."
                  className="w-full p-2 border border-gray-300 rounded-md h-24 resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Tags</label>
                <div className="flex items-center gap-2 mb-2">
                  <Input
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    placeholder="Add a tag..."
                    onKeyPress={(e) => e.key === 'Enter' && addTag()}
                  />
                  <Button onClick={addTag} variant="outline" size="sm">
                    <Hash className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {formData.tags.map((tag, index) => (
                    <Badge key={index} variant="secondary" className="cursor-pointer">
                      {tag}
                      <button
                        onClick={() => removeTag(tag)}
                        className="ml-1 text-xs"
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Platform Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Share2 className="h-5 w-5" />
                Select Platforms
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {Object.entries(platformGroups).map(([platform, platformAccounts]) => (
                <div key={platform} className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    {getPlatformIcon(platform)}
                    <h3 className="font-medium">{platformAccounts[0].platform.displayName}</h3>
                    <Badge className={PLATFORM_COLORS[platform] || 'bg-gray-100 text-gray-800'}>
                      {platformAccounts.length} account{platformAccounts.length !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                  
                  <div className="space-y-2">
                    {platformAccounts.map((account) => (
                      <div key={account.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Checkbox
                            id={`account-${account.id}`}
                            checked={formData.platforms.some(p => p.accountId === account.id)}
                            onCheckedChange={(checked) => 
                              handlePlatformToggle(platform, account.id, checked as boolean)
                            }
                          />
                          <div className="flex items-center gap-2">
                            {account.profilePicture ? (
                              <img 
                                src={account.profilePicture} 
                                alt={account.displayName}
                                className="w-6 h-6 rounded-full"
                              />
                            ) : (
                              <Users className="h-6 w-6 text-gray-400" />
                            )}
                            <div>
                              <p className="text-sm font-medium">{account.displayName}</p>
                              <p className="text-xs text-gray-600">@{account.username}</p>
                            </div>
                          </div>
                        </div>
                        
                        {formData.platforms.some(p => p.accountId === account.id) && (
                          <Button variant="outline" size="sm">
                            <Settings className="h-3 w-3 mr-1" />
                            Customize
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {accounts.length === 0 && (
                <div className="text-center py-8">
                  <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No accounts connected</h3>
                  <p className="text-gray-600 mb-4">Connect your social media accounts to start publishing.</p>
                  <Button asChild>
                    <a href="/dashboard/accounts">Connect Accounts</a>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Publishing Options */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Publishing Options
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="auto-optimize"
                  checked={formData.autoOptimize}
                  onCheckedChange={(checked) => 
                    setFormData(prev => ({ ...prev, autoOptimize: checked as boolean }))
                  }
                />
                <label htmlFor="auto-optimize" className="text-sm font-medium">
                  Auto-optimize content for each platform
                </label>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="approval-required"
                  checked={formData.approvalRequired}
                  onCheckedChange={(checked) => 
                    setFormData(prev => ({ ...prev, approvalRequired: checked as boolean }))
                  }
                />
                <label htmlFor="approval-required" className="text-sm font-medium">
                  Require approval before publishing
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Schedule for later (optional)</label>
                <input
                  type="datetime-local"
                  value={formData.globalScheduledAt || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, globalScheduledAt: e.target.value }))}
                  className="w-full p-2 border border-gray-300 rounded-md"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Content Optimization */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wand2 className="h-5 w-5" />
                Content Optimization
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={handleOptimizeContent}
                disabled={!formData.title || !formData.videoFile || isOptimizing}
                className="w-full"
                variant="outline"
              >
                {isOptimizing ? (
                  <>
                    <Sparkles className="h-4 w-4 mr-2 animate-spin" />
                    Optimizing...
                  </>
                ) : (
                  <>
                    <Eye className="h-4 w-4 mr-2" />
                    Preview Optimizations
                  </>
                )}
              </Button>

              {optimizations.caption && (
                <div className="space-y-2">
                  <h4 className="font-medium text-sm">Optimized Caption</h4>
                  <div className="p-3 bg-gray-50 rounded-md text-sm">
                    <p className="font-medium">{optimizations.caption.title}</p>
                    {optimizations.caption.description && (
                      <p className="text-gray-600 mt-1">{optimizations.caption.description}</p>
                    )}
                    {optimizations.caption.hashtags.length > 0 && (
                      <div className="mt-2">
                        {optimizations.caption.hashtags.map((tag, index) => (
                          <Badge key={index} variant="secondary" className="mr-1 text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {optimizations.hashtags && (
                <div className="space-y-2">
                  <h4 className="font-medium text-sm">Trending Hashtags</h4>
                  <div className="space-y-1">
                    {optimizations.hashtags.slice(0, 5).map((hashtag, index) => (
                      <div key={index} className="flex items-center justify-between text-xs">
                        <span>{hashtag.hashtag}</span>
                        <div className="flex items-center gap-1">
                          {hashtag.trending && <TrendingUp className="h-3 w-3 text-green-600" />}
                          <span className="text-gray-500">
                            {(hashtag.relevanceScore * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Publishing Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Ready to Publish?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm space-y-2">
                <div className="flex justify-between">
                  <span>Selected platforms:</span>
                  <span className="font-medium">{formData.platforms.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Auto-optimize:</span>
                  <span className="font-medium">{formData.autoOptimize ? 'Yes' : 'No'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Requires approval:</span>
                  <span className="font-medium">{formData.approvalRequired ? 'Yes' : 'No'}</span>
                </div>
              </div>

              <Button
                onClick={handlePublish}
                disabled={!formData.title || !formData.videoFile || formData.platforms.length === 0 || isPublishing}
                className="w-full"
              >
                {isPublishing ? (
                  <>
                    <Upload className="h-4 w-4 mr-2 animate-pulse" />
                    Publishing...
                  </>
                ) : formData.approvalRequired ? (
                  <>
                    <Eye className="h-4 w-4 mr-2" />
                    Create Draft
                  </>
                ) : formData.globalScheduledAt ? (
                  <>
                    <Clock className="h-4 w-4 mr-2" />
                    Schedule
                  </>
                ) : (
                  <>
                    <Share2 className="h-4 w-4 mr-2" />
                    Publish Now
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}