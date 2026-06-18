import { prisma } from './prisma';

export interface RevenueData {
  totalRevenue: number;
  estimatedRevenue: number;
  actualRevenue: number;
  dailyAverage: number;
  monthlyProjection: number;
  growthRate: number;
}

export interface EngagementMetrics {
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalWatchTime: number;
  avgEngagementRate: number;
  avgRetentionRate: number;
}

export interface ContentPerformanceData {
  viralContent: any[];
  trendingContent: any[];
  topPerformingContent: any[];
  contentGrowthVelocity: number;
  avgViralScore: number;
}

export interface ROIMetrics {
  totalROI: number;
  avgROI: number;
  profitMargin: number;
  paybackPeriod: number;
  totalCosts: number;
  costPerView: number;
}

export interface PlatformComparison {
  youtube: PlatformMetrics;
  tiktok: PlatformMetrics;
  instagram: PlatformMetrics;
  twitter: PlatformMetrics;
}

export interface PlatformMetrics {
  revenue: number;
  views: number;
  engagement: number;
  rpm: number;
  cpm: number;
  growth: number;
}

export interface ForecastData {
  dailyForecast: Array<{
    date: string;
    predictedViews: number;
    predictedRevenue: number;
    confidence: number;
  }>;
  weeklyForecast: Array<{
    week: string;
    predictedViews: number;
    predictedRevenue: number;
    confidence: number;
  }>;
  monthlyForecast: Array<{
    month: string;
    predictedViews: number;
    predictedRevenue: number;
    confidence: number;
  }>;
}

export class AnalyticsService {
  // Revenue Analytics
  static async getRevenueData(
    userId: string, 
    period: 'day' | 'week' | 'month' | 'year' = 'month',
    platform?: string
  ): Promise<RevenueData> {
    const dateRange = this.getDateRange(period);
    
    // Get user's platform accounts
    const accounts = await prisma.platformAccount.findMany({
      where: { 
        userId,
        ...(platform && { platform: { name: platform } })
      },
      include: { 
        revenueMetrics: {
          where: {
            recordedAt: {
              gte: dateRange.start,
              lte: dateRange.end
            }
          }
        }
      }
    });

    const allMetrics = accounts.flatMap(account => account.revenueMetrics);
    
    const totalRevenue = allMetrics.reduce((sum, metric) => 
      sum + (metric.actualRevenue || metric.estimatedRevenue), 0
    );
    
    const estimatedRevenue = allMetrics.reduce((sum, metric) => 
      sum + metric.estimatedRevenue, 0
    );
    
    const actualRevenue = allMetrics.reduce((sum, metric) => 
      sum + (metric.actualRevenue || 0), 0
    );

    // Calculate growth rate
    const previousPeriodRange = this.getPreviousDateRange(period);
    const previousMetrics = await prisma.revenueMetrics.findMany({
      where: {
        account: { userId },
        recordedAt: {
          gte: previousPeriodRange.start,
          lte: previousPeriodRange.end
        }
      }
    });
    
    const previousRevenue = previousMetrics.reduce((sum, metric) => 
      sum + (metric.actualRevenue || metric.estimatedRevenue), 0
    );
    
    const growthRate = previousRevenue > 0 
      ? ((totalRevenue - previousRevenue) / previousRevenue) * 100 
      : 0;

    const days = Math.ceil((dateRange.end.getTime() - dateRange.start.getTime()) / (1000 * 60 * 60 * 24));
    const dailyAverage = totalRevenue / Math.max(days, 1);
    const monthlyProjection = dailyAverage * 30;

    return {
      totalRevenue,
      estimatedRevenue,
      actualRevenue,
      dailyAverage,
      monthlyProjection,
      growthRate
    };
  }

