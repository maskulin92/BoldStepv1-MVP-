import { ok, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, extractToken, requireApiKey } from '@/lib/api-auth';
import { findApiKeyByHash } from '@/lib/firestore';
import { hashApiKey } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/integrations/auth/verify
 * Auth: `Authorization: Bearer boldstep_sk_…`
 * The handshake an integration calls to confirm its key is live.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const caller = await requireApiKey(request);
  enforceRateLimit(request, caller);

  const token = extractToken(request);
  const record = token ? await findApiKeyByHash(hashApiKey(token)) : null;

  return ok({
    valid: true,
    key_name: caller.key_name ?? record?.name ?? 'unknown',
    owner_id: caller.id,
    permissions: caller.permissions,
    expires_at: record?.expires_at ?? null,
    rate_limit: { requests_per_minute: 100 },
  });
});
