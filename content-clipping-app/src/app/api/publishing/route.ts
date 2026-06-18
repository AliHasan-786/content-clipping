import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PublishingOrchestrator } from '@/lib/social/publishing-orchestrator';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const publishingOrchestrator = new PublishingOrchestrator();

// Validation schema for publishing request
const PublishingRequestSchema = z.object({
  clipId: z.string().optional(),
  videoId: z.string().optional(),
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  platforms: z.array(z.object({
    platform: z.string(),
    accountId: z.string(),
    contentType: z.enum(['shorts', 'reels', 'story', 'post', 'tweet']).optional(),
    scheduledAt: z.string().datetime().optional(),
    customization: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
      thumbnail: z.string().optional(),
    }).optional(),
  })).min(1, 'At least one platform must be specified'),
  videoPath: z.string().min(1, 'Video path is required'),
  autoOptimize: z.boolean().optional(),
  approvalRequired: z.boolean().optional(),
  globalScheduledAt: z.string().datetime().optional(),
});

// POST /api/publishing - Create new publishing campaign
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
    
    // Validate request data
    const validation = PublishingRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { 
          error: 'Invalid request data',
          details: validation.error.errors 
        },
        { status: 400 }
      );
    }

    const data = validation.data;

    // Verify user owns the specified accounts
    const accountIds = data.platforms.map(p => p.accountId);
    const userAccounts = await prisma.platformAccount.findMany({
      where: {
        id: { in: accountIds },
        userId: session.user.id,
        isActive: true
      }
    });

    if (userAccounts.length !== accountIds.length) {
      return NextResponse.json(
        { error: 'One or more platform accounts are invalid or not owned by user' },
        { status: 403 }
      );
    }

    // Create publishing request
    const publishingRequest = {
      userId: session.user.id,
      ...data,
      platforms: data.platforms.map(p => ({
        ...p,
        scheduledAt: p.scheduledAt ? new Date(p.scheduledAt) : undefined
      })),
      globalScheduledAt: data.globalScheduledAt ? new Date(data.globalScheduledAt) : undefined,
    };

    // Start publishing process
    const result = await publishingOrchestrator.publishToMultiplePlatforms(publishingRequest);

    return NextResponse.json(result, { 
      status: result.success ? 201 : 400 
    });

  } catch (error) {
    console.error('Publishing API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/publishing - List user's publishing campaigns
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
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const status = searchParams.get('status');
    const platform = searchParams.get('platform');
    const offset = (page - 1) * limit;

    // Build where clause
    const where: any = {
      userId: session.user.id
    };

    if (status) {
      where.status = status;
    }

    if (platform) {
      where.platform = { name: platform };
    }

    // Get campaigns with related data
    const [campaigns, total] = await Promise.all([
      prisma.publishingCampaign.findMany({
        where,
        include: {
          platform: true,
          account: true,
          clip: true,
          video: true,
          publishedContent: true,
          contentVariations: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.publishingCampaign.count({ where })
    ]);

    // Transform campaigns for response
    const transformedCampaigns = campaigns.map(campaign => ({
      id: campaign.id,
      title: campaign.title,
      description: campaign.description,
      status: campaign.status,
      platform: {
        id: campaign.platform.id,
        name: campaign.platform.name,
        displayName: campaign.platform.displayName,
      },
      account: {
        id: campaign.account.id,
        username: campaign.account.username,
        displayName: campaign.account.displayName,
      },
      scheduledAt: campaign.scheduledAt,
      publishedAt: campaign.publishedAt,
      createdAt: campaign.createdAt,
      retryCount: campaign.retryCount,
      errorMessage: campaign.errorMessage,
      publishedContent: campaign.publishedContent.map(content => ({
        id: content.id,
        platformPostId: content.platformPostId,
        url: content.url,
        status: content.status,
      })),
      contentVariations: campaign.contentVariations.length,
      source: campaign.clipId ? 'clip' : 'video',
    }));

    return NextResponse.json({
      campaigns: transformedCampaigns,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: offset + limit < total,
        hasPrev: page > 1,
      }
    });

  } catch (error) {
    console.error('Get campaigns API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
