import 'server-only';
import { env } from './env';
import { decryptToken } from './auth';
import { deriveRates, round, seededRandom, toDateKey, daysAgo, dateRangeKeys } from './utils';
import { insightId } from './collections';
import type {
  AdSet,
  Campaign,
  Client,
  DailyInsight,
  MetaExecutionResult,
  PendingAction,
} from '@/types';

/**
 * Meta Graph API wrapper.
 *
 * Phase 1 does not run the daily pull — Hermes does that on a cron and POSTs
 * results to /api/meta/sync. What lives here is the wrapper those calls share,
 * plus the mock branch that keeps every screen populated until a real token
 * exists (SECTION 10 of the brief).
 */

const GRAPH_BASE = 'https://graph.facebook.com';

export interface MetaCallContext {
  accessToken: string | null;
  adAccountId: string | null;
}

/** Placeholder values in .env files are treated as "not configured", never as real. */
const META_PLACEHOLDERS = new Set([
  'YOUR_ACCESS_TOKEN',
  'YOUR_AD_ACCOUNT_ID',
  'act_XXXXXXXXX',
]);

function isPlaceholder(value: string | null | undefined): boolean {
  if (!value) return true;
  return META_PLACEHOLDERS.has(value.trim());
}

/**
 * Meta accepts an ad account id both as `act_123456789` and as the bare
 * numeric `123456789`. Graph edges (`/campaigns`, `/adsets`, `/insights`)
 * only work against the `act_`-prefixed node — a bare id makes Meta parse it
 * as a generic node and report "Tried accessing nonexisting field (…)".
 * Normalise once here so every downstream caller is guaranteed a valid id.
 */
function normalizeAdAccountId(value: string): string {
  const trimmed = value.trim().replace(/^act_/i, '');
  return `act_${trimmed}`;
}

/**
 * The dashboard is the single source of truth for Meta tokens: the token is
 * read from the account's encrypted Firestore field, nothing else. There is
 * no .env.local token fallback — Fadhil sets it once in the dashboard.
 *
 * The ad account id is also per-account first, with .env.local as a shared
 * default (an id is not a secret), but placeholders are ignored and the
 * `act_` prefix is normalised on.
 */
export function resolveMetaContext(client?: Client | null): MetaCallContext {
  const clientToken = client?.access_token_encrypted
    ? decryptToken(client.access_token_encrypted)
    : null;
  const rawAdAccountId = client?.ad_account_id ?? env.meta.adAccountId ?? null;
  const adAccountId =
    rawAdAccountId && !isPlaceholder(rawAdAccountId)
      ? normalizeAdAccountId(rawAdAccountId)
      : null;
  return {
    accessToken: isPlaceholder(clientToken) ? null : clientToken,
    adAccountId,
  };
}

export function isMetaLive(context: MetaCallContext): boolean {
  return Boolean(context.accessToken && context.adAccountId);
}

