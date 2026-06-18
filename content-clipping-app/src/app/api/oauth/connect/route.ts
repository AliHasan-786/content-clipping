import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { oauthService } from '@/lib/social/oauth-service';
import { z } from 'zod';

// POST /api/oauth/connect - Generate OAuth URL for platform connection
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
    
    const ConnectSchema = z.object({
      platform: z.enum(['youtube', 'tiktok', 'instagram', 'twitter']),
      redirectUrl: z.string().url().optional(),
    });

    const validation = ConnectSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { 
          error: 'Invalid request data',
          details: validation.error.errors 
        },
        { status: 400 }
      );
    }

    const { platform, redirectUrl } = validation.data;

    const { authUrl, state } = await oauthService.generateAuthUrl(
      platform,
      session.user.id,
      redirectUrl
    );

    return NextResponse.json({
      authUrl,
      state,
      platform,
    });

  } catch (error) {
    console.error('OAuth connect API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