  // Engagement Analytics
  static async getEngagementMetrics(
    userId: string,
    period: 'day' | 'week' | 'month' | 'year' = 'month',
    platform?: string
  ): Promise<EngagementMetrics> {
    const dateRange = this.getDateRange(period);
    
    const metrics = await prisma.revenueMetrics.findMany({
      where: {
        account: { 
          userId,
          ...(platform && { platform: { name: platform } })
        },
        recordedAt: {
          gte: dateRange.start,
          lte: dateRange.end
        }
      }
    });

    const totalViews = metrics.reduce((sum, metric) => sum + Number(metric.views), 0);
    const totalLikes = metrics.reduce((sum, metric) => sum + Number(metric.likes), 0);
    const totalComments = metrics.reduce((sum, metric) => sum + Number(metric.comments), 0);
    const totalShares = metrics.reduce((sum, metric) => sum + Number(metric.shares), 0);
    const totalWatchTime = metrics.reduce((sum, metric) => sum + Number(metric.watchTime), 0);

    const totalEngagement = totalLikes + totalComments + totalShares;
    const avgEngagementRate = totalViews > 0 ? (totalEngagement / totalViews) * 100 : 0;

    // Get content performance for retention rate
    const contentPerformance = await prisma.contentPerformance.findMany({
      where: {
        content: {
          campaign: {
            user: { id: userId }
          }
        },
        recordedAt: {
          gte: dateRange.start,
          lte: dateRange.end
        }
      }
    });

    const avgRetentionRate = contentPerformance.length > 0
      ? contentPerformance.reduce((sum, perf) => sum + perf.retentionRate, 0) / contentPerformance.length
      : 0;

    return {
      totalViews,
      totalLikes,
      totalComments,
      totalShares,
      totalWatchTime,
      avgEngagementRate,
      avgRetentionRate
    };
  }

  // Content Performance Analytics
  static async getContentPerformance(
    userId: string,
    period: 'day' | 'week' | 'month' | 'year' = 'month'
  ): Promise<ContentPerformanceData> {
    const dateRange = this.getDateRange(period);

    const contentPerformance = await prisma.contentPerformance.findMany({
      where: {
        content: {
          campaign: {
            user: { id: userId }
          }
        },
        recordedAt: {
          gte: dateRange.start,
          lte: dateRange.end
        }
      },
      include: {
        content: {
          include: {
            campaign: {
              include: {
                clip: true,
                video: true
              }
            }
          }
        }
      },
      orderBy: {
        viralScore: 'desc'
      }
    });

    const viralContent = contentPerformance.filter(perf => perf.isViral);
    const trendingContent = contentPerformance.filter(perf => perf.isTrending);
    const topPerformingContent = contentPerformance.slice(0, 10);

    const avgViralScore = contentPerformance.length > 0
      ? contentPerformance.reduce((sum, perf) => sum + perf.viralScore, 0) / contentPerformance.length
      : 0;

    const contentGrowthVelocity = contentPerformance.length > 0
      ? contentPerformance.reduce((sum, perf) => sum + perf.growthVelocity, 0) / contentPerformance.length
      : 0;

    return {
      viralContent: viralContent.slice(0, 5),
      trendingContent: trendingContent.slice(0, 5),
      topPerformingContent,
      contentGrowthVelocity,
      avgViralScore
    };
  }

