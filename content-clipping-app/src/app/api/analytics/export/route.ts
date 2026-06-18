import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RevenueAnalyticsService } from '@/lib/analytics/revenue-analytics-service';

// GET /api/analytics/export - Export analytics data
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
    const format = searchParams.get('format') || 'csv'; // csv, json, xlsx
    const timeframe = searchParams.get('timeframe') || 'month';
    const platforms = searchParams.get('platforms')?.split(',') || [];
    const accountIds = searchParams.get('accountIds')?.split(',') || [];
    const startDate = searchParams.get('startDate') ? new Date(searchParams.get('startDate')!) : undefined;
    const endDate = searchParams.get('endDate') ? new Date(searchParams.get('endDate')!) : undefined;

    // Get comprehensive analytics data
    const analyticsData = await RevenueAnalyticsService.getRevenueAnalytics(
      session.user.id,
      {
        timeframe: timeframe as any,
        startDate,
        endDate,
        platforms: platforms.length > 0 ? platforms : undefined,
        accountIds: accountIds.length > 0 ? accountIds : undefined
      }
    );

    if (format === 'json') {
      const filename = `analytics-${timeframe}-${new Date().toISOString().split('T')[0]}.json`;
      
      return new NextResponse(JSON.stringify(analyticsData, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    if (format === 'csv') {
      const csvData = convertToCSV(analyticsData);
      const filename = `analytics-${timeframe}-${new Date().toISOString().split('T')[0]}.csv`;
      
      return new NextResponse(csvData, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    return NextResponse.json(
      { error: 'Unsupported export format' },
      { status: 400 }
    );

  } catch (error) {
    console.error('Analytics export error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function convertToCSV(data: any): string {
  const headers = [
    'Date',
    'Platform',
    'Content Title',
    'Views',
    'Revenue',
    'Engagement Rate',
    'CTR',
    'Completion Rate',
    'Likes',
    'Comments',
    'Shares',
    'Watch Time'
  ];

  let csvContent = headers.join(',') + '\n';

  // Add time series data
  data.timeSeriesData.forEach((item: any) => {
    const row = [
      item.date,
      'All Platforms',
      'Daily Summary',
      item.views,
      item.revenue,
      item.engagement,
      '', // CTR
      '', // Completion Rate
      '', // Likes
      '', // Comments
      '', // Shares
      '' // Watch Time
    ];
    csvContent += row.join(',') + '\n';
  });

  // Add top content data
  Object.entries(data.platformMetrics).forEach(([platform, metrics]: [string, any]) => {
    metrics.topContent.forEach((content: any) => {
      const row = [
        content.publishedAt || '',
        platform,
        content.title || 'Untitled',
        content.views || 0,
        content.revenue || 0,
        content.engagementRate || 0,
        '', // CTR
        '', // Completion Rate
        '', // Likes
        '', // Comments
        '', // Shares
        '' // Watch Time
      ];
      csvContent += row.map(field => `"${field}"`).join(',') + '\n';
    });
  });

  return csvContent;
}

// POST /api/analytics/export - Schedule analytics export
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { 
      format, 
      timeframe, 
      platforms, 
      accountIds, 
      email,
      includeForecasting,
      includeOptimizations 
    } = body;

    // For now, return immediate export URL
    // In production, this would schedule a background job
    const exportUrl = `/api/analytics/export?${new URLSearchParams({
      format: format || 'csv',
      timeframe: timeframe || 'month',
      ...(platforms && { platforms: platforms.join(',') }),
      ...(accountIds && { accountIds: accountIds.join(',') })
    }).toString()}`;

    return NextResponse.json({
      exportUrl,
      scheduled: false,
      message: 'Export ready for download'
    });

  } catch (error) {
    console.error('Analytics export scheduling error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
