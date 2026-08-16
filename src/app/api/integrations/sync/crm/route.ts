import { ApiError, created, parseJson, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, requireApiKey, requirePermission } from '@/lib/api-auth';
import { createManualEntries, getCampaign, getClient } from '@/lib/firestore';
import { dispatchWebhook } from '@/lib/webhooks';
import { syncCrmSchema, validate } from '@/lib/validation';
import { randomUUID } from 'node:crypto';
import type { ManualEntry } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/integrations/sync/crm
 * Auth: API key with `write`.
 *
 * Generic CRM ingestion — Pipedrive, HubSpot, Salesforce and friends all push
 * the same shape: per-campaign, per-day closed leads and/or sales value.
 * Unknown campaign ids are skipped and reported rather than failing the batch,
 * so one stale record in a CRM export doesn't reject the whole sync.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const caller = await requireApiKey(request);
  requirePermission(caller, 'write');
  enforceRateLimit(request, caller);

  const { client_id, source, records } = validate(syncCrmSchema, await parseJson(request));

  const client = await getClient(client_id);
  if (!client) throw new ApiError('INVALID_CLIENT_ID', `No client with id "${client_id}".`);

  const now = new Date().toISOString();
  const entries: ManualEntry[] = [];
  const skipped: { campaign_id: string; reason: string }[] = [];
  const campaignCache = new Map<string, boolean>();

  for (const record of records) {
    if (!campaignCache.has(record.campaign_id)) {
      const campaign = await getCampaign(client_id, record.campaign_id);
      campaignCache.set(record.campaign_id, Boolean(campaign));
    }
    if (!campaignCache.get(record.campaign_id)) {
      skipped.push({ campaign_id: record.campaign_id, reason: 'unknown campaign for this client' });
      continue;
    }

    const notes = record.notes ?? `Synced from ${source}`;

    if (record.leads_closed !== undefined) {
      entries.push({
        id: `man-${randomUUID().slice(0, 8)}`,
        client_id,
        campaign_id: record.campaign_id,
        metric_type: 'leads_closed',
        value: record.leads_closed,
        notes,
        entered_by: 'fadhil',
        created_at: now,
        date: record.date,
      });
    }
    if (record.sales_value !== undefined) {
      entries.push({
        id: `man-${randomUUID().slice(0, 8)}`,
        client_id,
        campaign_id: record.campaign_id,
        metric_type: 'sales_value',
        value: record.sales_value,
        notes,
        entered_by: 'fadhil',
        created_at: now,
        date: record.date,
      });
    }
  }

  if (entries.length > 0) {
    await createManualEntries(entries);
    for (const entry of entries) void dispatchWebhook('manual_entry.created', entry);
  }

  return created({
    source,
    synced_count: entries.length,
    skipped_count: skipped.length,
    skipped,
  });
});
