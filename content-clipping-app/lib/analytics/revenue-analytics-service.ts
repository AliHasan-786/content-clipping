import { prisma } from '../prisma';

export interface RevenueAnalyticsData {
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
  timeSeriesData: {
    date: string;
    revenue: number;
    views: number;
    engagement: number;
    contentCount: number;
  }[];
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

export interface AnalyticsFilters {
  timeframe: 'day' | 'week' | 'month' | 'quarter' | 'year';
  startDate?: Date;
  endDate?: Date;
  platforms?: string[];
  accountIds?: string[];
  contentTypes?: string[];
}

export class RevenueAnalyticsService {
  private static platformRevenueMods = {
    youtube: {
      adRevenue: 0.55, // YouTube's 55% revenue share
      viewThreshold: 1000,
      baseRPM: 3.5
    },
    tiktok: {
      creatorFund: 0.02, // TikTok creator fund per 1000 views
      viewThreshold: 10000,
      baseRPM: 0.8
    },
    instagram: {
      reelsPlay: 0.012, // Instagram reels play bonus
      viewThreshold: 1000,
      baseRPM: 1.2
    },
    twitter: {
      monetization: 0.005, // Twitter/X monetization
      viewThreshold: 500,
      baseRPM: 0.5
    }
  };

  static async getRevenueAnalytics(
    userId: string,
    filters: AnalyticsFilters
  ): Promise<RevenueAnalyticsData> {
    const { timeframe, startDate, endDate, platforms, accountIds } = filters;
    
    // Calculate date range
    const dateRange = this.calculateDateRange(timeframe, startDate, endDate);
    
    // Build query filters
    const whereClause = this.buildWhereClause(userId, dateRange, platforms, accountIds);
    
    // Fetch core data
    const [
      publishedContent,
      revenueAnalytics,
      platformAccounts,
      contentAnalytics
    ] = await Promise.all([
      this.getPublishedContent(whereClause),
      this.getRevenueAnalytics(whereClause),
      this.getPlatformAccounts(userId, platforms, accountIds),
      this.getContentAnalytics(whereClause)
    ]);

    // Calculate overview metrics
    const overview = await this.calculateOverviewMetrics(
      publishedContent,
      revenueAnalytics,
      contentAnalytics
    );

    // Calculate platform-specific metrics
    const platformMetrics = await this.calculatePlatformMetrics(
      publishedContent,
      platformAccounts,
      contentAnalytics
    );

    // Generate time series data
    const timeSeriesData = await this.generateTimeSeriesData(
      publishedContent,
      dateRange
    );

    // Calculate forecasting
    const forecasting = await this.calculateForecasting(
      timeSeriesData,
      overview
    );

    // Generate content insights
    const contentInsights = await this.generateContentInsights(
      publishedContent,
      contentAnalytics
    );

    // Calculate monetization metrics
    const monetizationMetrics = await this.calculateMonetizationMetrics(
      publishedContent,
      contentAnalytics,
      platformAccounts
    );

    return {
      overview,
      platformMetrics,
      timeSeriesData,
      forecasting,
      contentInsights,
      monetizationMetrics
    };
  }

