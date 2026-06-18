import { prisma } from '../prisma';

export interface HashtagAnalytics {
  hashtag: string;
  platform: string;
  volume: number;
  growthRate: number;
  engagement: number;
  difficulty: number; // 1-10, how hard to rank
  sentiment: number; // -1 to 1
  category?: string;
  relatedHashtags: string[];
  optimalPostingTimes: number[]; // hours of day
  lastUpdated: Date;
}

export interface HashtagSuggestion {
  hashtag: string;
  relevanceScore: number;
  difficulty: number;
  expectedReach: number;
  category: string;
  trending: boolean;
}

export class HashtagService {
  private readonly maxSuggestions = 30;
  private readonly trendingThreshold = 0.8;
  
  // Get hashtag suggestions for content
  async suggestHashtags(
    content: string,
    platform: string,
    category?: string,
    targetAudience?: string
  ): Promise<HashtagSuggestion[]> {
    try {
      // Analyze content to extract topics
      const contentTopics = await this.analyzeContent(content);
      
      // Get category-specific hashtags
      const categoryHashtags = category 
        ? await this.getCategoryHashtags(category, platform)
        : [];

      // Get trending hashtags
      const trendingHashtags = await this.getTrendingHashtags(platform);

      // Get content-based hashtags
      const contentHashtags = await this.getContentBasedHashtags(contentTopics, platform);

      // Get audience-specific hashtags
      const audienceHashtags = targetAudience
        ? await this.getAudienceHashtags(targetAudience, platform)
        : [];

      // Combine and score all hashtags
      const allHashtags = [
        ...categoryHashtags,
        ...trendingHashtags,
        ...contentHashtags,
        ...audienceHashtags
      ];

      // Remove duplicates and score
      const uniqueHashtags = this.removeDuplicates(allHashtags);
      const scoredHashtags = await this.scoreHashtags(uniqueHashtags, content, platform);

      // Sort by relevance and return top suggestions
      return scoredHashtags
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, this.maxSuggestions);

    } catch (error) {
      console.error('Error suggesting hashtags:', error);
      return this.getFallbackHashtags(platform, category);
    }
  }

  // Get trending hashtags for a platform
  async getTrendingHashtags(platform: string, limit = 20): Promise<HashtagSuggestion[]> {
    try {
      const trending = await prisma.hashtagTrend.findMany({
        where: {
          platform: platform,
          trending: true,
          lastUpdated: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
          }
        },
        orderBy: {
          growthRate: 'desc'
        },
        take: limit
      });

      return trending.map(trend => ({
        hashtag: trend.hashtag,
        relevanceScore: 0.9, // High relevance for trending
        difficulty: Math.min(10, Math.max(1, Math.floor(trend.volume / 10000))),
        expectedReach: Number(trend.volume),
        category: trend.category || 'trending',
        trending: true
      }));

    } catch (error) {
      console.error('Error fetching trending hashtags:', error);
      return [];
    }
  }

  // Update hashtag trends and analytics
  async updateHashtagAnalytics(
    hashtag: string,
    platform: string,
    analytics: Partial<HashtagAnalytics>
  ): Promise<void> {
    try {
      await prisma.hashtagTrend.upsert({
        where: {
          hashtag_platform: {
            hashtag: hashtag,
            platform: platform
          }
        },
        update: {
          volume: analytics.volume ? BigInt(analytics.volume) : undefined,
          growthRate: analytics.growthRate,
          trending: analytics.growthRate ? analytics.growthRate > this.trendingThreshold : undefined,
          category: analytics.category,
          sentiment: analytics.sentiment,
          lastUpdated: new Date()
        },
        create: {
          hashtag: hashtag,
          platform: platform,
          volume: BigInt(analytics.volume || 0),
          growthRate: analytics.growthRate || 0,
          trending: analytics.growthRate ? analytics.growthRate > this.trendingThreshold : false,
          category: analytics.category,
          sentiment: analytics.sentiment || 0,
          lastUpdated: new Date()
        }
      });
    } catch (error) {
      console.error('Error updating hashtag analytics:', error);
    }
  }

  // Analyze hashtag performance
  async analyzeHashtagPerformance(
    hashtags: string[],
    platform: string,
    timeframe: 'day' | 'week' | 'month' = 'week'
  ): Promise<{
    hashtag: string;
    performance: {
      volume: number;
      engagement: number;
      reach: number;
      growth: number;
    };
  }[]> {
    try {
      const timeframeDays = timeframe === 'day' ? 1 : timeframe === 'week' ? 7 : 30;
      const startDate = new Date(Date.now() - timeframeDays * 24 * 60 * 60 * 1000);

      const hashtagData = await prisma.hashtagTrend.findMany({
        where: {
          hashtag: { in: hashtags },
          platform: platform,
          lastUpdated: { gte: startDate }
        }
      });

      return hashtagData.map(data => ({
        hashtag: data.hashtag,
        performance: {
          volume: Number(data.volume),
          engagement: 0, // Would calculate from actual post data
          reach: Number(data.volume) * 0.1, // Rough estimate
          growth: data.growthRate
        }
      }));

    } catch (error) {
      console.error('Error analyzing hashtag performance:', error);
      return [];
    }
  }

  // Get hashtag recommendations based on similar content
  async getRelatedHashtags(
    baseHashtags: string[],
    platform: string,
    limit = 15
  ): Promise<string[]> {
    try {
      // This would typically use ML models or graph analysis
      // For now, use simple pattern matching and category relationships
      
      const relatedTags: string[] = [];
      
      for (const hashtag of baseHashtags) {
        const hashtagData = await prisma.hashtagTrend.findFirst({
          where: {
            hashtag: hashtag,
            platform: platform
          }
        });

        if (hashtagData?.category) {
          const categoryTags = await this.getCategoryHashtags(hashtagData.category, platform);
          relatedTags.push(...categoryTags.map(tag => tag.hashtag));
        }
      }

      // Remove duplicates and base hashtags
      const uniqueRelated = [...new Set(relatedTags)]
        .filter(tag => !baseHashtags.includes(tag))
        .slice(0, limit);

      return uniqueRelated;

    } catch (error) {
      console.error('Error getting related hashtags:', error);
      return [];
    }
  }

  // Validate hashtag quality and appropriateness
  async validateHashtags(
    hashtags: string[],
    platform: string
  ): Promise<{
    hashtag: string;
    valid: boolean;
    issues: string[];
    suggestions?: string[];
  }[]> {
    return hashtags.map(hashtag => {
      const issues: string[] = [];
      const suggestions: string[] = [];

      // Check length
      if (hashtag.length > 100) {
        issues.push('Too long (max 100 characters)');
        suggestions.push(hashtag.substring(0, 97) + '...');
      }

      // Check for invalid characters
      if (!/^#[a-zA-Z0-9_]+$/.test(hashtag)) {
        issues.push('Contains invalid characters');
        suggestions.push('#' + hashtag.slice(1).replace(/[^a-zA-Z0-9_]/g, ''));
      }

      // Check for banned or inappropriate hashtags
      if (this.isBannedHashtag(hashtag)) {
        issues.push('Potentially banned or inappropriate');
      }

      // Platform-specific validation
      const platformIssues = this.validateForPlatform(hashtag, platform);
      issues.push(...platformIssues);

      return {
        hashtag,
        valid: issues.length === 0,
        issues,
        suggestions: suggestions.length > 0 ? suggestions : undefined
      };
    });
  }

  // Get optimal hashtag mix for maximum reach
  async getOptimalHashtagMix(
    content: string,
    platform: string,
    targetReach: 'niche' | 'broad' | 'viral' = 'broad'
  ): Promise<{
    trending: HashtagSuggestion[];
    niche: HashtagSuggestion[];
    branded: HashtagSuggestion[];
    community: HashtagSuggestion[];
  }> {
    const suggestions = await this.suggestHashtags(content, platform);
    
    return {
      trending: suggestions.filter(s => s.trending && s.difficulty <= 7).slice(0, 5),
      niche: suggestions.filter(s => s.difficulty <= 4 && s.relevanceScore > 0.7).slice(0, 10),
      branded: suggestions.filter(s => s.category === 'brand').slice(0, 3),
      community: suggestions.filter(s => s.category === 'community').slice(0, 7)
    };
  }

  private async analyzeContent(content: string): Promise<string[]> {
    // Simple content analysis - would be enhanced with NLP
    const words = content.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2)
      .filter(word => !this.isStopWord(word));

    // Extract meaningful topics
    const topics = words
      .filter(word => this.isRelevantTopic(word))
      .slice(0, 10);

    return [...new Set(topics)];
  }

  private async getCategoryHashtags(
    category: string,
    platform: string
  ): Promise<HashtagSuggestion[]> {
    const categoryMap = {
      gaming: ['gaming', 'gamer', 'esports', 'videogames', 'gamedev', 'streaming'],
      fitness: ['fitness', 'workout', 'health', 'gym', 'exercise', 'wellness'],
      food: ['food', 'recipe', 'cooking', 'foodie', 'delicious', 'chef'],
      travel: ['travel', 'wanderlust', 'adventure', 'vacation', 'explore', 'photography'],
      beauty: ['beauty', 'makeup', 'skincare', 'cosmetics', 'selfcare', 'fashion'],
      tech: ['tech', 'technology', 'innovation', 'ai', 'coding', 'startup'],
      music: ['music', 'song', 'artist', 'musician', 'audio', 'sound'],
      education: ['education', 'learning', 'tutorial', 'howto', 'tips', 'knowledge']
    };

    const categoryTags = categoryMap[category.toLowerCase()] || [];
    
    return categoryTags.map((tag, index) => ({
      hashtag: `#${tag}`,
      relevanceScore: 1.0 - (index * 0.05),
      difficulty: Math.floor(Math.random() * 5) + 3,
      expectedReach: 10000 - (index * 1000),
      category: category,
      trending: false
    }));
  }

  private async getContentBasedHashtags(
    topics: string[],
    platform: string
  ): Promise<HashtagSuggestion[]> {
    return topics.map((topic, index) => ({
      hashtag: `#${topic}`,
      relevanceScore: 0.8 - (index * 0.05),
      difficulty: Math.floor(Math.random() * 8) + 1,
      expectedReach: 5000 - (index * 500),
      category: 'content',
      trending: false
    }));
  }

  private async getAudienceHashtags(
    audience: string,
    platform: string
  ): Promise<HashtagSuggestion[]> {
    const audienceMap = {
      millennials: ['millennials', 'nostalgia', '90skids', 'adulting'],
      genz: ['genz', 'tiktok', 'viral', 'mood'],
      parents: ['parenting', 'family', 'kids', 'momlife', 'dadlife'],
      professionals: ['business', 'career', 'professional', 'networking'],
      students: ['student', 'college', 'studying', 'education']
    };

    const audienceTags = audienceMap[audience.toLowerCase()] || [];
    
    return audienceTags.map((tag, index) => ({
      hashtag: `#${tag}`,
      relevanceScore: 0.6 - (index * 0.05),
      difficulty: Math.floor(Math.random() * 6) + 2,
      expectedReach: 8000 - (index * 800),
      category: 'audience',
      trending: false
    }));
  }

  private removeDuplicates(hashtags: HashtagSuggestion[]): HashtagSuggestion[] {
    const seen = new Set<string>();
    return hashtags.filter(hashtag => {
      const key = hashtag.hashtag.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private async scoreHashtags(
    hashtags: HashtagSuggestion[],
    content: string,
    platform: string
  ): Promise<HashtagSuggestion[]> {
    return hashtags.map(hashtag => {
      // Adjust relevance based on content similarity
      const contentWords = content.toLowerCase().split(/\s+/);
      const hashtagWord = hashtag.hashtag.toLowerCase().replace('#', '');
      
      const isInContent = contentWords.some(word => 
        word.includes(hashtagWord) || hashtagWord.includes(word)
      );
      
      if (isInContent) {
        hashtag.relevanceScore *= 1.2;
      }

      // Platform-specific scoring adjustments
      hashtag.relevanceScore *= this.getPlatformMultiplier(platform, hashtag.category);

      return hashtag;
    });
  }

  private getPlatformMultiplier(platform: string, category: string): number {
    const multipliers = {
      youtube: { education: 1.2, tech: 1.1, entertainment: 1.0 },
      tiktok: { entertainment: 1.3, dance: 1.2, comedy: 1.2 },
      instagram: { fashion: 1.3, food: 1.2, travel: 1.2 },
      twitter: { news: 1.2, tech: 1.1, business: 1.1 }
    };

    return multipliers[platform]?.[category] || 1.0;
  }

  private getFallbackHashtags(platform: string, category?: string): HashtagSuggestion[] {
    const fallbacks = {
      youtube: ['#YouTube', '#Video', '#Content', '#Creator'],
      tiktok: ['#TikTok', '#ForYou', '#Viral', '#Trending'],
      instagram: ['#Instagram', '#Photo', '#InstaGood', '#Love'],
      twitter: ['#Twitter', '#Tweet', '#SocialMedia', '#News']
    };

    const platformTags = fallbacks[platform] || fallbacks.youtube;
    
    return platformTags.map((tag, index) => ({
      hashtag: tag,
      relevanceScore: 0.5 - (index * 0.1),
      difficulty: 5,
      expectedReach: 1000,
      category: category || 'general',
      trending: false
    }));
  }

  private isStopWord(word: string): boolean {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'among', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves']);
    return stopWords.has(word.toLowerCase());
  }

  private isRelevantTopic(word: string): boolean {
    // Check if word is likely to be a meaningful topic
    if (word.length < 3) return false;
    if (this.isStopWord(word)) return false;
    if (/^\d+$/.test(word)) return false; // Pure numbers
    
    return true;
  }

  private isBannedHashtag(hashtag: string): boolean {
    // List of banned or inappropriate hashtags
    const banned = ['#spam', '#bot', '#fake', '#scam'];
    return banned.some(b => hashtag.toLowerCase().includes(b.toLowerCase()));
  }

  private validateForPlatform(hashtag: string, platform: string): string[] {
    const issues: string[] = [];

    switch (platform) {
      case 'twitter':
        if (hashtag.length > 100) {
          issues.push('Twitter hashtags should be under 100 characters');
        }
        break;
      case 'instagram':
        if (hashtag.length > 30) {
          issues.push('Instagram hashtags should be under 30 characters');
        }
        break;
      case 'tiktok':
        if (hashtag.includes('_')) {
          issues.push('TikTok hashtags work better without underscores');
        }
        break;
    }

    return issues;
  }

  // Schedule regular hashtag trend updates
  async scheduleHashtagUpdates(): Promise<void> {
    // This would typically run as a background job
    console.log('Scheduling hashtag trend updates...');
    // Implementation would depend on your job queue system
  }

  // Clean up old hashtag data
  async cleanupOldHashtagData(daysToKeep = 30): Promise<void> {
    try {
      const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
      
      await prisma.hashtagTrend.deleteMany({
        where: {
          lastUpdated: {
            lt: cutoffDate
          },
          trending: false
        }
      });

      console.log('Cleaned up old hashtag trend data');
    } catch (error) {
      console.error('Error cleaning up hashtag data:', error);
    }
  }
}