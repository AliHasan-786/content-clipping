import { NextRequest, NextResponse } from 'next/server';
import { oauthService } from '@/lib/social/oauth-service';
import { redirect } from 'next/navigation';

// GET /api/oauth/[platform]/callback - Handle OAuth callback
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  try {
    const { platform } = await params;
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    // Handle OAuth error
    if (error) {
      const errorDescription = searchParams.get('error_description') || 'OAuth authorization failed';
      redirect(`/dashboard/accounts?error=${encodeURIComponent(errorDescription)}`);
      return;
    }

    if (!code || !state) {
      redirect('/dashboard/accounts?error=Missing authorization code or state');
      return;
    }

    // Validate platform
    const validPlatforms = ['youtube', 'tiktok', 'instagram', 'twitter'];
    if (!validPlatforms.includes(platform)) {
      redirect('/dashboard/accounts?error=Invalid platform');
      return;
    }

    // Handle the OAuth callback
    const result = await oauthService.handleCallback(
      platform as any,
      code,
      state
    );

    if (!result.success) {
      redirect(`/dashboard/accounts?error=${encodeURIComponent(result.error || 'Authentication failed')}`);
      return;
    }

    // Successful authentication
    const redirectUrl = result.redirectUrl || '/dashboard/accounts';
    const successUrl = `${redirectUrl}${redirectUrl.includes('?') ? '&' : '?'}success=${encodeURIComponent(`${platform} account connected successfully`)}&accountId=${result.accountId}`;
    
    redirect(successUrl);

  } catch (error) {
    console.error('OAuth callback error:', error);
    redirect('/dashboard/accounts?error=Authentication failed');
  }
}
