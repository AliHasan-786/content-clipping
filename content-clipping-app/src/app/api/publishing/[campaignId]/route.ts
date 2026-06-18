import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PublishingOrchestrator } from '@/lib/social/publishing-orchestrator';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const publishingOrchestrator = new PublishingOrchestrator();

// GET /api/publishing/[campaignId] - Get campaign details
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { campaignId } = await params;
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const campaign = await prisma.publishingCampaign.findFirst({
      where: {
        id: campaignId,
        userId: session.user.id
      },
      include: {
        platform: true,
        account: true,
        clip: true,
        video: true,
        publishedContent: {
          include: {
            analytics: {
              orderBy: { recordedAt: 'desc' },
              take: 1
            }
          }
        },
        contentVariations: true,
        publishingHistory: {
          orderBy: { timestamp: 'desc' }
        }
      }
    });

    if (!campaign) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      );
    }

    // Get publishing progress
    const progress = await publishingOrchestrator.getPublishingProgress(campaignId);

    // Transform campaign data
    const transformedCampaign = {
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
        profilePicture: campaign.account.profilePicture,
      },
      source: campaign.clipId ? {
        type: 'clip',
        id: campaign.clipId,
        title: campaign.clip?.title,
        exportUrl: campaign.clip?.exportUrl,
      } : campaign.videoId ? {
        type: 'video',
        id: campaign.videoId,
        title: campaign.video?.title,
        url: campaign.video?.url,
      } : null,
      scheduledAt: campaign.scheduledAt,
      publishedAt: campaign.publishedAt,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
      retryCount: campaign.retryCount,
      maxRetries: campaign.maxRetries,
      errorMessage: campaign.errorMessage,
      autoOptimize: campaign.autoOptimize,
      approvalRequired: campaign.approvalRequired,
      isApproved: campaign.isApproved,
      approvedAt: campaign.approvedAt,
      metadata: campaign.metadata,
      publishedContent: campaign.publishedContent.map(content => ({
        id: content.id,
        platformPostId: content.platformPostId,
        url: content.url,
        status: content.status,
        publishedAt: content.publishedAt,
        analytics: content.analytics[0] ? {
          views: Number(content.analytics[0].views),
          likes: Number(content.analytics[0].likes),
          comments: Number(content.analytics[0].comments),
          shares: Number(content.analytics[0].shares),
          engagementRate: content.analytics[0].engagementRate,
          recordedAt: content.analytics[0].recordedAt,
        } : null,
      })),
      contentVariations: campaign.contentVariations.map(variation => ({
        id: variation.id,
        platformName: variation.platformName,
        title: variation.title,
        description: variation.description,
        hashtags: variation.hashtags,
        videoUrl: variation.videoUrl,
        thumbnailUrl: variation.thumbnailUrl,
        isOptimized: variation.isOptimized,
        optimizedAt: variation.optimizedAt,
      })),
      publishingHistory: campaign.publishingHistory.map(entry => ({
        id: entry.id,
        action: entry.action,
        status: entry.status,
        message: entry.message,
        timestamp: entry.timestamp,
        errorDetails: entry.errorDetails,
      })),
      progress,
    };

    return NextResponse.json(transformedCampaign);

  } catch (error) {
    console.error('Get campaign details API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PATCH /api/publishing/[campaignId] - Update campaign
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { campaignId } = await params;
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await req.json();
    
    // Validate update data
    const UpdateSchema = z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      scheduledAt: z.string().datetime().optional(),
    });

    const validation = UpdateSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { 
          error: 'Invalid update data',
          details: validation.error.errors 
        },
        { status: 400 }
      );
    }

    const data = validation.data;

    // Check if campaign exists and belongs to user
    const campaign = await prisma.publishingCampaign.findFirst({
      where: {
        id: campaignId,
        userId: session.user.id,
        status: { in: ['DRAFT', 'SCHEDULED'] } // Only allow updates for draft/scheduled campaigns
      }
    });

    if (!campaign) {
      return NextResponse.json(
        { error: 'Campaign not found or cannot be updated' },
        { status: 404 }
      );
    }

    // Update campaign
    const updatedCampaign = await prisma.publishingCampaign.update({
      where: { id: campaignId },
      data: {
        title: data.title,
        description: data.description,
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
        updatedAt: new Date(),
      },
      include: {
        platform: true,
        account: true,
      }
    });

    return NextResponse.json({
      id: updatedCampaign.id,
      title: updatedCampaign.title,
      description: updatedCampaign.description,
      status: updatedCampaign.status,
      scheduledAt: updatedCampaign.scheduledAt,
      updatedAt: updatedCampaign.updatedAt,
    });

  } catch (error) {
    console.error('Update campaign API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/publishing/[campaignId] - Cancel/Delete campaign
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { campaignId } = await params;
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Cancel campaign using orchestrator
    const result = await publishingOrchestrator.cancelCampaign(
      campaignId,
      session.user.id
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      message: result.message
    });

  } catch (error) {
    console.error('Cancel campaign API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
