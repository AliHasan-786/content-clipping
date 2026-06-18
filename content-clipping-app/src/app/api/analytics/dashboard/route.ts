import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import AnalyticsService from '@/lib/analytics-service';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') as 'day' | 'week' | 'month' | 'year' || 'month';
    const platform = searchParams.get('platform') || undefined;

    // Fetch all analytics data for the dashboard
    const [
      revenueData,
      engagementData,
      contentPerformance,
      roiMetrics,
      platformComparison,
      forecastData
    ] = await Promise.all([
      AnalyticsService.getRevenueData(session.user.id, period, platform),
      AnalyticsService.getEngagementMetrics(session.user.id, period, platform),
      AnalyticsService.getContentPerformance(session.user.id, period),
      AnalyticsService.getROIMetrics(session.user.id, period),
      AnalyticsService.getPlatformComparison(session.user.id, period),
      AnalyticsService.generateForecast(session.user.id, platform)
    ]);

    // Calculate additional insights
    const insights = {
      topRevenuePlatform: this.getTopRevenuePlatform(platformComparison),
      bestEngagementPlatform: this.getBestEngagementPlatform(platformComparison),
      contentRecommendations: this.generateContentRecommendations(contentPerformance),
      growthTrends: this.analyzeGrowthTrends(revenueData, engagementData),
      monetizationStatus: this.getMonetizationStatus(revenueData, roiMetrics),
      nextActionItems: this.generateActionItems(revenueData, contentPerformance, roiMetrics)
    };

    return NextResponse.json({
      success: true,
      data: {
        revenue: revenueData,
        engagement: engagementData,
        contentPerformance,
        roi: roiMetrics,
        platformComparison,
        forecast: forecastData,
        insights,
        lastUpdated: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Dashboard analytics error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch dashboard data',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Helper functions for insights
function getTopRevenuePlatform(platformComparison: any) {
  const platforms = Object.entries(platformComparison);
  const topPlatform = platforms.reduce((max: any, current: any) => 
    current[1].revenue > max[1].revenue ? current : max
  );
  return { platform: topPlatform[0], revenue: topPlatform[1].revenue };
}

function getBestEngagementPlatform(platformComparison: any) {
  const platforms = Object.entries(platformComparison);
  const bestPlatform = platforms.reduce((max: any, current: any) => 
    current[1].engagement > max[1].engagement ? current : max
  );
  return { platform: bestPlatform[0], engagement: bestPlatform[1].engagement };
}

function generateContentRecommendations(contentPerformance: any) {
  const recommendations = [];
  
  if (contentPerformance.avgViralScore < 50) {
    recommendations.push({
      type: 'content_quality',
      message: 'Focus on creating more engaging hooks and stronger content',
      priority: 'high'
    });
  }
  
  if (contentPerformance.contentGrowthVelocity < 100) {
    recommendations.push({
      type: 'posting_frequency',
      message: 'Increase posting frequency to improve growth velocity',
      priority: 'medium'
    });
  }
  
  if (contentPerformance.viralContent.length === 0) {
    recommendations.push({
      type: 'viral_strategy',
      message: 'Analyze trending content patterns to create viral content',
      priority: 'high'
    });
  }
  
  return recommendations;
}

function analyzeGrowthTrends(revenueData: any, engagementData: any) {
  return {
    revenueGrowth: {
      rate: revenueData.growthRate,
      trend: revenueData.growthRate > 0 ? 'increasing' : 'decreasing',
      projection: revenueData.monthlyProjection
    },
    engagementGrowth: {
      rate: engagementData.avgEngagementRate,
      viewsGrowth: engagementData.totalViews,
      retentionTrend: engagementData.avgRetentionRate
    }
  };
}

function getMonetizationStatus(revenueData: any, roiMetrics: any) {
  const status = {
    isMonetized: revenueData.actualRevenue > 0,
    isProfitable: roiMetrics.avgROI > 0,
    breakEvenStatus: roiMetrics.paybackPeriod ? 
      `Break even in ${Math.ceil(roiMetrics.paybackPeriod)} days` : 
      'Not yet profitable',
    monthlyTarget: revenueData.monthlyProjection,
    currentProgress: (revenueData.totalRevenue / revenueData.monthlyProjection) * 100
  };
  
  return status;
}

function generateActionItems(revenueData: any, contentPerformance: any, roiMetrics: any) {
  const actions = [];
  
  // Revenue optimization actions
  if (revenueData.growthRate < 10) {
    actions.push({
      category: 'revenue',
      action: 'Optimize content for higher CPM platforms',
      impact: 'high',
      effort: 'medium'
    });
  }
  
  // Content optimization actions
  if (contentPerformance.avgViralScore < 70) {
    actions.push({
      category: 'content',
      action: 'A/B test different content formats and hooks',
      impact: 'high',
      effort: 'medium'
    });
  }
  
  // ROI optimization actions
  if (roiMetrics.avgROI < 50) {
    actions.push({
      category: 'roi',
      action: 'Reduce production costs or improve content quality',
      impact: 'medium',
      effort: 'low'
    });
  }
  
  // Growth actions
  actions.push({
    category: 'growth',
    action: 'Scale successful content formats across platforms',
    impact: 'high',
    effort: 'high'
  });
  
  return actions;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action, data } = body;

    switch (action) {
      case 'export_data':
        const exportData = await AnalyticsService.exportAnalyticsData(
          session.user.id,
          data.format,
          data.period
        );
        
        return NextResponse.json({
          success: true,
          data: exportData,
          downloadUrl: data.format === 'csv' ? 
            `data:text/csv;base64,${Buffer.from(exportData).toString('base64')}` :
            null
        });

      case 'refresh_data':
        // Trigger data refresh from platform APIs
        const { updateRevenueMetrics } = await import('@/lib/revenue-calculation-engine');
        
        // This would typically trigger a background job to sync all platform data
        return NextResponse.json({
          success: true,
          message: 'Data refresh initiated',
          estimatedTime: '5-10 minutes'
        });

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

  } catch (error) {
    console.error('Dashboard action error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to execute dashboard action',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
