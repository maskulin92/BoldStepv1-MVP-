import { ApiError, created, withErrorHandling } from '@/lib/api-response';
import { assertClientAccess, enforceRateLimit, requireCaller, requirePermission } from '@/lib/api-auth';
import { createManualEntries, getCampaign, getClient } from '@/lib/firestore';
import { dispatchWebhook } from '@/lib/webhooks';
import { manualEntrySchema, validate } from '@/lib/validation';
import { parseJson } from '@/lib/api-response';
import { randomUUID } from 'node:crypto';
import type { ManualEntry } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/manual-entry
 * Offline data the ad platform can't see: closed leads, sales value, custom
 * conversions. The owner enters these; a client session cannot.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const caller = await requireCaller(request);
  enforceRateLimit(request, caller);

  const input = validate(manualEntrySchema, await parseJson(request));
  assertClientAccess(caller, input.client_id);
  if (caller.role !== 'owner') {
    requirePermission(caller, 'write');
  }

  const client = await getClient(input.client_id);
  if (!client) throw new ApiError('INVALID_CLIENT_ID', `No client with id "${input.client_id}".`);

  const campaign = await getCampaign(input.client_id, input.campaign_id);
  if (!campaign) {
    throw new ApiError('INVALID_CAMPAIGN_ID', `No campaign "${input.campaign_id}" for this client.`);
  }

  const entry: ManualEntry = {
    id: `man-${randomUUID().slice(0, 8)}`,
    client_id: input.client_id,
    campaign_id: input.campaign_id,
    adset_id: input.adset_id,
    metric_type: input.metric_type,
    value: input.value,
    notes: input.notes ?? '',
    entered_by: caller.role === 'owner' ? 'fadhil' : 'client',
    created_at: new Date().toISOString(),
    date: input.date,
  };

  await createManualEntries([entry]);
  void dispatchWebhook('manual_entry.created', entry);

  return created({ entry_id: entry.id, entry });
});
