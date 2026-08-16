import { list, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, requireCaller } from '@/lib/api-auth';
import { listClients, toPublicClient } from '@/lib/firestore';
import { paginate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * GET /api/clients
 * Owner sees every client; a client session sees only itself.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const caller = await requireCaller(request);
  enforceRateLimit(request, caller);

  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page') ?? 1);
  const perPage = Number(url.searchParams.get('per_page') ?? 50);

  const all = await listClients();
  const scoped =
    caller.role === 'owner' ? all : all.filter((client) => client.id === caller.client_id);

  const { items, pagination } = paginate(scoped.map(toPublicClient), page, perPage);
  return list(items, pagination);
});
