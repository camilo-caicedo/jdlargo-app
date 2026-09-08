import { NextRequest, NextResponse } from 'next/server';
import { type EmailOtpType } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolvePostLoginDestination } from '@/server/auth/session';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;

  if (!token_hash || !type) {
    const errorUrl = new URL('/registro', request.url);
    errorUrl.searchParams.set('error', 'missing_token');
    return NextResponse.redirect(errorUrl);
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash,
  });

  if (error) {
    console.error('[auth/confirm] OTP verification error:', error);
    const errorUrl = new URL('/registro', request.url);
    errorUrl.searchParams.set('error', 'invalid_token');
    return NextResponse.redirect(errorUrl);
  }

  // Once OTP is verified, user has an active session in cookies
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const destination = await resolvePostLoginDestination(user.id);

  if (destination.kind === 'single_org') {
    return NextResponse.redirect(new URL(`/app/${destination.organizationId}`, request.url));
  }

  if (destination.kind === 'select_org') {
    return NextResponse.redirect(new URL('/login/organizacion', request.url));
  }

  // If no_access
  return NextResponse.redirect(new URL('/login?error=no_org', request.url));
}
