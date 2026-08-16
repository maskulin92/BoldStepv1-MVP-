import { list, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, requireApiKey } from '@/lib/api-auth';
import { listWebhooks } from '@/lib/firestore';
import { paginate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/** GET /api/integrations/webhooks/list — signing secrets are never returned. */
export const GET = withErrorHandling(async (request: Request) => {
  const caller = await requireApiKey(request);
  enforceRateLimit(request, caller);

  const url = new URL(request.url);
  const hooks = (await listWebhooks(caller.id)).map(({ secret: _secret, ...rest }) => rest);

  const { items, pagination } = paginate(
    hooks,
    Number(url.searchParams.get('page') ?? 1),
    Number(url.searchParams.get('per_page') ?? 50),
  );
  return list(items, pagination);
});