  private static calculateDateRange(
    timeframe: string,
    startDate?: Date,
    endDate?: Date
  ): { startDate: Date; endDate: Date } {
    const now = new Date();
    
    if (startDate && endDate) {
      return { startDate, endDate };
    }

    let calculatedStartDate: Date;
    
    switch (timeframe) {
      case 'day':
        calculatedStartDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        calculatedStartDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        calculatedStartDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'quarter':
        calculatedStartDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        calculatedStartDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        calculatedStartDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    return {
      startDate: calculatedStartDate,
      endDate: now
    };
  }

  private static buildWhereClause(
    userId: string,
    dateRange: { startDate: Date; endDate: Date },
    platforms?: string[],
    accountIds?: string[]
  ) {
    const where: any = {
      campaign: {
        userId,
        publishedAt: {
          gte: dateRange.startDate,
          lte: dateRange.endDate
        }
      }
    };

    if (platforms && platforms.length > 0) {
      where.campaign.platform = {
        name: { in: platforms }
      };
    }

    if (accountIds && accountIds.length > 0) {
      where.accountId = { in: accountIds };
    }

    return where;
  }

  private static async getPublishedContent(whereClause: any) {
    return await prisma.publishedContent.findMany({
      where: whereClause,
      include: {
        campaign: {
          include: {
            platform: true,
            clip: true,
            video: true
          }
        },
        account: true,
        analytics: {
          orderBy: { recordedAt: 'desc' },
          take: 1
        }
      },
      orderBy: { publishedAt: 'desc' }
    });
  }

  private static async getRevenueAnalytics(whereClause: any) {
    return await prisma.revenueAnalytics.findMany({
      where: {
        account: {
          publishedContent: {
            some: whereClause
          }
        }
      },
      orderBy: { calculatedAt: 'desc' }
    });
  }

  private static async getPlatformAccounts(
    userId: string,
    platforms?: string[],
    accountIds?: string[]
  ) {
    const where: any = { userId, isActive: true };

    if (platforms && platforms.length > 0) {
      where.platform = { name: { in: platforms } };
    }

    if (accountIds && accountIds.length > 0) {
      where.id = { in: accountIds };
    }

    return await prisma.platformAccount.findMany({
      where,
      include: {
        platform: true,
        revenueAnalytics: {
          orderBy: { calculatedAt: 'desc' },
          take: 10
        }
      }
    });
  }

  private static async getContentAnalytics(whereClause: any) {
    return await prisma.contentAnalytics.findMany({
      where: {
        content: whereClause
      },
      include: {
        content: {
          include: {
            campaign: {
              include: {
                platform: true
              }
            }
          }
        }
      },
      orderBy: { recordedAt: 'desc' }
    });
  }

  private static async calculateOverviewMetrics(
    publishedContent: any[],
    revenueAnalytics: any[],
    contentAnalytics: any[]
  ) {
    const totalRevenue = revenueAnalytics.reduce((sum, ra) => sum + ra.totalRevenue, 0);
    const totalViews = contentAnalytics.reduce((sum, ca) => sum + Number(ca.views), 0);
    const totalContent = publishedContent.length;
    
    // Calculate platform breakdown
    const revenueByPlatform: { [key: string]: number } = {};
    const viewsByPlatform: { [key: string]: number } = {};
    
    contentAnalytics.forEach(ca => {
      const platform = ca.content.campaign.platform.name;
      revenueByPlatform[platform] = (revenueByPlatform[platform] || 0) + ca.estimatedRevenue;
      viewsByPlatform[platform] = (viewsByPlatform[platform] || 0) + Number(ca.views);
    });

    const bestPerformingPlatform = Object.keys(revenueByPlatform).reduce((a, b) => 
      revenueByPlatform[a] > revenueByPlatform[b] ? a : b, 'unknown'
    );

    // Calculate growth
    const currentPeriodRevenue = totalRevenue;
    const previousPeriodRevenue = await this.getPreviousPeriodRevenue(revenueAnalytics);
    const monthlyGrowth = previousPeriodRevenue > 0 
      ? ((currentPeriodRevenue - previousPeriodRevenue) / previousPeriodRevenue) * 100 
      : 0;

    const averageRPM = totalViews > 0 ? (totalRevenue / totalViews) * 1000 : 0;
    const projectedRevenue = this.calculateProjectedRevenue(totalRevenue, monthlyGrowth);

    return {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      projectedRevenue: Math.round(projectedRevenue * 100) / 100,
      monthlyGrowth: Math.round(monthlyGrowth * 100) / 100,
      averageRPM: Math.round(averageRPM * 100) / 100,
      totalViews,
      totalContent,
      bestPerformingPlatform,
      revenueByPlatform
    };
  }

  private static async calculatePlatformMetrics(
    publishedContent: any[],
    platformAccounts: any[],
    contentAnalytics: any[]
  ) {
    const platformMetrics: { [key: string]: any } = {};

    for (const account of platformAccounts) {
      const platform = account.platform.name;
      
      if (!platformMetrics[platform]) {
        platformMetrics[platform] = {
          revenue: 0,
          views: 0,
          engagement: 0,
          rpm: 0,
          growth: 0,
          contentCount: 0,
          topContent: []
        };
      }

      // Get platform-specific content analytics
      const platformContent = publishedContent.filter(
        pc => pc.accountId === account.id
      );
      
      const platformAnalytics = contentAnalytics.filter(
        ca => ca.content.campaign.platform.name === platform
      );

      const revenue = platformAnalytics.reduce((sum, ca) => sum + ca.estimatedRevenue, 0);
      const views = platformAnalytics.reduce((sum, ca) => sum + Number(ca.views), 0);
      const totalEngagement = platformAnalytics.reduce((sum, ca) => 
        sum + Number(ca.likes) + Number(ca.comments) + Number(ca.shares), 0
      );

      platformMetrics[platform].revenue += revenue;
      platformMetrics[platform].views += views;
      platformMetrics[platform].engagement += totalEngagement;
      platformMetrics[platform].contentCount += platformContent.length;

      // Calculate RPM
      platformMetrics[platform].rpm = views > 0 ? (revenue / views) * 1000 : 0;

      // Get top content for this platform
      const topContent = platformAnalytics
        .sort((a, b) => b.estimatedRevenue - a.estimatedRevenue)
        .slice(0, 5)
        .map(ca => ({
          id: ca.content.id,
          title: ca.content.title,
          views: Number(ca.views),
          revenue: ca.estimatedRevenue,
          engagementRate: ca.engagementRate,
          publishedAt: ca.content.publishedAt
        }));

      platformMetrics[platform].topContent = topContent;

      // Calculate growth (simplified - would need historical data for accurate calculation)
      const recentRevenue = account.revenueAnalytics
        .slice(0, 2)
        .reduce((sum: number, ra: any) => sum + ra.totalRevenue, 0);
      
      platformMetrics[platform].growth = recentRevenue > 0 ? 10 : 0; // Placeholder
    }

    return platformMetrics;
  }

  private static async generateTimeSeriesData(
    publishedContent: any[],
    dateRange: { startDate: Date; endDate: Date }
  ) {
    const days = Math.ceil(
      (dateRange.endDate.getTime() - dateRange.startDate.getTime()) / (24 * 60 * 60 * 1000)
    );

    const timeSeriesData = [];
    
    for (let i = 0; i < days; i++) {
      const date = new Date(dateRange.startDate.getTime() + i * 24 * 60 * 60 * 1000);
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);

      const dayContent = publishedContent.filter(
        pc => pc.publishedAt >= dayStart && pc.publishedAt < dayEnd
      );

      const dayRevenue = dayContent.reduce(
        (sum, pc) => sum + (pc.analytics[0]?.estimatedRevenue || 0), 0
      );
      
      const dayViews = dayContent.reduce(
        (sum, pc) => sum + Number(pc.analytics[0]?.views || 0), 0
      );
      
      const dayEngagement = dayContent.reduce(
        (sum, pc) => sum + (pc.analytics[0]?.engagementRate || 0), 0
      );

      timeSeriesData.push({
        date: date.toISOString().split('T')[0],
        revenue: Math.round(dayRevenue * 100) / 100,
        views: dayViews,
        engagement: Math.round(dayEngagement * 100) / 100,
        contentCount: dayContent.length
      });
    }

    return timeSeriesData;
  }

