import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import * as expirationModule from '@/server/dossiers/expiration';

vi.mock('@/server/dossiers/expiration', () => ({
  detectAndProcessExpiredDossiers: vi.fn(),
}));

describe('Cron Route: /api/cron/dossier-access-expiry', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, CRON_SECRET: 'test-cron-secret-123' };
  });

  it('rejects with 401 when Authorization header is missing', async () => {
    const req = new NextRequest('http://localhost:3000/api/cron/dossier-access-expiry');
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(expirationModule.detectAndProcessExpiredDossiers).not.toHaveBeenCalled();
  });

  it('rejects with 401 when Authorization header does not match CRON_SECRET', async () => {
    const req = new NextRequest('http://localhost:3000/api/cron/dossier-access-expiry', {
      headers: { authorization: 'Bearer wrong-secret' },
    });
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(expirationModule.detectAndProcessExpiredDossiers).not.toHaveBeenCalled();
  });

  it('executes detectAndProcessExpiredDossiers and returns summary when Authorization is valid', async () => {
    const mockSummary = {
      transitionedToExpired: 2,
      remindersSent: 1,
      escalationsSent: 0,
      totalExpiredPending: 3,
    };
    vi.mocked(expirationModule.detectAndProcessExpiredDossiers).mockResolvedValueOnce(mockSummary);

    const req = new NextRequest('http://localhost:3000/api/cron/dossier-access-expiry', {
      headers: { authorization: 'Bearer test-cron-secret-123' },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockSummary);
    expect(expirationModule.detectAndProcessExpiredDossiers).toHaveBeenCalledTimes(1);
  });
});
