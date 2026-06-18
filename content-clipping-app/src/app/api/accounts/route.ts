import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { oauthService } from '@/lib/social/oauth-service';

// GET /api/accounts - Get user's connected platform accounts
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const accounts = await oauthService.getUserAccounts(session.user.id);

    const transformedAccounts = accounts.map(account => ({
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
      connectedAt: account.createdAt,
    }));

    return NextResponse.json({
      accounts: transformedAccounts
    });

  } catch (error) {
    console.error('Get accounts API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