  private static async calculateForecasting(
    timeSeriesData: any[],
    overview: any
  ) {
    // Simple linear regression for forecasting
    const recentTrend = this.calculateLinearTrend(
      timeSeriesData.slice(-14).map(d => d.revenue)
    );
    
    const viewsTrend = this.calculateLinearTrend(
      timeSeriesData.slice(-14).map(d => d.views)
    );

    const baseRevenue = overview.totalRevenue;
    const baseViews = overview.totalViews;
    const growthRate = overview.monthlyGrowth / 100;

    return {
      nextMonth: {
        projectedRevenue: Math.round(baseRevenue * (1 + growthRate) * 100) / 100,
        projectedViews: Math.round(baseViews * (1 + growthRate * 0.8)),
        confidence: this.calculateForecastConfidence(recentTrend)
      },
      nextQuarter: {
        projectedRevenue: Math.round(baseRevenue * Math.pow(1 + growthRate, 3) * 100) / 100,
        projectedViews: Math.round(baseViews * Math.pow(1 + growthRate * 0.8, 3)),
        confidence: this.calculateForecastConfidence(recentTrend) * 0.8
      },
      yearEnd: {
        projectedRevenue: Math.round(baseRevenue * Math.pow(1 + growthRate, 12) * 100) / 100,
        projectedViews: Math.round(baseViews * Math.pow(1 + growthRate * 0.8, 12)),
        confidence: this.calculateForecastConfidence(recentTrend) * 0.6
      }
    };
  }

