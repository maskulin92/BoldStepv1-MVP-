import { ok, withErrorHandling } from '@/lib/api-response';
import { configReport } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 * Unauthenticated. Reports which integrations are live vs mocked — the first
 * thing to check after filling in .env.local.
 */
export const GET = withErrorHandling(async () => {
  return ok({ status: 'ok', ...configReport() });
});
