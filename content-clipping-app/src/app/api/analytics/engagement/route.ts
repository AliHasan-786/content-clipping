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

    const engagementData = await AnalyticsService.getEngagementMetrics(
      session.user.id,
      period,
      platform
    );

    return NextResponse.json({
      success: true,
      data: engagementData
    });

  } catch (error) {
    console.error('Engagement analytics error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch engagement data',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