  private static async generateContentInsights(
    publishedContent: any[],
    contentAnalytics: any[]
  ) {
    // Top performers
    const topPerformers = contentAnalytics
      .sort((a, b) => b.estimatedRevenue - a.estimatedRevenue)
      .slice(0, 10)
      .map(ca => ({
        id: ca.content.id,
        title: ca.content.title,
        platform: ca.content.campaign.platform.name,
        revenue: ca.estimatedRevenue,
        views: Number(ca.views),
        engagementRate: ca.engagementRate,
        publishedAt: ca.content.publishedAt
      }));

    // Underperformers
    const underperformers = contentAnalytics
      .filter(ca => ca.estimatedRevenue < 1 && Number(ca.views) < 1000)
      .slice(0, 5)
      .map(ca => ({
        id: ca.content.id,
        title: ca.content.title,
        platform: ca.content.campaign.platform.name,
        revenue: ca.estimatedRevenue,
        views: Number(ca.views),
        suggestions: this.generateOptimizationSuggestions(ca)
      }));

    // Viral content (high engagement rate)
    const viralContent = contentAnalytics
      .filter(ca => ca.engagementRate > 5.0)
      .sort((a, b) => b.engagementRate - a.engagementRate)
      .slice(0, 5)
      .map(ca => ({
        id: ca.content.id,
        title: ca.content.title,
        platform: ca.content.campaign.platform.name,
        engagementRate: ca.engagementRate,
        views: Number(ca.views),
        viralScore: this.calculateViralScore(ca)
      }));

    // Optimization suggestions
    const optimizationSuggestions = this.generateGlobalOptimizationSuggestions(
      contentAnalytics,
      publishedContent
    );

    return {
      topPerformers,
      underperformers,
      viralContent,
      optimizationSuggestions
    };
  }

  private static async calculateMonetizationMetrics(
    publishedContent: any[],
    contentAnalytics: any[],
    platformAccounts: any[]
  ) {
    const totalRevenue = contentAnalytics.reduce((sum, ca) => sum + ca.estimatedRevenue, 0);
    
    // Break down by revenue type (simplified estimates)
    const adRevenue = totalRevenue * 0.7; // Assume 70% from ads
    const sponsorshipRevenue = totalRevenue * 0.2; // 20% from sponsorships
    const platformIncentives = totalRevenue * 0.1; // 10% from platform incentives
    
    // Calculate missed revenue opportunities
    const totalViews = contentAnalytics.reduce((sum, ca) => sum + Number(ca.views), 0);
    const averageRPM = totalViews > 0 ? (totalRevenue / totalViews) * 1000 : 0;
    const potentialRevenue = this.calculatePotentialRevenue(contentAnalytics);
    const estimatedMissedRevenue = Math.max(0, potentialRevenue - totalRevenue);
    
    // Calculate optimization score
    const revenueOptimizationScore = this.calculateRevenueOptimizationScore(
      contentAnalytics,
      platformAccounts
    );

    return {
      adRevenue: Math.round(adRevenue * 100) / 100,
      sponsorshipRevenue: Math.round(sponsorshipRevenue * 100) / 100,
      platformIncentives: Math.round(platformIncentives * 100) / 100,
      estimatedMissedRevenue: Math.round(estimatedMissedRevenue * 100) / 100,
      revenueOptimizationScore: Math.round(revenueOptimizationScore * 100) / 100
    };
  }

  // Helper methods
  private static calculateLinearTrend(values: number[]): number {
    if (values.length < 2) return 0;
    
    const n = values.length;
    const sumX = (n * (n + 1)) / 2;
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = values.reduce((sum, y, x) => sum + y * (x + 1), 0);
    const sumX2 = (n * (n + 1) * (2 * n + 1)) / 6;
    
    return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  }

  private static calculateForecastConfidence(trend: number): number {
    return Math.max(0.3, Math.min(0.9, 0.7 + trend * 0.1));
  }

