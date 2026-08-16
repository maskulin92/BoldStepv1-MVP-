import { ApiError, created, withErrorHandling } from '@/lib/api-response';
import { parseJson } from '@/lib/api-response';
import { assertClientAccess, enforceRateLimit, requireCaller, requirePermission } from '@/lib/api-auth';
import { createManualEntries, getCampaign, getClient } from '@/lib/firestore';
import { dispatchWebhook } from '@/lib/webhooks';
import { manualEntrySchema, validate } from '@/lib/validation';
import { randomUUID } from 'node:crypto';
import type { ManualEntry } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/manual-entry
 * Offline data the ad platform can't see: closed leads, sales value, custom
 * conversions.
 *
 * Owner entries count immediately (status: approved). Client submissions land
 * in the review queue instead (status: pending_approval) and only affect
 * metrics once the owner approves them at POST /api/manual-entry/review/[id].
 */
export const POST = withErrorHandling(async (request: Request) => {
  const caller = await requireCaller(request);
  enforceRateLimit(request, caller, 30, 'manual-entry');
  requirePermission(caller, 'write');
  const input = validate(manualEntrySchema, await parseJson(request));
  assertClientAccess(caller, input.client_id);

  const client = await getClient(input.client_id);
  if (!client) throw new ApiError('INVALID_CLIENT_ID', `No client with id "${input.client_id}".`);

  const campaign = await getCampaign(input.client_id, input.campaign_id);
  if (!campaign) {
    throw new ApiError('INVALID_CAMPAIGN_ID', `No campaign "${input.campaign_id}" for this client.`);
  }

  const isOwner = caller.role === 'owner';
  const entry: ManualEntry = {
    id: `man-${randomUUID().slice(0, 8)}`,
    client_id: input.client_id,
    campaign_id: input.campaign_id,
    adset_id: input.adset_id,
    metric_type: input.metric_type,
    value: input.value,
    notes: input.notes ?? '',
    entered_by: isOwner ? 'fadhil' : 'client',
    created_at: new Date().toISOString(),
    date: input.date,
    // The quality gate: only owner-entered data is trusted on arrival.
    status: isOwner ? 'approved' : 'pending_approval',
  };

  await createManualEntries([entry]);
  void dispatchWebhook('manual_entry.created', entry);

  return created({
    entry_id: entry.id,
    entry,
    ...(isOwner ? {} : { note: 'Submitted for approval — it counts toward metrics once approved.' }),
  });
});
