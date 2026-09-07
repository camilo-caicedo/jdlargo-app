import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

// Initialize Ratelimit only if Upstash credentials exist
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
  // Only apply to portal routes
  if (!request.nextUrl.pathname.startsWith('/portal')) {
    return NextResponse.next();
  }

  // Determine client IP
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1';

  if (ratelimit) {
    try {
      const { success, limit, reset, remaining } = await ratelimit.limit(ip);

      if (!success) {
        console.warn(
          `[Portal RateLimit Exceeded] IP: ${ip}, Path: ${request.nextUrl.pathname}, Time: ${new Date().toISOString()}`,
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
      // Fail-open for application access if rate limiter errors
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/portal/:path*'],
};
