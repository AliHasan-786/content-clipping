import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

interface ForecastData {
  timeframe: string;
  projectedMetrics: {
    revenue: number;
    views: number;
    engagement: number;
    contentCount: number;
  };
  confidence: number;
  factors: string[];
  recommendations: string[];
}

// GET /api/analytics/forecasting - Get revenue and performance forecasting
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const period = searchParams.get('period') || 'month'; // week, month, quarter, year
    const platforms = searchParams.get('platforms')?.split(',') || [];

    // Get historical data for forecasting
    const historicalData = await getHistoricalData(session.user.id, platforms);
    
    // Calculate forecasts for different periods
    const forecasts = {
      nextWeek: await calculateForecast(historicalData, 'week'),
      nextMonth: await calculateForecast(historicalData, 'month'),
      nextQuarter: await calculateForecast(historicalData, 'quarter'),
      nextYear: await calculateForecast(historicalData, 'year')
    };

    // Growth trajectory analysis
    const growthTrajectory = await analyzeGrowthTrajectory(historicalData);
    
    // Seasonal patterns
    const seasonalPatterns = await analyzeSeasonalPatterns(historicalData);
    
    // Platform-specific forecasts
    const platformForecasts = await calculatePlatformForecasts(session.user.id, platforms);

    return NextResponse.json({
      forecasts,
      growthTrajectory,
      seasonalPatterns,
      platformForecasts,
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('Forecasting API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function getHistoricalData(userId: string, platforms: string[]) {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000); // 90 days

  const whereClause: any = {
    campaign: {
      userId,
      publishedAt: {
        gte: startDate,
        lte: endDate
      }
    }
  };

  if (platforms.length > 0) {
    whereClause.campaign.platform = { name: { in: platforms } };
  }

  const contentAnalytics = await prisma.contentAnalytics.findMany({
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
    orderBy: { recordedAt: 'asc' }
  });

  // Group by day
  const dailyData = new Map();
  
  contentAnalytics.forEach(analytics => {
    const date = analytics.recordedAt.toISOString().split('T')[0];
    
    if (!dailyData.has(date)) {
      dailyData.set(date, {
        date,
        revenue: 0,
        views: 0,
        engagement: 0,
        contentCount: 0,
        platforms: new Set()
      });
    }
    
    const dayData = dailyData.get(date);
    dayData.revenue += analytics.estimatedRevenue;
    dayData.views += Number(analytics.views);
    dayData.engagement += Number(analytics.likes) + Number(analytics.comments) + Number(analytics.shares);
    dayData.contentCount += 1;
    dayData.platforms.add(analytics.content.campaign.platform.name);
  });

  return Array.from(dailyData.values()).map(data => ({
    ...data,
    platforms: Array.from(data.platforms)
  }));
}

async function calculateForecast(historicalData: any[], period: string): Promise<ForecastData> {
  if (historicalData.length < 7) {
    return {
      timeframe: period,
      projectedMetrics: { revenue: 0, views: 0, engagement: 0, contentCount: 0 },
      confidence: 0.3,
      factors: ['Insufficient historical data'],
      recommendations: ['Collect more data for accurate forecasting']
    };
  }

  // Calculate trends
  const recentData = historicalData.slice(-14); // Last 2 weeks
  const olderData = historicalData.slice(-28, -14); // Previous 2 weeks

  const recentAvg = calculateAverages(recentData);
  const olderAvg = calculateAverages(olderData);

  // Calculate growth rates
  const revenueGrowth = olderAvg.revenue > 0 ? (recentAvg.revenue - olderAvg.revenue) / olderAvg.revenue : 0;
  const viewsGrowth = olderAvg.views > 0 ? (recentAvg.views - olderAvg.views) / olderAvg.views : 0;
  const engagementGrowth = olderAvg.engagement > 0 ? (recentAvg.engagement - olderAvg.engagement) / olderAvg.engagement : 0;

  // Calculate forecast multipliers based on period
  const multipliers = {
    week: 1,
    month: 4.3,
    quarter: 13,
    year: 52
  };

  const multiplier = multipliers[period as keyof typeof multipliers] || 4.3;

  // Apply growth trends with dampening for longer periods
  const dampening = period === 'year' ? 0.5 : period === 'quarter' ? 0.7 : 0.9;
  const adjustedRevenueGrowth = revenueGrowth * dampening;
  const adjustedViewsGrowth = viewsGrowth * dampening;
  const adjustedEngagementGrowth = engagementGrowth * dampening;

  const projectedMetrics = {
    revenue: recentAvg.revenue * multiplier * (1 + adjustedRevenueGrowth),
    views: recentAvg.views * multiplier * (1 + adjustedViewsGrowth),
    engagement: recentAvg.engagement * multiplier * (1 + adjustedEngagementGrowth),
    contentCount: recentAvg.contentCount * multiplier
  };

  // Calculate confidence based on data consistency
  const confidence = calculateConfidence(historicalData, recentData);

  // Generate factors and recommendations
  const factors = generateForecastFactors(revenueGrowth, viewsGrowth, engagementGrowth, historicalData);
  const recommendations = generateRecommendations(projectedMetrics, recentAvg, period);

  return {
    timeframe: period,
    projectedMetrics,
    confidence,
    factors,
    recommendations
  };
}

function calculateAverages(data: any[]) {
  if (data.length === 0) return { revenue: 0, views: 0, engagement: 0, contentCount: 0 };

  return {
    revenue: data.reduce((sum, d) => sum + d.revenue, 0) / data.length,
    views: data.reduce((sum, d) => sum + d.views, 0) / data.length,
    engagement: data.reduce((sum, d) => sum + d.engagement, 0) / data.length,
    contentCount: data.reduce((sum, d) => sum + d.contentCount, 0) / data.length
  };
}

function calculateConfidence(historicalData: any[], recentData: any[]): number {
  // Base confidence on data consistency and volume
  const dataPoints = historicalData.length;
  const consistency = calculateConsistency(recentData);
  
  let confidence = 0.4; // Base confidence
  
  // Add confidence based on data volume
  confidence += Math.min(0.3, dataPoints * 0.01);
  
  // Add confidence based on consistency
  confidence += consistency * 0.3;
  
  return Math.min(0.95, Math.max(0.2, confidence));
}

function calculateConsistency(data: any[]): number {
  if (data.length < 3) return 0.3;
  
  const revenues = data.map(d => d.revenue);
  const mean = revenues.reduce((sum, r) => sum + r, 0) / revenues.length;
  const variance = revenues.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / revenues.length;
  const standardDeviation = Math.sqrt(variance);
  
  // Lower coefficient of variation = higher consistency
  const coefficientOfVariation = mean > 0 ? standardDeviation / mean : 1;
  return Math.max(0, 1 - coefficientOfVariation);
}

function generateForecastFactors(revenueGrowth: number, viewsGrowth: number, engagementGrowth: number, data: any[]): string[] {
  const factors = [];
  
  if (revenueGrowth > 0.1) factors.push('Strong revenue growth trend');
  if (revenueGrowth < -0.1) factors.push('Declining revenue trend');
  if (viewsGrowth > 0.1) factors.push('Increasing viewership');
  if (viewsGrowth < -0.1) factors.push('Declining viewership');
  if (engagementGrowth > 0.1) factors.push('Improving engagement');
  if (engagementGrowth < -0.1) factors.push('Declining engagement');
  
  const avgContentCount = data.reduce((sum, d) => sum + d.contentCount, 0) / data.length;
  if (avgContentCount > 2) factors.push('High content production rate');
  if (avgContentCount < 1) factors.push('Low content production rate');
  
  const platformDiversity = new Set(data.flatMap(d => d.platforms)).size;
  if (platformDiversity > 3) factors.push('Multi-platform presence');
  if (platformDiversity === 1) factors.push('Single platform dependency');
  
  return factors;
}

function generateRecommendations(projected: any, current: any, period: string): string[] {
  const recommendations = [];
  
  if (projected.revenue < current.revenue * 2) {
    recommendations.push('Consider increasing content production for higher revenue');
  }
  
  if (projected.views < current.views * 3) {
    recommendations.push('Focus on SEO and hashtag optimization for better reach');
  }
  
  if (period === 'year' && projected.revenue < current.revenue * 10) {
    recommendations.push('Explore monetization opportunities and platform diversification');
  }
  
  recommendations.push('Monitor performance weekly to adjust strategy');
  
  return recommendations;
}

async function analyzeGrowthTrajectory(historicalData: any[]) {
  // Analyze growth patterns over time
  const weeklyGrowth = calculateWeeklyGrowth(historicalData);
  const monthlyGrowth = calculateMonthlyGrowth(historicalData);
  
  return {
    weekly: weeklyGrowth,
    monthly: monthlyGrowth,
    trajectory: determineTrajectory(weeklyGrowth, monthlyGrowth),
    inflectionPoints: findInflectionPoints(historicalData)
  };
}

async function analyzeSeasonalPatterns(historicalData: any[]) {
  // Group by day of week and time of day
  const dayOfWeekPatterns = new Map();
  const hourlyPatterns = new Map();
  
  historicalData.forEach(data => {
    const date = new Date(data.date);
    const dayOfWeek = date.getDay();
    const hour = date.getHours();
    
    // Day of week patterns
    if (!dayOfWeekPatterns.has(dayOfWeek)) {
      dayOfWeekPatterns.set(dayOfWeek, { revenue: 0, views: 0, count: 0 });
    }
    const dayData = dayOfWeekPatterns.get(dayOfWeek);
    dayData.revenue += data.revenue;
    dayData.views += data.views;
    dayData.count += 1;
  });

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const seasonalData = {
    dayOfWeek: Array.from(dayOfWeekPatterns.entries()).map(([day, data]) => ({
      day: dayNames[day],
      avgRevenue: data.count > 0 ? data.revenue / data.count : 0,
      avgViews: data.count > 0 ? data.views / data.count : 0
    })),
    bestDay: findBestPerformingDay(dayOfWeekPatterns, dayNames),
    patterns: identifySeasonalPatterns(historicalData)
  };

  return seasonalData;
}

async function calculatePlatformForecasts(userId: string, platforms: string[]) {
  const forecasts = new Map();
  
  for (const platform of platforms) {
    const platformData = await getHistoricalData(userId, [platform]);
    const forecast = await calculateForecast(platformData, 'month');
    forecasts.set(platform, forecast);
  }
  
  return Object.fromEntries(forecasts);
}

// Helper functions
function calculateWeeklyGrowth(data: any[]) {
  const weeks = chunkByWeek(data);
  const growthRates = [];
  
  for (let i = 1; i < weeks.length; i++) {
    const currentWeek = calculateAverages(weeks[i]);
    const previousWeek = calculateAverages(weeks[i - 1]);
    
    const revenueGrowth = previousWeek.revenue > 0 
      ? (currentWeek.revenue - previousWeek.revenue) / previousWeek.revenue 
      : 0;
      
    growthRates.push(revenueGrowth);
  }
  
  return growthRates.reduce((sum, rate) => sum + rate, 0) / growthRates.length;
}

function calculateMonthlyGrowth(data: any[]) {
  const months = chunkByMonth(data);
  const growthRates = [];
  
  for (let i = 1; i < months.length; i++) {
    const currentMonth = calculateAverages(months[i]);
    const previousMonth = calculateAverages(months[i - 1]);
    
    const revenueGrowth = previousMonth.revenue > 0 
      ? (currentMonth.revenue - previousMonth.revenue) / previousMonth.revenue 
      : 0;
      
    growthRates.push(revenueGrowth);
  }
  
  return growthRates.reduce((sum, rate) => sum + rate, 0) / growthRates.length;
}

function chunkByWeek(data: any[]) {
  // Group data by week
  const weeks = new Map();
  
  data.forEach(item => {
    const date = new Date(item.date);
    const weekStart = new Date(date.setDate(date.getDate() - date.getDay()));
    const weekKey = weekStart.toISOString().split('T')[0];
    
    if (!weeks.has(weekKey)) {
      weeks.set(weekKey, []);
    }
    weeks.get(weekKey).push(item);
  });
  
  return Array.from(weeks.values());
}

function chunkByMonth(data: any[]) {
  // Group data by month
  const months = new Map();
  
  data.forEach(item => {
    const date = new Date(item.date);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    
    if (!months.has(monthKey)) {
      months.set(monthKey, []);
    }
    months.get(monthKey).push(item);
  });
  
  return Array.from(months.values());
}

function determineTrajectory(weeklyGrowth: number, monthlyGrowth: number) {
  if (weeklyGrowth > 0.05 && monthlyGrowth > 0.1) return 'accelerating';
  if (weeklyGrowth > 0 && monthlyGrowth > 0) return 'growing';
  if (weeklyGrowth < -0.05 && monthlyGrowth < -0.1) return 'declining';
  if (Math.abs(weeklyGrowth) < 0.02 && Math.abs(monthlyGrowth) < 0.05) return 'stable';
  return 'volatile';
}

function findInflectionPoints(data: any[]) {
  // Simplified inflection point detection
  const inflectionPoints = [];
  
  for (let i = 2; i < data.length - 2; i++) {
    const prev2 = data[i - 2].revenue;
    const prev1 = data[i - 1].revenue;
    const current = data[i].revenue;
    const next1 = data[i + 1].revenue;
    const next2 = data[i + 2].revenue;
    
    // Check for trend reversal
    if ((prev2 < prev1 && prev1 < current && current > next1 && next1 > next2) ||
        (prev2 > prev1 && prev1 > current && current < next1 && next1 < next2)) {
      inflectionPoints.push({
        date: data[i].date,
        type: current > prev1 ? 'peak' : 'valley',
        revenue: current
      });
    }
  }
  
  return inflectionPoints;
}

function findBestPerformingDay(dayOfWeekPatterns: Map<number, any>, dayNames: string[]) {
  let bestDay = 0;
  let bestRevenue = 0;
  
  dayOfWeekPatterns.forEach((data, day) => {
    const avgRevenue = data.count > 0 ? data.revenue / data.count : 0;
    if (avgRevenue > bestRevenue) {
      bestRevenue = avgRevenue;
      bestDay = day;
    }
  });
  
  return {
    day: dayNames[bestDay],
    avgRevenue: bestRevenue
  };
}

function identifySeasonalPatterns(data: any[]) {
  // Simplified pattern identification
  const patterns = [];
  
  // Check for weekend vs weekday patterns
  const weekdayData = data.filter(d => {
    const day = new Date(d.date).getDay();
    return day >= 1 && day <= 5;
  });
  
  const weekendData = data.filter(d => {
    const day = new Date(d.date).getDay();
    return day === 0 || day === 6;
  });
  
  if (weekdayData.length > 0 && weekendData.length > 0) {
    const weekdayAvg = calculateAverages(weekdayData);
    const weekendAvg = calculateAverages(weekendData);
    
    if (weekendAvg.revenue > weekdayAvg.revenue * 1.2) {
      patterns.push('Higher weekend performance');
    } else if (weekdayAvg.revenue > weekendAvg.revenue * 1.2) {
      patterns.push('Higher weekday performance');
    }
  }
  
  return patterns;
}
