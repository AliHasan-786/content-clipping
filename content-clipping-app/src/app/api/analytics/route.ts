import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { RevenueAnalyticsService } from '@/lib/analytics/revenue-analytics-service';

// GET /api/analytics - Get comprehensive revenue analytics
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
    const timeframe = searchParams.get('timeframe') || 'month'; // day, week, month, quarter, year
    const platforms = searchParams.get('platforms')?.split(',') || [];
    const accountIds = searchParams.get('accountIds')?.split(',') || [];
    const startDate = searchParams.get('startDate') ? new Date(searchParams.get('startDate')!) : undefined;
    const endDate = searchParams.get('endDate') ? new Date(searchParams.get('endDate')!) : undefined;
    const type = searchParams.get('type') || 'revenue'; // revenue, engagement, content, export

    // Handle different analytics types
    if (type === 'revenue') {
      const revenueAnalytics = await RevenueAnalyticsService.getRevenueAnalytics(
        session.user.id,
        {
          timeframe: timeframe as any,
          startDate,
          endDate,
          platforms: platforms.length > 0 ? platforms : undefined,
          accountIds: accountIds.length > 0 ? accountIds : undefined
        }
      );

      return NextResponse.json(revenueAnalytics);
    }

    // Fallback to legacy analytics for other types
    // Calculate date range based on timeframe
    let calculatedStartDate: Date;
    const calculatedEndDate = endDate || new Date();

    switch (timeframe) {
      case 'day':
        calculatedStartDate = startDate || new Date(Date.now() - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        calculatedStartDate = startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        calculatedStartDate = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'quarter':
        calculatedStartDate = startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        calculatedStartDate = startDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        calculatedStartDate = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }

    // Build filters for legacy analytics
    const campaignWhere: any = {
      userId: session.user.id,
      createdAt: {
        gte: calculatedStartDate,
        lte: calculatedEndDate
      }
    };

    if (platforms.length > 0) {
      campaignWhere.platform = { name: { in: platforms } };
    }

    if (accountIds.length > 0) {
      campaignWhere.accountId = { in: accountIds };
    }

    // Get campaign analytics
    const [
      campaigns,
      publishedContent,
      totalAnalytics,
      platformBreakdown
    ] = await Promise.all([
      // Campaign overview
      prisma.publishingCampaign.findMany({
        where: campaignWhere,
        include: {
          platform: true,
          account: true,
          publishedContent: {
            include: {
              analytics: {
                orderBy: { recordedAt: 'desc' },
                take: 1
              }
            }
          }
        }
      }),

      // Published content with analytics
      prisma.publishedContent.findMany({
        where: {
          campaign: campaignWhere,
          publishedAt: {
            gte: calculatedStartDate,
            lte: calculatedEndDate
          }
        },
        include: {
          analytics: {
            orderBy: { recordedAt: 'desc' },
            take: 1
          },
          campaign: {
            include: {
              platform: true
            }
          }
        }
      }),

      // Aggregate analytics
      prisma.contentAnalytics.aggregate({
        where: {
          content: {
            campaign: campaignWhere,
            publishedAt: {
              gte: calculatedStartDate,
              lte: calculatedEndDate
            }
          }
        },
        _sum: {
          views: true,
          likes: true,
          comments: true,
          shares: true,
          saves: true,
          impressions: true,
          reach: true,
          watchTime: true
        },
        _avg: {
          engagementRate: true,
          ctr: true,
          completionRate: true
        }
      }),

      // Platform breakdown
      prisma.publishingCampaign.groupBy({
        by: ['platformId'],
        where: campaignWhere,
        _count: {
          id: true
        }
      })
    ]);

    // Calculate metrics
    const totalCampaigns = campaigns.length;
    const successfulCampaigns = campaigns.filter(c => c.status === 'PUBLISHED').length;
    const failedCampaigns = campaigns.filter(c => c.status === 'FAILED').length;
    const pendingCampaigns = campaigns.filter(c => 
      ['DRAFT', 'SCHEDULED', 'PROCESSING'].includes(c.status)
    ).length;

    const successRate = totalCampaigns > 0 ? (successfulCampaigns / totalCampaigns) * 100 : 0;

    // Calculate content performance
    const contentPerformance = publishedContent.map(content => {
      const latestAnalytics = content.analytics[0];
      return {
        id: content.id,
        title: content.title,
        platform: content.campaign.platform.name,
        publishedAt: content.publishedAt,
        url: content.url,
        analytics: latestAnalytics ? {
          views: Number(latestAnalytics.views),
          likes: Number(latestAnalytics.likes),
          comments: Number(latestAnalytics.comments),
          shares: Number(latestAnalytics.shares),
          saves: Number(latestAnalytics.saves),
          engagementRate: latestAnalytics.engagementRate,
          ctr: latestAnalytics.ctr,
          completionRate: latestAnalytics.completionRate,
        } : null
      };
    });

    // Top performing content
    const topContent = contentPerformance
      .filter(c => c.analytics)
      .sort((a, b) => (b.analytics?.views || 0) - (a.analytics?.views || 0))
      .slice(0, 10);

    // Platform performance
    const platformPerformance = await Promise.all(
      platformBreakdown.map(async (platform) => {
        const platformCampaigns = campaigns.filter(c => c.platformId === platform.platformId);
        const platformData = platformCampaigns[0]?.platform;

        const platformAnalytics = await prisma.contentAnalytics.aggregate({
          where: {
            content: {
              campaign: {
                platformId: platform.platformId,
                userId: session.user.id,
              },
              publishedAt: {
                gte: calculatedStartDate,
                lte: calculatedEndDate
              }
            }
          },
          _sum: {
            views: true,
            likes: true,
            comments: true,
            engagementRate: true
          },
          _count: {
            id: true
          }
        });

        return {
          platform: {
            id: platform.platformId,
            name: platformData?.name || 'Unknown',
            displayName: platformData?.displayName || 'Unknown'
          },
          totalCampaigns: platform._count.id,
          totalViews: Number(platformAnalytics._sum.views || 0),
          totalLikes: Number(platformAnalytics._sum.likes || 0),
          totalComments: Number(platformAnalytics._sum.comments || 0),
          avgEngagementRate: platformAnalytics._sum.engagementRate || 0,
          contentCount: platformAnalytics._count.id
        };
      })
    );

    // Time series data for charts
    const timeSeriesData = await prisma.publishedContent.findMany({
      where: {
        campaign: campaignWhere,
        publishedAt: {
          gte: calculatedStartDate,
          lte: calculatedEndDate
        }
      },
      select: {
        publishedAt: true,
        analytics: {
          select: {
            views: true,
            likes: true,
            comments: true,
            shares: true,
            engagementRate: true
          },
          orderBy: { recordedAt: 'desc' },
          take: 1
        }
      },
      orderBy: { publishedAt: 'asc' }
    });

    const analytics = {
      overview: {
        timeframe,
        startDate: calculatedStartDate,
        endDate: calculatedEndDate,
        totalCampaigns,
        successfulCampaigns,
        failedCampaigns,
        pendingCampaigns,
        successRate,
        totalViews: Number(totalAnalytics._sum.views || 0),
        totalLikes: Number(totalAnalytics._sum.likes || 0),
        totalComments: Number(totalAnalytics._sum.comments || 0),
        totalShares: Number(totalAnalytics._sum.shares || 0),
        totalSaves: Number(totalAnalytics._sum.saves || 0),
        totalImpressions: Number(totalAnalytics._sum.impressions || 0),
        totalReach: Number(totalAnalytics._sum.reach || 0),
        totalWatchTime: Number(totalAnalytics._sum.watchTime || 0),
        avgEngagementRate: totalAnalytics._avg.engagementRate || 0,
        avgCTR: totalAnalytics._avg.ctr || 0,
        avgCompletionRate: totalAnalytics._avg.completionRate || 0,
      },
      topContent,
      platformPerformance,
      timeSeriesData: timeSeriesData.map(item => ({
        date: item.publishedAt,
        views: item.analytics[0] ? Number(item.analytics[0].views) : 0,
        likes: item.analytics[0] ? Number(item.analytics[0].likes) : 0,
        comments: item.analytics[0] ? Number(item.analytics[0].comments) : 0,
        shares: item.analytics[0] ? Number(item.analytics[0].shares) : 0,
        engagementRate: item.analytics[0]?.engagementRate || 0,
      }))
    };

    return NextResponse.json(analytics);

  } catch (error) {
    console.error('Analytics API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
