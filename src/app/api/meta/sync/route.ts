import { ApiError, ok, parseJson, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, requireOwner, requirePermission } from '@/lib/api-auth';
import {
  getClient,
  listCampaigns,
  upsertAdSets,
  upsertCampaigns,
  upsertInsights,
} from '@/lib/firestore';
import { fetchAdSets, fetchCampaigns, fetchInsights, isMetaLive, resolveMetaContext } from '@/lib/meta-api';
import { defaultDateRange } from '@/lib/utils';
import { dispatchWebhook } from '@/lib/webhooks';
import { metaSyncSchema, validate } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/meta/sync  { client_id, start_date?, end_date? }
 *
 * Pulls campaigns / ad sets / insights and stores them. Callable by the owner
 * from the dashboard, or by Hermes with its API key on a cron — same endpoint,
 * same result. Without META_ACCESS_TOKEN it writes generated rows so the sync
 * path itself is still testable.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const caller = await requireOwner(request);
  requirePermission(caller, 'write');
  enforceRateLimit(request, caller, 30, 'meta-sync');

  const { client_id, start_date, end_date } = validate(metaSyncSchema, await parseJson(request));

  const client = await getClient(client_id);
  if (!client) throw new ApiError('INVALID_CLIENT_ID', `No client with id "${client_id}".`);

  const fallback = defaultDateRange(7);
  const startDate = start_date ?? fallback.start;
  const endDate = end_date ?? fallback.end;
  if (startDate > endDate) {
    throw new ApiError('VALIDATION_ERROR', 'start_date must be on or before end_date.');
  }

  const context = resolveMetaContext(client);
  const live = isMetaLive(context);

  let campaignsWritten = 0;
  let adSetsWritten = 0;

  if (live) {
    const [campaigns, adSets] = await Promise.all([
      fetchCampaigns(context, client_id),
      fetchAdSets(context, client_id),
    ]);
    if (campaigns.length > 0) campaignsWritten = await upsertCampaigns(client_id, campaigns);
    if (adSets.length > 0) adSetsWritten = await upsertAdSets(client_id, adSets);
  }

  // Insights are generated against whatever campaigns are now stored, so the
  // mock branch stays consistent with the campaign list the dashboard shows.
  const campaigns = await listCampaigns(client_id);
  const insights = await fetchInsights({ context, clientId: client_id, startDate, endDate, campaigns });
  const recordsUpdated = insights.length > 0 ? await upsertInsights(client_id, insights) : 0;

  const syncedAt = new Date().toISOString();
  void dispatchWebhook('insight.synced', {
    client_id,
    range: { start: startDate, end: endDate },
    records: recordsUpdated,
  });

  return ok({
    synced_at: syncedAt,
    mode: live ? 'live' : 'mock',
    range: { start: startDate, end: endDate },
    records_updated: recordsUpdated,
    campaigns_updated: campaignsWritten,
    ad_sets_updated: adSetsWritten,
    note: live
      ? undefined
      : 'META_ACCESS_TOKEN is not set — generated rows were written instead of live Meta data.',
  });
});
