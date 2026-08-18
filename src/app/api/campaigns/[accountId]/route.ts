import { ApiError, created, ok, parseJson, withErrorHandling } from '@/lib/api-response';
import { assertClientAccess, enforceRateLimit, requireCaller, requireOwner, requirePermission } from '@/lib/api-auth';
import { createCampaign, getCreative, getClient, listCampaigns, listInsights } from '@/lib/firestore';
import { defaultDateRange, isValidDateKey, sumInsights } from '@/lib/utils';
import { launchCampaign, resolveMetaContext } from '@/lib/meta-api';
import { createCampaignSchema, validate } from '@/lib/validation';
import { randomUUID } from 'node:crypto';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ accountId: string }> };

/**
 * GET /api/campaigns/[accountId]?startDate=&endDate=
 * Campaigns with per-campaign totals for the window, plus a client summary.
 */
export const GET = withErrorHandling(async (request: Request, context: Context) => {
  const { accountId } = await context.params;
  const caller = await requireCaller(request);
  enforceRateLimit(request, caller);
  assertClientAccess(caller, accountId);

  const client = await getClient(accountId);
  if (!client) throw new ApiError('INVALID_CLIENT_ID', `No client with id "${accountId}".`);

  const url = new URL(request.url);
  const fallback = defaultDateRange(Number(url.searchParams.get('days') ?? 7));
  const startDate = isValidDateKey(url.searchParams.get('startDate'))
    ? url.searchParams.get('startDate')!
    : fallback.start;
  const endDate = isValidDateKey(url.searchParams.get('endDate'))
    ? url.searchParams.get('endDate')!
    : fallback.end;

  const [campaigns, insights] = await Promise.all([
    listCampaigns(accountId),
    listInsights(accountId, startDate, endDate),
  ]);

  const withStats = campaigns.map((campaign) => ({
    ...campaign,
    stats: sumInsights(insights.filter((i) => i.campaign_id === campaign.id)),
  }));

  return ok({
    campaigns: withStats,
    range: { start: startDate, end: endDate },
    summary: sumInsights(insights),
  });
});

/**
 * POST /api/campaigns/[accountId]  { name, objective, budget_daily, creative_id? }
 * Owner only. Creates the campaign and launches it on Meta (mock-mode when
 * credentials are absent). A selected creative must exist, belong to this
 * client and be APPROVED — anything else is a validation error, so the
 * dropdown can never smuggle a pending or rejected asset into production.
 */
export const POST = withErrorHandling(async (request: Request, context: Context) => {
  const caller = await requireOwner(request);
  requirePermission(caller, 'write');
  enforceRateLimit(request, caller, 30, 'campaign-create');

  const { accountId } = await context.params;
  assertClientAccess(caller, accountId);

  const input = validate(createCampaignSchema, await parseJson(request));

  const client = await getClient(accountId);
  if (!client) throw new ApiError('INVALID_CLIENT_ID', `No client with id "${accountId}".`);

  let creative: Awaited<ReturnType<typeof getCreative>> = null;
  if (input.creative_id) {
    creative = await getCreative(input.creative_id);
    if (!creative) {
      throw new ApiError('CREATIVE_NOT_FOUND', 'The selected creative no longer exists.');
    }
    if (creative.client_id !== accountId) {
      throw new ApiError('FORBIDDEN', 'The selected creative belongs to another client.');
    }
    if (creative.status !== 'approved') {
      throw new ApiError('VALIDATION_ERROR', `The selected creative is ${creative.status}, not approved.`, {
        creative_id: `Creative must be approved before launch (current: ${creative.status}).`,
      });
    }
  }

  const launch = await launchCampaign(resolveMetaContext(client), {
    name: input.name,
    objective: input.objective,
    dailyBudget: input.budget_daily,
    creative: creative
      ? { id: creative.id, file_name: creative.file_name, storage_path: creative.storage_path }
      : undefined,
  });

  const now = new Date().toISOString();
  const campaign = await createCampaign({
    id: `cmp-${randomUUID().slice(0, 8)}`,
    client_id: accountId,
    name: input.name,
    objective: input.objective,
    status: 'PAUSED',
    budget_daily: input.budget_daily,
    created_at: now,
    last_synced: now,
    meta_campaign_id: launch.meta_campaign_id ?? '',
    ...(creative ? { creative_id: creative.id, creative_name: creative.file_name } : {}),
  });

  return created({
    campaign,
    launch: {
      ok: launch.ok,
      mode: launch.mode,
      message: launch.message,
      creative_attached: launch.creative_attached,
    },
    ...(creative ? { success_note: `Campaign created with creative "${creative.file_name}".` } : {}),
  });
});
