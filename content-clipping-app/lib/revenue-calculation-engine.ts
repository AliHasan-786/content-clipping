import { prisma } from './prisma';

export interface PlatformRates {
  youtube: {
    cpm: number; // Cost per mille
    rpm: number; // Revenue per mille
    watchTimeThreshold: number; // Seconds required for monetization
    eligibilityThreshold: {
      subscribers: number;
      watchHours: number;
    };
  };
  tiktok: {
    creatorFundRate: number; // Per 1000 views
    bonusMultiplier: number;
    eligibilityThreshold: {
      followers: number;
      views: number;
    };
  };
  instagram: {
    reelsPlayBonus: number; // Per 1000 plays
    cpm: number;
    eligibilityThreshold: {
      followers: number;
      profileViews: number;
    };
  };
  twitter: {
    rpm: number;
    eligibilityThreshold: {
      followers: number;
      impressions: number;
    };
  };
}

export const DEFAULT_PLATFORM_RATES: PlatformRates = {
  youtube: {
    cpm: 1.50, // $1.50 per 1000 views (average)
    rpm: 0.50, // $0.50 per 1000 views for creator
    watchTimeThreshold: 30,
    eligibilityThreshold: {
      subscribers: 1000,
      watchHours: 4000
    }
  },
  tiktok: {
    creatorFundRate: 0.40, // $0.40 per 1000 views
    bonusMultiplier: 1.2,
    eligibilityThreshold: {
      followers: 10000,
      views: 100000
    }
  },
  instagram: {
    reelsPlayBonus: 0.30, // $0.30 per 1000 plays
    cpm: 1.20,
    eligibilityThreshold: {
      followers: 1000,
      profileViews: 10000
    }
  },
  twitter: {
    rpm: 0.25, // $0.25 per 1000 impressions
    eligibilityThreshold: {
      followers: 500,
      impressions: 5000
    }
  }
};

export class RevenueCalculationEngine {
  private static platformRates = DEFAULT_PLATFORM_RATES;

  // Update platform rates based on user's actual performance
  static async updatePlatformRates(userId: string) {
    const accounts = await prisma.platformAccount.findMany({
      where: { userId },
      include: {
        monetizationConfig: true,
        revenueMetrics: {
          take: 30,
          orderBy: { recordedAt: 'desc' }
        }
      }
    });

    for (const account of accounts) {
      const platform = account.platform as any;
      const config = account.monetizationConfig[0];
      
      if (config && account.revenueMetrics.length > 0) {
        const avgRpm = this.calculateAverageRPM(account.revenueMetrics);
        const avgCpm = this.calculateAverageCPM(account.revenueMetrics);
        
        // Update rates based on actual performance
        if (platform && this.platformRates[platform.name as keyof PlatformRates]) {
          const platformRate = this.platformRates[platform.name as keyof PlatformRates] as any;
          if (avgRpm > 0) platformRate.rpm = avgRpm;
          if (avgCpm > 0) platformRate.cpm = avgCpm;
        }
      }
    }
  }

