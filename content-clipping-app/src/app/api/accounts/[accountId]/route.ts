import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { oauthService } from '@/lib/social/oauth-service';
import { prisma } from '@/lib/prisma';

// GET /api/accounts/[accountId] - Get account details
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await params;
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const account = await prisma.platformAccount.findFirst({
      where: {
        id: accountId,
        userId: session.user.id
      },
      include: {
        platform: true,
        publishingCampaigns: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            publishedContent: true
          }
        },
        analytics: {
          orderBy: { recordedAt: 'desc' },
          take: 7, // Last 7 days
        },
        optimalPostingTimes: {
          orderBy: [
            { engagementScore: 'desc' }
          ]
        }
      }
    });

    if (!account) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      );
    }

    const transformedAccount = {
      id: account.id,
      platform: {
        id: account.platform.id,
        name: account.platform.name,
        displayName: account.platform.displayName,
      },
      accountId: account.accountId,
      username: account.username,
      displayName: account.displayName,
      profilePicture: account.profilePicture,
      isActive: account.isActive,
      lastSyncAt: account.lastSyncAt,
      tokenExpiresAt: account.tokenExpiresAt,
      scopes: account.scopes,
      settings: account.settings,
      connectedAt: account.createdAt,
      recentCampaigns: account.publishingCampaigns.map(campaign => ({
        id: campaign.id,
        title: campaign.title,
        status: campaign.status,
        publishedAt: campaign.publishedAt,
        createdAt: campaign.createdAt,
        publishedContent: campaign.publishedContent.length,
      })),
      analytics: account.analytics.map(analytics => ({
        period: analytics.period,
        startDate: analytics.startDate,
        endDate: analytics.endDate,
        totalPosts: analytics.totalPosts,
        totalViews: Number(analytics.totalViews),
        totalLikes: Number(analytics.totalLikes),
        totalComments: Number(analytics.totalComments),
        avgEngagement: analytics.avgEngagement,
        followers: Number(analytics.followers),
        recordedAt: analytics.recordedAt,
      })),
      optimalPostingTimes: account.optimalPostingTimes.map(time => ({
        dayOfWeek: time.dayOfWeek,
        hour: time.hour,
        timezone: time.timezone,
        engagementScore: time.engagementScore,
        lastCalculated: time.lastCalculated,
      })),
    };

    return NextResponse.json(transformedAccount);

  } catch (error) {
    console.error('Get account details API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PATCH /api/accounts/[accountId] - Update account settings
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await params;
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { settings } = body;

    // Verify account ownership
    const account = await prisma.platformAccount.findFirst({
      where: {
        id: accountId,
        userId: session.user.id
      }
    });

    if (!account) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      );
    }

    // Update account settings
    const updatedAccount = await prisma.platformAccount.update({
      where: { id: accountId },
      data: {
        settings: settings || {},
        updatedAt: new Date(),
      }
    });

    return NextResponse.json({
      id: updatedAccount.id,
      settings: updatedAccount.settings,
      updatedAt: updatedAccount.updatedAt,
    });

  } catch (error) {
    console.error('Update account API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/accounts/[accountId] - Disconnect account
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await params;
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const result = await oauthService.disconnectAccount(
      accountId,
      session.user.id
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      message: 'Account disconnected successfully'
    });

  } catch (error) {
    console.error('Disconnect account API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
