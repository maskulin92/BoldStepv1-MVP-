import { ok, withErrorHandling } from '@/lib/api-response';
import { configReport } from '@/lib/env';
import { listClients } from '@/lib/firestore';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 * Unauthenticated. Reports which integrations are live vs mocked — the first
 * thing to check after filling in .env.local.
 *
 * Note: `meta_ads` in the env-based configReport only checks whether
 * META_AD_ACCOUNT_ID is set in .env.local — but Meta tokens live per-account
 * in Firestore (set via the dashboard), not in .env. So the health check also
 * scans Firestore for at least one client with an encrypted token, which is
 * the true indicator that Meta integration is live.
 */
export const GET = withErrorHandling(async () => {
  const base = configReport();

  // Check Firestore for at least one client with a Meta token configured.
  let metaAdsLive = base.services.meta_ads;
  try {
    const clients = await listClients();
    const hasToken = clients.some(
      (c) => Boolean(c.access_token_encrypted) && Boolean(c.ad_account_id),
    );
    if (hasToken) metaAdsLive = true;
  } catch {
    // If Firestore is unreachable, the env-based value stays as-is.
  }

  return ok({
    status: 'ok',
    ...base,
    services: { ...base.services, meta_ads: metaAdsLive },
  });
});