  private static calculateViralScore(analytics: any): number {
    const engagement = Number(analytics.likes) + Number(analytics.comments) + Number(analytics.shares);
    const views = Number(analytics.views);
    return views > 0 ? (engagement / views) * 100 : 0;
  }

  private static calculatePotentialRevenue(contentAnalytics: any[]): number {
    return contentAnalytics.reduce((sum, ca) => {
      const platform = ca.content.campaign.platform.name;
      const views = Number(ca.views);
      const platformMod = this.platformRevenueMods[platform as keyof typeof this.platformRevenueMods];
      
      if (platformMod && views >= platformMod.viewThreshold) {
        return sum + (views / 1000) * platformMod.baseRPM;
      }
      
      return sum;
    }, 0);
  }

  private static calculateRevenueOptimizationScore(
    contentAnalytics: any[],
    platformAccounts: any[]
  ): number {
    // Simplified scoring based on various factors
    let score = 50; // Base score
    
    // Factor in engagement rates
    const avgEngagement = contentAnalytics.reduce((sum, ca) => sum + ca.engagementRate, 0) / contentAnalytics.length;
    score += Math.min(30, avgEngagement * 5);
    
    // Factor in platform diversification
    const platformCount = new Set(contentAnalytics.map(ca => ca.content.campaign.platform.name)).size;
    score += Math.min(15, platformCount * 5);
    
    // Factor in posting consistency
    score += 5; // Placeholder for consistency calculation
    
    return Math.min(100, Math.max(0, score));
  }

  private static generateOptimizationSuggestions(analytics: any): string[] {
    const suggestions = [];
    
    if (analytics.engagementRate < 2.0) {
      suggestions.push('Improve content engagement with better hooks and CTAs');
    }
    
    if (Number(analytics.views) < 1000) {
      suggestions.push('Optimize posting times and hashtags for better reach');
    }
    
    if (analytics.completionRate < 50) {
      suggestions.push('Shorten content or improve retention with better pacing');
    }
    
    return suggestions;
  }

  private static generateGlobalOptimizationSuggestions(
    contentAnalytics: any[],
    publishedContent: any[]
  ): string[] {
    const suggestions = [];
    
    // Analyze platform performance
    const platformPerformance = new Map();
    contentAnalytics.forEach(ca => {
      const platform = ca.content.campaign.platform.name;
      if (!platformPerformance.has(platform)) {
        platformPerformance.set(platform, { revenue: 0, views: 0, count: 0 });
      }
      const perf = platformPerformance.get(platform);
      perf.revenue += ca.estimatedRevenue;
      perf.views += Number(ca.views);
      perf.count += 1;
    });
    
    // Find best performing platform
    let bestPlatform = '';
    let bestRPM = 0;
    platformPerformance.forEach((perf, platform) => {
      const rpm = perf.views > 0 ? (perf.revenue / perf.views) * 1000 : 0;
      if (rpm > bestRPM) {
        bestRPM = rpm;
        bestPlatform = platform;
      }
    });
    
    if (bestPlatform) {
      suggestions.push(`Focus more content on ${bestPlatform} - highest RPM at $${bestRPM.toFixed(2)}`);
    }
    
    // Analyze posting frequency
    const avgContentPerDay = publishedContent.length / 30; // Assuming 30 days
    if (avgContentPerDay < 1) {
      suggestions.push('Increase posting frequency to at least 1 piece of content per day');
    }
    
    // Analyze engagement patterns
    const avgEngagement = contentAnalytics.reduce((sum, ca) => sum + ca.engagementRate, 0) / contentAnalytics.length;
    if (avgEngagement < 3.0) {
      suggestions.push('Improve overall engagement with interactive content and community building');
    }
    
    return suggestions;
  }

  private static async getPreviousPeriodRevenue(revenueAnalytics: any[]): Promise<number> {
    // Simplified - would need more sophisticated date range calculation
    return revenueAnalytics.length > 5 
      ? revenueAnalytics.slice(5, 10).reduce((sum, ra) => sum + ra.totalRevenue, 0)
      : 0;
  }

  private static calculateProjectedRevenue(currentRevenue: number, growthRate: number): number {
    return currentRevenue * (1 + Math.max(-0.5, Math.min(2.0, growthRate / 100)));
  }
}