  // ROI Analytics
  static async getROIMetrics(
    userId: string,
    period: 'day' | 'week' | 'month' | 'year' = 'month'
  ): Promise<ROIMetrics> {
    const dateRange = this.getDateRange(period);

    const roiAnalyses = await prisma.rOIAnalysis.findMany({
      where: {
        userId,
        analysisDate: {
          gte: dateRange.start,
          lte: dateRange.end
        }
      }
    });

    const totalROI = roiAnalyses.reduce((sum, analysis) => sum + analysis.roi, 0);
    const avgROI = roiAnalyses.length > 0 ? totalROI / roiAnalyses.length : 0;
    
    const totalRevenue = roiAnalyses.reduce((sum, analysis) => sum + analysis.totalRevenue, 0);
    const totalCosts = roiAnalyses.reduce((sum, analysis) => sum + analysis.totalCosts, 0);
    
    const profitMargin = totalRevenue > 0 ? ((totalRevenue - totalCosts) / totalRevenue) * 100 : 0;
    
    const avgPaybackPeriod = roiAnalyses.length > 0
      ? roiAnalyses
          .filter(analysis => analysis.paybackPeriod)
          .reduce((sum, analysis) => sum + (analysis.paybackPeriod || 0), 0) / 
        roiAnalyses.filter(analysis => analysis.paybackPeriod).length
      : 0;

    // Calculate cost per view
    const totalViews = await this.getTotalViews(userId, dateRange);
    const costPerView = totalViews > 0 ? totalCosts / totalViews : 0;

    return {
      totalROI: totalROI,
      avgROI,
      profitMargin,
      paybackPeriod: avgPaybackPeriod,
      totalCosts,
      costPerView
    };
  }

  // Platform Comparison
  static async getPlatformComparison(
    userId: string,
    period: 'day' | 'week' | 'month' | 'year' = 'month'
  ): Promise<PlatformComparison> {
    const platforms = ['youtube', 'tiktok', 'instagram', 'twitter'];
    const comparison: any = {};

    for (const platform of platforms) {
      const revenueData = await this.getRevenueData(userId, period, platform);
      const engagementData = await this.getEngagementMetrics(userId, period, platform);
      
      // Get platform-specific metrics
      const platformMetrics = await this.getPlatformMetrics(userId, platform, period);
      
      comparison[platform] = {
        revenue: revenueData.totalRevenue,
        views: engagementData.totalViews,
        engagement: engagementData.avgEngagementRate,
        rpm: platformMetrics.rpm,
        cpm: platformMetrics.cpm,
        growth: revenueData.growthRate
      };
    }

    return comparison as PlatformComparison;
  }

  // Revenue Forecasting
  static async generateForecast(
    userId: string,
    platform?: string
  ): Promise<ForecastData> {
    // Get existing forecasts
    const accounts = await prisma.platformAccount.findMany({
      where: {
        userId,
        ...(platform && { platform: { name: platform } })
      },
      include: {
        revenueForecasts: {
          where: {
            forecastDate: {
              gte: new Date(),
              lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // Next 30 days
            }
          },
          orderBy: {
            forecastDate: 'asc'
          }
        }
      }
    });

    const allForecasts = accounts.flatMap(account => account.revenueForecasts);

    // Group forecasts by period
    const dailyForecasts = allForecasts
      .filter(f => f.forecastPeriod === 'daily')
      .map(f => ({
        date: f.forecastDate.toISOString().split('T')[0],
        predictedViews: Number(f.predictedViews),
        predictedRevenue: f.predictedRevenue,
        confidence: f.confidence
      }));

    const weeklyForecasts = allForecasts
      .filter(f => f.forecastPeriod === 'weekly')
      .map(f => ({
        week: this.getWeekString(f.forecastDate),
        predictedViews: Number(f.predictedViews),
        predictedRevenue: f.predictedRevenue,
        confidence: f.confidence
      }));

    const monthlyForecasts = allForecasts
      .filter(f => f.forecastPeriod === 'monthly')
      .map(f => ({
        month: f.forecastDate.toISOString().slice(0, 7),
        predictedViews: Number(f.predictedViews),
        predictedRevenue: f.predictedRevenue,
        confidence: f.confidence
      }));

    return {
      dailyForecast: dailyForecasts,
      weeklyForecast: weeklyForecasts,
      monthlyForecast: monthlyForecasts
    };
  }

  // Helper Methods
  private static getDateRange(period: 'day' | 'week' | 'month' | 'year') {
    const now = new Date();
    const start = new Date(now);
    
    switch (period) {
      case 'day':
        start.setDate(now.getDate() - 1);
        break;
      case 'week':
        start.setDate(now.getDate() - 7);
        break;
      case 'month':
        start.setMonth(now.getMonth() - 1);
        break;
      case 'year':
        start.setFullYear(now.getFullYear() - 1);
        break;
    }
    
    return { start, end: now };
  }

