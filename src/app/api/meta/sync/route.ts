import { ApiError, ok, parseJson, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, requireOwner, requirePermission } from '@/lib/api-auth';
import {
  getClient,
  listCampaigns,
  recordAuditLog,
  upsertAdSets,
  upsertCampaigns,
  upsertInsights,
} from '@/lib/firestore';
import { fetchAdSets, fetchCampaigns, fetchInsights, isMetaLive, resolveMetaContext } from '@/lib/meta-api';
import { defaultDateRange, isValidDateKey } from '@/lib/utils';
import { dispatchWebhook } from '@/lib/webhooks';
import { metaSyncSchema, validate } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/meta/sync?client_id=&start_date=&end_date=
 *
 * Same operation as POST — the GET form exists for the dashboard's "Sync Meta"
 * button (spec 1.5c) and for quick browser/CLI triggers. Owner only.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const caller = await requireOwner(request);
  requirePermission(caller, 'write');
  enforceRateLimit(request, caller, 30, 'meta-sync');

  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id') ?? '';
  if (!clientId) {
    throw new ApiError('VALIDATION_ERROR', 'client_id is required.');
  }

  return runSync(caller.id, {
    client_id: clientId,
    start_date: isValidDateKey(url.searchParams.get('start_date'))
      ? url.searchParams.get('start_date')!
      : undefined,
    end_date: isValidDateKey(url.searchParams.get('end_date'))
      ? url.searchParams.get('end_date')!
      : undefined,
  });
});

/**
 * POST /api/meta/sync  { client_id, start_date?, end_date? }
 *
 * Pulls campaigns / ad sets / insights and stores them. Callable by the owner
 * from the dashboard, or by Hermes with its API key on a cron — same endpoint,
 * same result. Without a Meta token on the account (set in the dashboard) it
 * writes generated rows so the sync path itself is still testable.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const caller = await requireOwner(request);
  requirePermission(caller, 'write');
  enforceRateLimit(request, caller, 30, 'meta-sync');

  const input = validate(metaSyncSchema, await parseJson(request));
  return runSync(caller.id, input);
});

async function runSync(
  actorId: string,
  input: { client_id: string; start_date?: string; end_date?: string },
) {
  const startedAt = Date.now();
  const client = await getClient(input.client_id);
  if (!client) throw new ApiError('INVALID_CLIENT_ID', `No client with id "${input.client_id}".`);

  const fallback = defaultDateRange(7);
  const startDate = input.start_date ?? fallback.start;
  const endDate = input.end_date ?? fallback.end;
  if (startDate > endDate) {
    throw new ApiError('VALIDATION_ERROR', 'start_date must be on or before end_date.');
  }

  const context = resolveMetaContext(client);
  const live = isMetaLive(context);

  let campaignsWritten = 0;
  let adSetsWritten = 0;
  let syncStatus: 'success' | 'partial' | 'failed' = 'success';
  let failureDetail: string | undefined;

  if (live) {
    // Campaigns and ad sets sync independently: one failing must not sink the
    // other, so partial failures are recorded rather than thrown.
    const [campaignResult, adSetResult] = await Promise.allSettled([
      fetchCampaigns(context, input.client_id),
      fetchAdSets(context, input.client_id),
    ]);

    const campaigns = campaignResult.status === 'fulfilled' ? campaignResult.value : [];
    const adSets = adSetResult.status === 'fulfilled' ? adSetResult.value : [];

    const failures = [campaignResult, adSetResult].filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      syncStatus = failures.length === 2 ? 'failed' : 'partial';
      failureDetail = failures
        .map((f) => (f as PromiseRejectedResult).reason?.message ?? 'unknown error')
        .join('; ');
    }

    if (campaigns.length > 0) campaignsWritten = await upsertCampaigns(input.client_id, campaigns);
    if (adSets.length > 0) adSetsWritten = await upsertAdSets(input.client_id, adSets);
  }

  // Insights are generated against whatever campaigns are now stored, so the
  // mock branch stays consistent with the campaign list the dashboard shows.
  const campaigns = await listCampaigns(input.client_id);
  const insights = await fetchInsights({ context, accountId: input.client_id, startDate, endDate, campaigns });
  const recordsUpdated = insights.length > 0 ? await upsertInsights(input.client_id, insights) : 0;

  const syncedAt = new Date().toISOString();
  const responseTimeMs = Date.now() - startedAt;

  // Audit trail — best-effort, never fails the sync itself.
  await recordAuditLog({
    action: 'meta_sync',
    actor: actorId === 'owner_fadhil' || actorId === 'hermes-agent' ? actorId : 'owner',
    client_id: input.client_id,
    mode: live ? 'live' : 'mock',
    sync_status: live ? syncStatus : 'success',
    campaign_count: campaignsWritten,
    meta_response_time_ms: responseTimeMs,
    ...(failureDetail ? { detail: failureDetail } : {}),
    timestamp: syncedAt,
  });

  void dispatchWebhook('insight.synced', {
    client_id: input.client_id,
    range: { start: startDate, end: endDate },
    records: recordsUpdated,
  });

  return ok({
    success: true,
    synced_at: syncedAt,
    sync_timestamp: syncedAt,
    mode: live ? 'live' : 'mock',
    synced_count: campaigns.length,
    campaign_count: campaignsWritten,
    campaigns_updated: campaignsWritten,
    ad_sets_updated: adSetsWritten,
    records_updated: recordsUpdated,
    campaigns: campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      budget_daily: c.budget_daily,
      last_synced: c.last_synced,
    })),
    meta_response_time_ms: responseTimeMs,
    ...(syncStatus !== 'success' ? { sync_status: syncStatus } : {}),
    range: { start: startDate, end: endDate },
    note: live
      ? failureDetail
      : 'No Meta token on this account — add it in the dashboard (Edit account) to pull live data.',
  });
}
