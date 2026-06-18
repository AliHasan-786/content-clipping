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

    const revenueData = await AnalyticsService.getRevenueData(
      session.user.id,
      period,
      platform
    );

    return NextResponse.json({
      success: true,
      data: revenueData
    });

  } catch (error) {
    console.error('Revenue analytics error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch revenue data',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
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
      case 'update_rates':
        // Update platform revenue rates based on actual performance
        const { updatePlatformRates } = await import('@/lib/revenue-calculation-engine');
        await updatePlatformRates(session.user.id);
        return NextResponse.json({ success: true, message: 'Platform rates updated' });

      case 'calculate_roi':
        const { calculateROI } = await import('@/lib/revenue-calculation-engine');
        const roi = await calculateROI(data.campaignId, data.costs);
        return NextResponse.json({ success: true, data: roi });

      case 'generate_forecast':
        const { generateRevenueForecast } = await import('@/lib/revenue-calculation-engine');
        const forecast = await generateRevenueForecast(data.accountId, data.days);
        return NextResponse.json({ success: true, data: forecast });

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

  } catch (error) {
    console.error('Revenue action error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to execute revenue action',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
