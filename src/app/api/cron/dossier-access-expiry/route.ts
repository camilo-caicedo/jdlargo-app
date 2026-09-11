import { NextRequest, NextResponse } from 'next/server';
import { detectAndProcessExpiredDossiers } from '@/server/dossiers/expiration';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await detectAndProcessExpiredDossiers();
    return NextResponse.json(summary);
  } catch (error) {
    console.error('Error processing expired dossiers cron:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}
