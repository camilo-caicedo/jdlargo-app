import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { createServerClient } from '@supabase/ssr';

// --- Rate Limiter for /portal/* (HU-010) ---
const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

let ratelimit: Ratelimit | null = null;

if (redisUrl && redisToken) {
  try {
    const redis = new Redis({
      url: redisUrl,
      token: redisToken,
    });

    ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(20, '60 s'), // 20 requests per 60s window
      analytics: true,
      prefix: 'ratelimit:portal',
    });
  } catch (err) {
    console.warn('[middleware] Upstash Ratelimit initialization failed:', err);
  }
}

export async function middleware(request: NextRequest) {
  // Block 1: Rate Limiting for /portal/* (HU-010), /registro (HU-060) and /recuperar-contrasena (HU-057)
  if (
    request.nextUrl.pathname.startsWith('/portal') ||
    request.nextUrl.pathname === '/registro' ||
    request.nextUrl.pathname === '/recuperar-contrasena'
  ) {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      '127.0.0.1';

    if (ratelimit) {
      try {
        const { success, limit, reset, remaining } = await ratelimit.limit(ip);

        if (!success) {
          console.warn(
            `[RateLimit Exceeded] IP: ${ip}, Path: ${request.nextUrl.pathname}, Time: ${new Date().toISOString()}`,
          );

          return new NextResponse(
            JSON.stringify({
              error: 'Demasiadas solicitudes. Por favor intente más tarde.',
              limit,
              remaining,
              reset,
            }),
            {
              status: 429,
              headers: {
                'Content-Type': 'application/json',
                'Retry-After': Math.ceil((reset - Date.now()) / 1000).toString(),
              },
            },
          );
        }
      } catch (err) {
        console.warn('[middleware] Ratelimit check error:', err);
      }
    }

    return NextResponse.next();
  }

  // Block 2: Supabase Session Refresh (HU-055)
  // Refreshes the auth token via cookies on non-portal app & auth routes
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (supabaseUrl && supabaseKey) {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });

    // Refresh auth token by reading user session
    await supabase.auth.getUser();
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - Images, svgs, etc.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