async function graphRequest<T>(
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
): Promise<T> {
  const url = new URL(`${GRAPH_BASE}/${env.meta.apiVersion}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('access_token', accessToken);

  // Exponential backoff on rate-limit (HTTP 429 / code 4 / code 17) and
  // transient 5xx: 1s, 2s, 4s — then give up and surface the error.
  const MAX_ATTEMPTS = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { cache: 'no-store' });
    } catch (error) {
      // Network failure: transient by nature, retry.
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_ATTEMPTS) {
        await sleep(2 ** (attempt - 1) * 1000);
        continue;
      }
      throw lastError;
    }

    const body = (await response.json().catch(() => ({}))) as T & {
      error?: { message?: string; code?: number };
    };

    if (response.ok && !body?.error) return body;

    const code = body?.error?.code;
    const rateLimited = response.status === 429 || code === 4 || code === 17 || code === 32;
    const transient = response.status >= 500;
    lastError = new Error(
      `Meta Graph API error (${response.status}): ${body?.error?.message ?? 'unknown error'}`,
    );

    if ((rateLimited || transient) && attempt < MAX_ATTEMPTS) {
      await sleep(2 ** (attempt - 1) * 1000);
      continue;
    }
    throw lastError;
  }

  throw lastError ?? new Error('Meta Graph API request failed');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* --------------------------------------------------------- campaigns */

interface MetaCampaignRow {
  id: string;
  name: string;
  objective: string;
  status: string;
  daily_budget?: string;
  created_time?: string;
}

export async function fetchCampaigns(
  context: MetaCallContext,
  accountId: string,
): Promise<Campaign[]> {
  if (!isMetaLive(context)) return [];

  const body = await graphRequest<{ data: MetaCampaignRow[] }>(
    `${context.adAccountId}/campaigns`,
    context.accessToken!,
    { fields: 'id,name,objective,status,daily_budget,created_time', limit: '100' },
  );

  const now = new Date().toISOString();
  return body.data.map((row) => ({
    id: row.id,
    client_id: accountId,
    name: row.name,
    objective: mapObjective(row.objective),
    status: mapCampaignStatus(row.status),
    // Meta returns budgets in the account's minor currency unit (sen).
    budget_daily: row.daily_budget ? round(Number(row.daily_budget) / 100, 2) : 0,
    created_at: row.created_time ?? now,
    last_synced: now,
    meta_campaign_id: row.id,
  }));
}

interface MetaAdSetRow {
  id: string;
  name: string;
  campaign_id: string;
  daily_budget?: string;
  status: string;
  created_time?: string;
  targeting?: Record<string, unknown>;
}

export async function fetchAdSets(context: MetaCallContext, accountId: string): Promise<AdSet[]> {
  if (!isMetaLive(context)) return [];

  const body = await graphRequest<{ data: MetaAdSetRow[] }>(
    `${context.adAccountId}/adsets`,
    context.accessToken!,
    { fields: 'id,name,campaign_id,daily_budget,status,created_time,targeting', limit: '200' },
  );

  const now = new Date().toISOString();
  return body.data.map((row) => {
    const targeting = (row.targeting ?? {}) as {
      age_min?: number;
      age_max?: number;
      genders?: number[];
      geo_locations?: { cities?: { name: string }[]; countries?: string[] };
      flexible_spec?: { interests?: { name: string }[] }[];
    };
    return {
      id: row.id,
      client_id: accountId,
      campaign_id: row.campaign_id,
      name: row.name,
      daily_budget: row.daily_budget ? round(Number(row.daily_budget) / 100, 2) : 0,
      targeting: {
        age_min: targeting.age_min ?? 18,
        age_max: targeting.age_max ?? 65,
        genders: (targeting.genders ?? []).map((g) => (g === 1 ? 'male' : 'female')),
        locations: [
          ...(targeting.geo_locations?.cities?.map((c) => c.name) ?? []),
          ...(targeting.geo_locations?.countries ?? []),
        ],
        interests: targeting.flexible_spec?.[0]?.interests?.map((i) => i.name) ?? [],
      },
      status: row.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
      created_at: row.created_time ?? now,
      meta_adset_id: row.id,
    };
  });
}

/* ----------------------------------------------------------- insights */

interface MetaInsightRow {
  campaign_id: string;
  campaign_name: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  /**
   * Objective-optimised result count — the "Results" column in Ads Manager.
   * Two observed shapes:
   *   - plain string: "65" (older API)
   *   - indicator array (confirmed from live Graph v21 response):
   *     [{
   *       "indicator": "actions:onsite_conversion.messaging_conversation_started_7d",
   *       "values": [
   *         { "value": "10", "attribution_windows": ["7d_click"] },
   *         { "value": "10", "attribution_windows": ["default"] }
   *       ]
   *     }]
   *     Note: `values` (plural) carries the SAME count under multiple
   *     attribution windows — only one must be taken, or the total doubles.
   */
  results?: string | { indicator?: string; values?: { value?: string; attribution_windows?: string[] }[] }[];
  actions?: { action_type: string; value: string }[];
}

/**
 * Extracts the result count from either `results` shape.
 *
 * - Plain numeric string → direct conversion.
 * - Indicator array → per indicator, take ONE attribution value (prefer
 *   "default"; fall back to the first entry) — summing every window would
 *   double-count the same conversions.
 * Returns 0 when nothing parseable is found; the caller falls back to the
 * actions tally.
 */
function extractResultsCount(results: MetaInsightRow['results']): number {
  if (results == null) return 0;

  if (typeof results === 'string') {
    const n = Number(results);
    return Number.isFinite(n) ? n : 0;
  }

  if (!Array.isArray(results)) return 0;

  let total = 0;
  for (const entry of results) {
    if (!entry || !Array.isArray(entry.values) || entry.values.length === 0) continue;

    // Prefer the default-attribution value; otherwise the first window.
    const pick =
      entry.values.find((v) => v.attribution_windows?.includes('default')) ?? entry.values[0];
    const n = Number(pick?.value ?? NaN);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

/**
 * The one function the brief calls out by name. Returns mock rows whenever
 * credentials are missing, real Graph API rows otherwise — identical shape
 * either way, so nothing downstream branches on it.
 */
export async function fetchInsights(options: {
  context: MetaCallContext;
  accountId: string;
  startDate: string;
  endDate: string;
  campaigns: Campaign[];
}): Promise<DailyInsight[]> {
  const { context, accountId, startDate, endDate, campaigns } = options;

  if (!isMetaLive(context)) {
    return mockInsights({ accountId, startDate, endDate, campaigns });
  }

  const body = await graphRequest<{ data: MetaInsightRow[] }>(
    `${context.adAccountId}/insights`,
    context.accessToken!,
    {
      level: 'campaign',
      time_increment: '1',
      time_range: JSON.stringify({ since: startDate, until: endDate }),
      fields: 'campaign_id,campaign_name,spend,impressions,clicks,results,actions',
      // A generous attribution window mirrors Ads Manager's default view.
      action_attribution_windows: JSON.stringify(['7d_click', '1d_view']),
      limit: '500',
    },
  );

  const now = new Date().toISOString();
  return body.data.map((row) => {
    // "Results" is the objective-optimised count shown in Ads Manager — for a
    // Leads objective that is the lead count. It arrives in two shapes (plain
    // number or indicator array), both handled by extractResultsCount. Fall
    // back to the actions tally only when results yields nothing.
    const results = extractResultsCount(row.results);
    const totals = {
      spend: Number(row.spend ?? 0),
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      leads: results > 0 ? results : countAction(row.actions, ['lead', 'onsite_conversion.lead_grouped']),
      conversions: countAction(row.actions, ['purchase', 'offsite_conversion.fb_pixel_purchase']),
    };
    return {
      id: insightId(row.date_start, row.campaign_id),
      client_id: accountId,
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      date: row.date_start,
      synced_at: now,
      ...deriveRates(totals),
      by_adset: {},
    };
  });
}

function countAction(
  actions: { action_type: string; value: string }[] | undefined,
  types: string[],
): number {
  if (!actions) return 0;
  return actions
    .filter((a) => types.includes(a.action_type))
    .reduce((sum, a) => sum + Number(a.value || 0), 0);
}

/** Generates believable rows for a date range without touching the network. */
function mockInsights(options: {
  accountId: string;
  startDate: string;
  endDate: string;
  campaigns: Campaign[];
}): DailyInsight[] {
  const { accountId, startDate, endDate, campaigns } = options;
  const rows: DailyInsight[] = [];
  const now = new Date().toISOString();

  for (const campaign of campaigns) {
    if (campaign.status === 'ARCHIVED') continue;
    for (const date of dateRangeKeys(startDate, endDate)) {
      const rand = seededRandom(`${campaign.id}-${date}`);
      const spend = round(campaign.budget_daily * (0.82 + rand() * 0.28), 2);
      const cpl = round(18 + rand() * 40, 2);
      const leads = Math.max(0, Math.round(spend / Math.max(cpl, 1)));
      const clicks = Math.round(leads * (5 + rand() * 4) + rand() * 8);
      const impressions = Math.round(clicks * (45 + rand() * 30));
      const totals = {
        spend,
        impressions,
        clicks,
        leads,
        conversions: Math.round(leads * (0.2 + rand() * 0.25)),
      };
      rows.push({
        id: insightId(date, campaign.id),
        client_id: accountId,
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        date,
        synced_at: now,
        ...deriveRates(totals),
        by_adset: {},
      });
    }
  }
  return rows;
}

/* ---------------------------------------------------------- execution */

/**
 * Applies an approved action to Meta. In mock mode it reports exactly what it
 * *would* have sent, so the approval workflow is testable end-to-end.
 */
export async function executeAction(
  action: PendingAction,
  context: MetaCallContext,
  overrides: Record<string, number | string> = {},
): Promise<MetaExecutionResult> {
  const target = action.adset_id ?? action.campaign_id;
  const payload = buildExecutionPayload(action, overrides);
  const executedAt = new Date().toISOString();

  if (!isMetaLive(context)) {
    return {
      ok: true,
      mode: 'mock',
      message: `[MOCK] Would POST to Meta object ${target} with ${JSON.stringify(payload)}. Add the account's Meta token in the dashboard to execute for real.`,
      applied: payload,
      executed_at: executedAt,
    };
  }

  try {
    const url = new URL(`${GRAPH_BASE}/${env.meta.apiVersion}/${target}`);
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(payload)) form.set(key, String(value));
    form.set('access_token', context.accessToken!);

    const response = await fetch(url, { method: 'POST', body: form, cache: 'no-store' });
    const body = (await response.json()) as { error?: { message?: string } };

    if (!response.ok || body?.error) {
      return {
        ok: false,
        mode: 'live',
        message: body?.error?.message ?? `Meta returned HTTP ${response.status}`,
        applied: payload,
        executed_at: executedAt,
      };
    }

    return {
      ok: true,
      mode: 'live',
      message: `Applied ${action.action_type} to ${target}.`,
      applied: payload,
      executed_at: executedAt,
    };
  } catch (error) {
    return {
      ok: false,
      mode: 'live',
      message: error instanceof Error ? error.message : 'Unknown Meta API failure',
      applied: payload,
      executed_at: executedAt,
    };
  }
}