  private static getPreviousDateRange(period: 'day' | 'week' | 'month' | 'year') {
    const now = new Date();
    const end = new Date(now);
    const start = new Date(now);
    
    switch (period) {
      case 'day':
        start.setDate(now.getDate() - 2);
        end.setDate(now.getDate() - 1);
        break;
      case 'week':
        start.setDate(now.getDate() - 14);
        end.setDate(now.getDate() - 7);
        break;
      case 'month':
        start.setMonth(now.getMonth() - 2);
        end.setMonth(now.getMonth() - 1);
        break;
      case 'year':
        start.setFullYear(now.getFullYear() - 2);
        end.setFullYear(now.getFullYear() - 1);
        break;
    }
    
    return { start, end };
  }

  private static async getPlatformMetrics(userId: string, platform: string, period: string) {
    const dateRange = this.getDateRange(period as any);
    
    const metrics = await prisma.revenueMetrics.findMany({
      where: {
        account: {
          userId,
          platform: { name: platform }
        },
        recordedAt: {
          gte: dateRange.start,
          lte: dateRange.end
        }
      }
    });

    const avgRpm = metrics.length > 0 
      ? metrics.reduce((sum, m) => sum + (m.rpm || 0), 0) / metrics.length 
      : 0;
    
    const avgCpm = metrics.length > 0 
      ? metrics.reduce((sum, m) => sum + (m.cpm || 0), 0) / metrics.length 
      : 0;

    return { rpm: avgRpm, cpm: avgCpm };
  }

  private static async getTotalViews(userId: string, dateRange: { start: Date; end: Date }) {
    const metrics = await prisma.revenueMetrics.findMany({
      where: {
        account: { userId },
        recordedAt: {
          gte: dateRange.start,
          lte: dateRange.end
        }
      }
    });

    return metrics.reduce((sum, metric) => sum + Number(metric.views), 0);
  }

  private static getWeekString(date: Date): string {
    const year = date.getFullYear();
    const weekNumber = Math.ceil(
      ((date.getTime() - new Date(year, 0, 1).getTime()) / 86400000 + 1) / 7
    );
    return `${year}-W${weekNumber.toString().padStart(2, '0')}`;
  }

  // Data Export Methods
  static async exportAnalyticsData(
    userId: string,
    format: 'csv' | 'json' = 'json',
    period: 'day' | 'week' | 'month' | 'year' = 'month'
  ) {
    const [revenue, engagement, performance, roi, platformComparison] = await Promise.all([
      this.getRevenueData(userId, period),
      this.getEngagementMetrics(userId, period),
      this.getContentPerformance(userId, period),
      this.getROIMetrics(userId, period),
      this.getPlatformComparison(userId, period)
    ]);

    const data = {
      revenue,
      engagement,
      performance,
      roi,
      platformComparison,
      exportedAt: new Date().toISOString(),
      period
    };

    if (format === 'csv') {
      return this.convertToCSV(data);
    }

    return data;
  }

  private static convertToCSV(data: any): string {
    // Flatten the data structure for CSV export
    const flatData = [
      ['Metric', 'Value'],
      ['Total Revenue', data.revenue.totalRevenue],
      ['Daily Average', data.revenue.dailyAverage],
      ['Growth Rate', data.revenue.growthRate + '%'],
      ['Total Views', data.engagement.totalViews],
      ['Engagement Rate', data.engagement.avgEngagementRate + '%'],
      ['Viral Score', data.performance.avgViralScore],
      ['ROI', data.roi.avgROI + '%'],
      ['Profit Margin', data.roi.profitMargin + '%']
    ];

    return flatData.map(row => row.join(',')).join('\n');
  }
}

export default AnalyticsService;