  // Calculate estimated revenue for new content
  static async estimateRevenue(
    contentId: string,
    views: number,
    watchTime: number,
    platform: string
  ): Promise<{
    estimatedRevenue: number;
    confidence: number;
    breakdown: any;
  }> {
    const platformRate = this.platformRates[platform as keyof PlatformRates];
    if (!platformRate) {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    let estimatedRevenue = 0;
    let confidence = 0.7; // Base confidence
    const breakdown: any = {};

    switch (platform) {
      case 'youtube':
        const youtubeRate = platformRate as PlatformRates['youtube'];
        const monetizableViews = watchTime >= youtubeRate.watchTimeThreshold ? views : 0;
        estimatedRevenue = (monetizableViews / 1000) * youtubeRate.rpm;
        breakdown.monetizableViews = monetizableViews;
        breakdown.rpm = youtubeRate.rpm;
        break;

      case 'tiktok':
        const tiktokRate = platformRate as PlatformRates['tiktok'];
        estimatedRevenue = (views / 1000) * tiktokRate.creatorFundRate;
        breakdown.views = views;
        breakdown.rate = tiktokRate.creatorFundRate;
        break;

      case 'instagram':
        const instagramRate = platformRate as PlatformRates['instagram'];
        estimatedRevenue = (views / 1000) * instagramRate.reelsPlayBonus;
        breakdown.views = views;
        breakdown.rate = instagramRate.reelsPlayBonus;
        break;

      case 'twitter':
        const twitterRate = platformRate as PlatformRates['twitter'];
        estimatedRevenue = (views / 1000) * twitterRate.rpm;
        breakdown.views = views;
        breakdown.rpm = twitterRate.rpm;
        break;
    }

    // Adjust confidence based on historical accuracy
    const historicalAccuracy = await this.getHistoricalAccuracy(platform);
    confidence = Math.min(confidence * historicalAccuracy, 1.0);

    return {
      estimatedRevenue: Number(estimatedRevenue.toFixed(4)),
      confidence: Number(confidence.toFixed(3)),
      breakdown
    };
  }

  // Calculate actual revenue from platform data
  static async calculateActualRevenue(
    contentId: string,
    platformData: {
      views: number;
      watchTime: number;
      cpm?: number;
      rpm?: number;
      adRevenue?: number;
    },
    platform: string
  ): Promise<number> {
    // Use actual platform data when available
    if (platformData.adRevenue) {
      return platformData.adRevenue;
    }

    if (platformData.rpm) {
      return (platformData.views / 1000) * platformData.rpm;
    }

    // Fall back to estimation
    const estimation = await this.estimateRevenue(
      contentId,
      platformData.views,
      platformData.watchTime,
      platform
    );

    return estimation.estimatedRevenue;
  }

  // Update revenue metrics with calculated data
  static async updateRevenueMetrics(
    accountId: string,
    contentId: string,
    platformData: {
      views: number;
      likes: number;
      comments: number;
      shares: number;
      saves?: number;
      watchTime: number;
      cpm?: number;
      rpm?: number;
      adRevenue?: number;
    },
    platform: string
  ) {
    const account = await prisma.platformAccount.findUnique({
      where: { id: accountId }
    });

    if (!account) {
      throw new Error('Account not found');
    }

    // Calculate estimated and actual revenue
    const estimated = await this.estimateRevenue(
      contentId,
      platformData.views,
      platformData.watchTime,
      platform
    );

    const actualRevenue = await this.calculateActualRevenue(
      contentId,
      platformData,
      platform
    );

    // Create or update revenue metrics
    const now = new Date();
    const periodStart = new Date(now.setHours(0, 0, 0, 0));
    const periodEnd = new Date(now.setHours(23, 59, 59, 999));

    await prisma.revenueMetrics.upsert({
      where: {
        contentId_recordedAt: {
          contentId,
          recordedAt: now
        }
      },
      update: {
        estimatedRevenue: estimated.estimatedRevenue,
        actualRevenue: actualRevenue > 0 ? actualRevenue : undefined,
        cpm: platformData.cpm,
        rpm: platformData.rpm,
        views: BigInt(platformData.views),
        watchTime: BigInt(platformData.watchTime),
        likes: BigInt(platformData.likes),
        comments: BigInt(platformData.comments),
        shares: BigInt(platformData.shares),
        saves: BigInt(platformData.saves || 0),
        confidence: estimated.confidence,
        metadata: estimated.breakdown
      },
      create: {
        accountId,
        contentId,
        platform,
        estimatedRevenue: estimated.estimatedRevenue,
        actualRevenue: actualRevenue > 0 ? actualRevenue : undefined,
        cpm: platformData.cpm,
        rpm: platformData.rpm,
        views: BigInt(platformData.views),
        watchTime: BigInt(platformData.watchTime),
        likes: BigInt(platformData.likes),
        comments: BigInt(platformData.comments),
        shares: BigInt(platformData.shares),
        saves: BigInt(platformData.saves || 0),
        periodStart,
        periodEnd,
        dataSource: actualRevenue > 0 ? 'platform_api' : 'estimated',
        confidence: estimated.confidence,
        metadata: estimated.breakdown
      }
    });

    // Update content performance metrics
    await this.updateContentPerformance(contentId, platformData, platform);

    return {
      estimatedRevenue: estimated.estimatedRevenue,
      actualRevenue: actualRevenue > 0 ? actualRevenue : null,
      confidence: estimated.confidence
    };
  }

  // Calculate ROI for campaigns
  static async calculateROI(
    campaignId: string,
    costs: {
      production: number;
      marketing: number;
      operational: number;
    }
  ) {
    const campaign = await prisma.publishingCampaign.findUnique({
      where: { id: campaignId },
      include: {
        publishedContent: {
          include: {
            revenueMetrics: true
          }
        }
      }
    });

    if (!campaign) {
      throw new Error('Campaign not found');
    }

    // Calculate total revenue from all content in campaign
    const totalRevenue = campaign.publishedContent.reduce((sum, content) => {
      return sum + content.revenueMetrics.reduce((contentSum, metric) => {
        return contentSum + (metric.actualRevenue || metric.estimatedRevenue);
      }, 0);
    }, 0);

    const totalCosts = costs.production + costs.marketing + costs.operational;
    const roi = totalCosts > 0 ? ((totalRevenue - totalCosts) / totalCosts) * 100 : 0;
    const profitMargin = totalRevenue > 0 ? ((totalRevenue - totalCosts) / totalRevenue) * 100 : 0;

    // Calculate payback period (days to break even)
    const dailyRevenue = totalRevenue / Math.max(
      Math.ceil((new Date().getTime() - campaign.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
      1
    );
    const paybackPeriod = dailyRevenue > 0 ? Math.ceil(totalCosts / dailyRevenue) : null;

    // Create ROI analysis record
    await prisma.rOIAnalysis.create({
      data: {
        campaignId,
        userId: campaign.userId,
        productionCosts: costs.production,
        marketingCosts: costs.marketing,
        operationalCosts: costs.operational,
        totalCosts,
        directRevenue: totalRevenue,
        totalRevenue,
        roi: roi / 100, // Store as decimal
        roiPercentage: roi,
        paybackPeriod,
        profitMargin: profitMargin / 100,
        periodStart: campaign.createdAt,
        periodEnd: new Date()
      }
    });

    return {
      roi,
      totalRevenue,
      totalCosts,
      profitMargin,
      paybackPeriod
    };
  }

  // Revenue forecasting using historical data
  static async generateRevenueForecast(
    accountId: string,
    days: number = 30
  ) {
    const account = await prisma.platformAccount.findUnique({
      where: { id: accountId },
      include: {
        revenueMetrics: {
          take: 90, // Last 90 days for trend analysis
          orderBy: { recordedAt: 'desc' }
        },
        platform: true
      }
    });

    if (!account || account.revenueMetrics.length === 0) {
      throw new Error('Insufficient data for forecasting');
    }

    const historicalData = account.revenueMetrics.map(metric => ({
      date: metric.recordedAt,
      revenue: metric.actualRevenue || metric.estimatedRevenue,
      views: Number(metric.views)
    }));

    // Calculate trend factors
    const { trendFactor, seasonalFactor, baselineRevenue, baselineViews } = 
      this.analyzeTrends(historicalData);

    const forecasts = [];
    const startDate = new Date();

    for (let i = 1; i <= days; i++) {
      const forecastDate = new Date(startDate);
      forecastDate.setDate(startDate.getDate() + i);

      const seasonalMultiplier = this.getSeasonalMultiplier(forecastDate);
      const predictedViews = Math.round(baselineViews * trendFactor * seasonalMultiplier);
      const predictedRevenue = baselineRevenue * trendFactor * seasonalMultiplier;

      // Confidence decreases over time
      const confidence = Math.max(0.5, 0.9 - (i / days) * 0.4);

      forecasts.push({
        date: forecastDate,
        predictedViews: BigInt(predictedViews),
        predictedRevenue,
        confidence,
        baselineViews: BigInt(baselineViews),
        trendFactor,
        seasonalFactor: seasonalMultiplier,
        contentFactor: 1.0 // Could be enhanced with content quality analysis
      });
    }

    // Save forecasts to database
    await prisma.revenueForecasts.createMany({
      data: forecasts.map(forecast => ({
        accountId,
        platform: account.platform.name,
        forecastDate: forecast.date,
        forecastPeriod: 'daily',
        predictedViews: forecast.predictedViews,
        predictedRevenue: forecast.predictedRevenue,
        confidence: forecast.confidence,
        baselineViews: forecast.baselineViews,
        trendFactor: forecast.trendFactor,
        seasonalFactor: forecast.seasonalFactor,
        contentFactor: forecast.contentFactor,
        modelVersion: '1.0'
      }))
    });

    return forecasts;
  }

  // Helper Methods
  private static calculateAverageRPM(metrics: any[]) {
    const validMetrics = metrics.filter(m => m.rpm && m.rpm > 0);
    if (validMetrics.length === 0) return 0;
    return validMetrics.reduce((sum, m) => sum + m.rpm, 0) / validMetrics.length;
  }

  private static calculateAverageCPM(metrics: any[]) {
    const validMetrics = metrics.filter(m => m.cpm && m.cpm > 0);
    if (validMetrics.length === 0) return 0;
    return validMetrics.reduce((sum, m) => sum + m.cpm, 0) / validMetrics.length;
  }

  private static async getHistoricalAccuracy(platform: string): Promise<number> {
    const forecasts = await prisma.revenueForecasts.findMany({
      where: {
        platform,
        accuracy: { not: null },
        forecastDate: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
        }
      }
    });

    if (forecasts.length === 0) return 0.7; // Default accuracy

    const avgAccuracy = forecasts.reduce((sum, f) => sum + (f.accuracy || 0), 0) / forecasts.length;
    return Math.max(0.3, Math.min(1.0, avgAccuracy));
  }

  private static async updateContentPerformance(
    contentId: string, 
    platformData: any, 
    platform: string
  ) {
    const content = await prisma.publishedContent.findUnique({
      where: { id: contentId }
    });

    if (!content) return;

    const engagementRate = platformData.views > 0 
      ? ((platformData.likes + platformData.comments + platformData.shares) / platformData.views) * 100 
      : 0;

    const viralScore = this.calculateViralScore(platformData, platform);
    const growthVelocity = this.calculateGrowthVelocity(platformData, content.publishedAt);

    await prisma.contentPerformance.upsert({
      where: {
        contentId_recordedAt: {
          contentId,
          recordedAt: new Date()
        }
      },
      update: {
        viralScore,
        growthVelocity,
        peakViews: BigInt(platformData.views),
        retentionRate: platformData.watchTime > 0 ? (platformData.watchTime / 60) * 100 : 0,
        likeRatio: platformData.views > 0 ? (platformData.likes / platformData.views) * 100 : 0,
        commentRatio: platformData.views > 0 ? (platformData.comments / platformData.views) * 100 : 0,
        shareRatio: platformData.views > 0 ? (platformData.shares / platformData.views) * 100 : 0,
        engagementVelocity: engagementRate,
        totalRevenue: 0, // Will be updated by revenue calculation
        isViral: viralScore > 80,
        isTrending: growthVelocity > 1000 // 1000+ views per hour
      },
      create: {
        contentId,
        publishedAt: content.publishedAt,
        viralScore,
        growthVelocity,
        peakViews: BigInt(platformData.views),
        retentionRate: platformData.watchTime > 0 ? (platformData.watchTime / 60) * 100 : 0,
        likeRatio: platformData.views > 0 ? (platformData.likes / platformData.views) * 100 : 0,
        commentRatio: platformData.views > 0 ? (platformData.comments / platformData.views) * 100 : 0,
        shareRatio: platformData.views > 0 ? (platformData.shares / platformData.views) * 100 : 0,
        engagementVelocity: engagementRate,
        totalRevenue: 0,
        isViral: viralScore > 80,
        isTrending: growthVelocity > 1000,
        firstHourViews: BigInt(0),
        firstDayViews: BigInt(platformData.views)
      }
    });
  }

  private static calculateViralScore(platformData: any, platform: string): number {
    const engagementRate = platformData.views > 0 
      ? ((platformData.likes + platformData.comments + platformData.shares) / platformData.views) * 100 
      : 0;

    // Platform-specific viral thresholds
    const thresholds = {
      youtube: { views: 100000, engagement: 5 },
      tiktok: { views: 50000, engagement: 8 },
      instagram: { views: 25000, engagement: 6 },
      twitter: { views: 10000, engagement: 4 }
    };

    const threshold = thresholds[platform as keyof typeof thresholds];
    if (!threshold) return 0;

    const viewScore = Math.min((platformData.views / threshold.views) * 50, 50);
    const engagementScore = Math.min((engagementRate / threshold.engagement) * 50, 50);

    return viewScore + engagementScore;
  }

  private static calculateGrowthVelocity(platformData: any, publishedAt: Date): number {
    const hoursElapsed = Math.max(1, (new Date().getTime() - publishedAt.getTime()) / (1000 * 60 * 60));
    return platformData.views / hoursElapsed;
  }

  private static analyzeTrends(historicalData: any[]) {
    if (historicalData.length < 7) {
      return {
        trendFactor: 1.0,
        seasonalFactor: 1.0,
        baselineRevenue: 0,
        baselineViews: 0
      };
    }

    // Calculate baseline (average of last 7 days)
    const recentData = historicalData.slice(0, 7);
    const baselineRevenue = recentData.reduce((sum, d) => sum + d.revenue, 0) / recentData.length;
    const baselineViews = recentData.reduce((sum, d) => sum + d.views, 0) / recentData.length;

    // Calculate trend (growth rate over time)
    const oldData = historicalData.slice(-7);
    const oldAvgRevenue = oldData.reduce((sum, d) => sum + d.revenue, 0) / oldData.length;
    const trendFactor = oldAvgRevenue > 0 ? baselineRevenue / oldAvgRevenue : 1.0;

    return {
      trendFactor: Math.min(Math.max(trendFactor, 0.5), 2.0), // Cap between 0.5x and 2x
      seasonalFactor: 1.0,
      baselineRevenue,
      baselineViews
    };
  }

  private static getSeasonalMultiplier(date: Date): number {
    // Simple seasonal factors - could be enhanced with more sophisticated analysis
    const month = date.getMonth();
    const dayOfWeek = date.getDay();

    // Weekend boost
    const weekendMultiplier = (dayOfWeek === 0 || dayOfWeek === 6) ? 1.2 : 1.0;

    // Holiday season boost
    const holidayMultiplier = (month === 11 || month === 0) ? 1.3 : 1.0;

    return weekendMultiplier * holidayMultiplier;
  }
}

export default RevenueCalculationEngine;