function buildExecutionPayload(
  action: PendingAction,
  overrides: Record<string, number | string>,
): Record<string, string | number> {
  switch (action.action_type) {
    case 'pause':
      return { status: 'PAUSED' };
    case 'resume':
      return { status: 'ACTIVE' };
    case 'budget_change': {
      const budget = Number(overrides.budget ?? action.metadata.proposed_budget ?? 0);
      // Meta expects the minor currency unit.
      return { daily_budget: Math.round(budget * 100) };
    }
    case 'analysis':
    default:
      return { note: 'analysis-only, nothing sent to Meta' };
    case 'rotate':
      // Rotating a creative is a manual review in Ads Manager for now — the
      // action records the intent, never auto-swaps creative refs.
      return { note: 'creative-rotation suggested — review in Ads Manager' };
    case 'optimize':
      return { note: 'audience/placement optimization suggested — review in Ads Manager' };
  }
}

/* ----------------------------------------------------------- launching */

export interface LaunchResult {
  ok: boolean;
  mode: 'live' | 'mock';
  message: string;
  meta_campaign_id?: string;
  meta_adset_id?: string;
  meta_ad_id?: string;
  creative_attached: boolean;
}

export interface LaunchInput {
  name: string;
  objective: Campaign['objective'];
  dailyBudget: number;
  /** Approved creative to run, when one was selected. */
  creative?: { id: string; file_name: string; storage_path: string };
}

