import { ok, withErrorHandling } from '@/lib/api-response';
import { requireCaller } from '@/lib/api-auth';
import { getClient } from '@/lib/firestore';

export const dynamic = 'force-dynamic';

/** GET /api/auth/me — resolves the current token into an identity. */
export const GET = withErrorHandling(async (request: Request) => {
  const caller = await requireCaller(request);

  const client = caller.client_id ? await getClient(caller.client_id) : null;

  return ok({
    id: caller.id,
    role: caller.role,
    kind: caller.kind,
    permissions: caller.permissions,
    client: client ? { id: client.id, name: client.name, link_id: client.link_id } : null,
  });
});
