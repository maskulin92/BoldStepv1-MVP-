import { ApiError, ok, parseJson, withErrorHandling } from '@/lib/api-response';
import { assertClientAccess, enforceRateLimit, requireCaller, requireOwner } from '@/lib/api-auth';
import {
  getClient,
  listCampaigns,
  listInsights,
  listPendingActions,
  toPublicClient,
  updateClient,
} from '@/lib/firestore';
import { defaultDateRange, sumInsights } from '@/lib/utils';
import { updateClientSchema, validate } from '@/lib/validation';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ clientId: string }> };

/** GET /api/clients/[clientId] — client record + recent campaigns + settings. */
export const GET = withErrorHandling(async (request: Request, context: Context) => {
  const { clientId } = await context.params;
  const caller = await requireCaller(request);
  enforceRateLimit(request, caller);
  assertClientAccess(caller, clientId);

  const client = await getClient(clientId);
  if (!client) throw new ApiError('INVALID_CLIENT_ID', `No client with id "${clientId}".`);

  const range = defaultDateRange(7);
  const [campaigns, insights, pendingActions] = await Promise.all([
    listCampaigns(clientId),
    listInsights(clientId, range.start, range.end),
    caller.role === 'owner'
      ? listPendingActions({ clientId, status: 'pending' })
      : Promise.resolve([]),
  ]);

  return ok({
    client: toPublicClient(client),
    recent_campaigns: campaigns,
    summary_7d: sumInsights(insights),
    pending_actions_count: pendingActions.length,
    settings: client.settings,
  });
});

/** PUT /api/clients/[clientId] — owner only. */
export const PUT = withErrorHandling(async (request: Request, context: Context) => {
  const { clientId } = await context.params;
  const caller = await requireOwner(request);
  enforceRateLimit(request, caller);

  const patch = validate(updateClientSchema, await parseJson(request));

  const existing = await getClient(clientId);
  if (!existing) throw new ApiError('INVALID_CLIENT_ID', `No client with id "${clientId}".`);

  const { settings, ...fields } = patch;
  const updated = await updateClient(clientId, {
    ...fields,
    // Merge settings rather than replacing the whole object, so a partial
    // update can't drop a flag the caller didn't mention.
    ...(settings ? { settings: { ...existing.settings, ...settings } } : {}),
  });

  if (!updated) throw new ApiError('INVALID_CLIENT_ID', `No client with id "${clientId}".`);
  return ok({ updatedClient: toPublicClient(updated) });
});