/**
 * Creates a campaign on Meta (plus ad set and ad when a creative is given),
 * or reports exactly what it would have sent in mock mode — same contract as
 * executeAction, so launch is testable before credentials exist.
 */
export async function launchCampaign(
  context: MetaCallContext,
  input: LaunchInput,
): Promise<LaunchResult> {
  if (!isMetaLive(context)) {
    const parts = [
      `name=${input.name}`,
      `objective=${input.objective}`,
      `daily_budget=${Math.round(input.dailyBudget * 100)}`,
      ...(input.creative ? [`creative=${input.creative.file_name} (${input.creative.storage_path})`] : []),
    ];
    return {
      ok: true,
      mode: 'mock',
      message: `[MOCK] Would create campaign (${parts.join(', ')}) under ${context.adAccountId ?? 'the ad account'}. Add the account's Meta token in the dashboard to launch for real.`,
      creative_attached: Boolean(input.creative),
    };
  }

  try {
    // 1. Campaign
    const campaign = await graphPost(`${context.adAccountId}/campaigns`, context.accessToken!, {
      name: input.name,
      objective: input.objective,
      status: 'PAUSED',
      special_ad_categories: '[]',
    });
    const metaCampaignId = String(campaign.id ?? '');

    // 2. Ad set
    const adSet = await graphPost(`${metaCampaignId}/adsets`, context.accessToken!, {
      name: `${input.name} — Ad Set`,
      optimization_goal: input.objective === 'TRAFFIC' ? 'LINK_CLICKS' : 'LEAD_GENERATION',
      billing_event: 'IMPRESSIONS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      daily_budget: String(Math.round(input.dailyBudget * 100)),
      targeting: JSON.stringify({ geo_locations: { countries: ['MY'] } }),
      status: 'PAUSED',
    });
    const metaAdSetId = String(adSet.id ?? '');

    // 3. Ad with the selected creative (or no ad when none was picked —
    // the campaign still exists and can be finished in Ads Manager).
    if (!input.creative) {
      return {
        ok: true,
        mode: 'live',
        message: `Campaign ${metaCampaignId} created with ad set ${metaAdSetId}. No creative selected — add the ad in Ads Manager.`,
        meta_campaign_id: metaCampaignId,
        meta_adset_id: metaAdSetId,
        creative_attached: false,
      };
    }

    const creative = await graphPost(
      `act_${String(context.adAccountId ?? '').replace(/^act_/, '')}/adcreatives`,
      context.accessToken!,
      {
        name: input.creative.file_name,
        object_story_spec: JSON.stringify({
          page_id: env.meta.pageId ?? '',
          link_data: {
            message: input.name,
            link: env.meta.appUrl,
            picture: input.creative.storage_path,
          },
        }),
      },
    );

    const ad = await graphPost(`${metaAdSetId}/ads`, context.accessToken!, {
      name: `${input.name} — Ad`,
      creative: JSON.stringify({ creative_id: String(creative.id ?? '') }),
      status: 'PAUSED',
    });

    return {
      ok: true,
      mode: 'live',
      message: `Campaign ${metaCampaignId} launched with creative "${input.creative.file_name}".`,
      meta_campaign_id: metaCampaignId,
      meta_adset_id: metaAdSetId,
      meta_ad_id: String(ad.id ?? ''),
      creative_attached: true,
    };
  } catch (error) {
    return {
      ok: false,
      mode: 'live',
      message: error instanceof Error ? error.message : 'Unknown Meta API failure',
      creative_attached: Boolean(input.creative),
    };
  }
}

