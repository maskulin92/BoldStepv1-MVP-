import { ApiError, created, parseJson, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, requireApiKey, requirePermission } from '@/lib/api-auth';
import { createManualEntries, getCampaign, getClient } from '@/lib/firestore';
import { dispatchWebhook } from '@/lib/webhooks';
import { syncConversionsSchema, validate } from '@/lib/validation';
import { randomUUID } from 'node:crypto';
import type { ManualEntry } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/integrations/sync/conversions
 * Auth: API key with `write`.
 *
 * Ingestion point for offline conversions from an external system. They land
 * in the same `manual_entries` collection the dashboard form writes to, so
 * reports treat both sources identically.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const caller = await requireApiKey(request);
  requirePermission(caller, 'write');
  enforceRateLimit(request, caller);

  const { client_id, campaign_id, conversions } = validate(
    syncConversionsSchema,
    await parseJson(request),
  );

  const client = await getClient(client_id);
  if (!client) throw new ApiError('INVALID_CLIENT_ID', `No client with id "${client_id}".`);

  const campaign = await getCampaign(client_id, campaign_id);
  if (!campaign) {
    throw new ApiError('INVALID_CAMPAIGN_ID', `No campaign "${campaign_id}" for this client.`);
  }

  const now = new Date().toISOString();
  const entries: ManualEntry[] = conversions.map((conversion) => ({
    id: `man-${randomUUID().slice(0, 8)}`,
    client_id,
    campaign_id,
    adset_id: conversion.adset_id,
    metric_type: conversion.metric_type,
    value: conversion.value,
    notes: conversion.notes ?? `Ingested via API key "${caller.key_name ?? caller.id}"`,
    entered_by: 'fadhil',
    created_at: now,
    date: conversion.date,
  }));

  await createManualEntries(entries);
  for (const entry of entries) void dispatchWebhook('manual_entry.created', entry);

  return created({
    entries_created: entries.length,
    entry_ids: entries.map((entry) => entry.id),
  });
});