async function graphPost(
  path: string,
  accessToken: string,
  params: Record<string, string>,
): Promise<{ id?: string }> {
  const url = new URL(`${GRAPH_BASE}/${env.meta.apiVersion}/${path.replace(/^\/+/, '')}`);
  const form = new URLSearchParams(params);
  form.set('access_token', accessToken);

  const response = await fetch(url, { method: 'POST', body: form, cache: 'no-store' });
  const body = (await response.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };
  if (!response.ok || body?.error) {
    throw new Error(body?.error?.message ?? `Meta returned HTTP ${response.status} on ${path}`);
  }
  return body;
}

/* ------------------------------------------------------------ mapping */

function mapObjective(objective: string): Campaign['objective'] {
  const value = objective.toUpperCase();
  if (value.includes('LEAD')) return 'LEAD_GENERATION';
  if (value.includes('CONVERSION') || value.includes('SALES')) return 'CONVERSIONS';
  return 'TRAFFIC';
}

function mapCampaignStatus(status: string): Campaign['status'] {
  const value = status.toUpperCase();
  if (value === 'ACTIVE') return 'ACTIVE';
  if (value === 'ARCHIVED' || value === 'DELETED') return 'ARCHIVED';
  return 'PAUSED';
}

/** Used by /api/meta/sync when it needs a default window. */
export function defaultSyncWindow(days = 7): { startDate: string; endDate: string } {
  return { startDate: toDateKey(daysAgo(days - 1)), endDate: toDateKey(new Date()) };
}
