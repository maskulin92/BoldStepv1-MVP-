import 'server-only';
import { hashPin, hashPassword } from './auth';
import { daysAgo, deriveRates, round, seededRandom, toDateKey } from './utils';
import type {
  AdSet,
  Campaign,
  Client,
  Creative,
  DailyInsight,
  HermesApprovalLog,
  HermesPattern,
  HermesSettings,
  InsightMetrics,
  ManualEntry,
  PendingAction,
} from '@/types';

/**
 * Deterministic demo dataset used whenever Firestore credentials are absent.
 *
 * Everything is generated from a seeded PRNG so the numbers stay identical
 * across reloads — a dashboard whose figures jump on every refresh is useless
 * for spotting real bugs during local testing.
 *
 * Demo access (development only, never reachable in production):
 *   Owner   -> fadhil@boldstep.my / boldstep123
 *   Clients -> see DEMO_PINS below
 */

export const DEMO_OWNER_EMAIL = 'fadhil@boldstep.my';
export const DEMO_OWNER_PASSWORD = 'boldstep123';

export const DEMO_PINS: Record<string, string> = {
  'nova-dental': '123456',
  'zafran-property': '234567',
  'kasih-tuition': '345678',
  'boldstep-house': '999999',
};

const HISTORY_DAYS = 90;

/* -------------------------------------------------------------- clients */

interface ClientSeed {
  id: string;
  name: string;
  link_id: string;
  goal: Client['primary_goal'];
  is_owner: boolean;
  ad_account_id: string;
}

const CLIENT_SEEDS: ClientSeed[] = [
  {
    id: 'nova-dental',
    name: 'Nova Dental Clinic',
    link_id: 'nova-dental',
    goal: 'leads',
    is_owner: false,
    ad_account_id: 'act_100000000000001',
  },
  {
    id: 'zafran-property',
    name: 'Zafran Property',
    link_id: 'zafran-property',
    goal: 'leads',
    is_owner: false,
    ad_account_id: 'act_100000000000002',
  },
  {
    id: 'kasih-tuition',
    name: 'Kasih Tuition Centre',
    link_id: 'kasih-tuition',
    goal: 'conversions',
    is_owner: false,
    ad_account_id: 'act_100000000000003',
  },
  {
    id: 'boldstep-house',
    name: 'Boldstep (Own Account)',
    link_id: 'boldstep-house',
    goal: 'conversions',
    is_owner: true,
    ad_account_id: 'act_100000000000009',
  },
];

export function buildMockClients(): Client[] {
  return CLIENT_SEEDS.map((seed) => ({
    id: seed.id,
    name: seed.name,
    link_id: seed.link_id,
    ad_account_id: seed.ad_account_id,
    access_token_encrypted: '',
    access_pin_hash: hashPin(DEMO_PINS[seed.id] ?? '000000'),
    primary_goal: seed.goal,
    created_at: daysAgo(HISTORY_DAYS + 20).toISOString(),
    is_owner: seed.is_owner,
    settings: {
      notification_enabled: true,
      auto_execute: false,
      notification_channel: 'telegram' as const,
    },
  }));
}

/* ------------------------------------------------------------ campaigns */

interface CampaignSeed {
  client_id: string;
  id: string;
  name: string;
  objective: Campaign['objective'];
  status: Campaign['status'];
  budget: number;
  /** Baseline daily spend used by the insight generator. */
  base_spend: number;
  /** Baseline cost per lead — the generator walks around this. */
  base_cpl: number;
}

const CAMPAIGN_SEEDS: CampaignSeed[] = [
  { client_id: 'nova-dental', id: 'cmp-nova-implant', name: 'Nova — Dental Implant Leads', objective: 'LEAD_GENERATION', status: 'ACTIVE', budget: 120, base_spend: 118, base_cpl: 24 },
  { client_id: 'nova-dental', id: 'cmp-nova-braces', name: 'Nova — Braces Promo Q3', objective: 'LEAD_GENERATION', status: 'ACTIVE', budget: 80, base_spend: 76, base_cpl: 31 },
  { client_id: 'nova-dental', id: 'cmp-nova-retarget', name: 'Nova — Retargeting Warm', objective: 'TRAFFIC', status: 'PAUSED', budget: 40, base_spend: 22, base_cpl: 18 },

  { client_id: 'zafran-property', id: 'cmp-zaf-condo', name: 'Zafran — Condo Launch KL', objective: 'LEAD_GENERATION', status: 'ACTIVE', budget: 250, base_spend: 243, base_cpl: 46 },
  { client_id: 'zafran-property', id: 'cmp-zaf-landed', name: 'Zafran — Landed Selangor', objective: 'LEAD_GENERATION', status: 'ACTIVE', budget: 180, base_spend: 171, base_cpl: 58 },

  { client_id: 'kasih-tuition', id: 'cmp-kasih-spm', name: 'Kasih — SPM Intensive Signup', objective: 'CONVERSIONS', status: 'ACTIVE', budget: 90, base_spend: 88, base_cpl: 19 },
  { client_id: 'kasih-tuition', id: 'cmp-kasih-trial', name: 'Kasih — Free Trial Class', objective: 'CONVERSIONS', status: 'ACTIVE', budget: 60, base_spend: 57, base_cpl: 14 },

  { client_id: 'boldstep-house', id: 'cmp-bs-agency', name: 'Boldstep — Agency Retainer Leads', objective: 'LEAD_GENERATION', status: 'ACTIVE', budget: 150, base_spend: 144, base_cpl: 72 },
  { client_id: 'boldstep-house', id: 'cmp-bs-webinar', name: 'Boldstep — Webinar Funnel', objective: 'CONVERSIONS', status: 'ACTIVE', budget: 100, base_spend: 94, base_cpl: 38 },
  { client_id: 'boldstep-house', id: 'cmp-bs-brand', name: 'Boldstep — Brand Awareness', objective: 'TRAFFIC', status: 'ARCHIVED', budget: 50, base_spend: 12, base_cpl: 0 },
];

export function buildMockCampaigns(): Campaign[] {
  return CAMPAIGN_SEEDS.map((seed) => ({
    id: seed.id,
    client_id: seed.client_id,
    name: seed.name,
    objective: seed.objective,
    status: seed.status,
    budget_daily: seed.budget,
    created_at: daysAgo(HISTORY_DAYS + 5).toISOString(),
    last_synced: daysAgo(0).toISOString(),
    meta_campaign_id: `239${seed.id.length}${Math.abs(hashCode(seed.id))}`.slice(0, 17),
  }));
}

const ADSET_SUFFIXES = ['Broad 25-45', 'Lookalike 1%', 'Interest Stack'];

export function buildMockAdSets(): AdSet[] {
  const adSets: AdSet[] = [];
  for (const seed of CAMPAIGN_SEEDS) {
    const rand = seededRandom(`adset-${seed.id}`);
    const count = seed.status === 'ARCHIVED' ? 1 : 2 + Math.floor(rand() * 2);
    for (let i = 0; i < count; i += 1) {
      adSets.push({
        id: `${seed.id}-as${i + 1}`,
        client_id: seed.client_id,
        campaign_id: seed.id,
        name: `${seed.name.split('—')[1]?.trim() ?? seed.name} · ${ADSET_SUFFIXES[i % ADSET_SUFFIXES.length]}`,
        daily_budget: round(seed.budget / count, 2),
        targeting: {
          age_min: 25,
          age_max: 45 + i * 5,
          genders: i % 2 === 0 ? ['all'] : ['female'],
          locations: ['Kuala Lumpur', 'Selangor', 'Johor'].slice(0, 2 + (i % 2)),
          interests: ['Health', 'Family', 'Education', 'Property'].slice(i % 2, 2 + (i % 2)),
        },
        status: seed.status === 'ACTIVE' ? (i === 2 ? 'PAUSED' : 'ACTIVE') : 'PAUSED',
        created_at: daysAgo(HISTORY_DAYS).toISOString(),
        meta_adset_id: `239${Math.abs(hashCode(`${seed.id}-as${i}`))}`.slice(0, 17),
      });
    }
  }
  return adSets;
}

/* ------------------------------------------------------------- insights */

/** Builds `HISTORY_DAYS` of per-campaign daily rows with a believable shape:
 *  weekend dip, a slow CPL drift, and one campaign that visibly degrades. */
export function buildMockInsights(adSets: AdSet[]): DailyInsight[] {
  const insights: DailyInsight[] = [];
  const today = new Date();

  for (const seed of CAMPAIGN_SEEDS) {
    if (seed.status === 'ARCHIVED') continue;
    const campaignAdSets = adSets.filter((a) => a.campaign_id === seed.id);

    for (let dayOffset = HISTORY_DAYS - 1; dayOffset >= 0; dayOffset -= 1) {
      const date = daysAgo(dayOffset, today);
      const dateKey = toDateKey(date);
      const rand = seededRandom(`${seed.id}-${dateKey}`);

      const weekday = date.getUTCDay();
      const weekendFactor = weekday === 0 || weekday === 6 ? 0.78 : 1;
      // Nova's implant campaign is the one Hermes flags: CPL climbs late.
      const degradation =
        seed.id === 'cmp-nova-implant' && dayOffset < 10 ? 1 + (10 - dayOffset) * 0.045 : 1;

      const spend = round(seed.base_spend * weekendFactor * (0.85 + rand() * 0.3), 2);
      const cpl = round(seed.base_cpl * degradation * (0.88 + rand() * 0.26), 2);
      const leads = Math.max(0, Math.round(spend / Math.max(cpl, 1)));
      const clicks = Math.round(leads * (5 + rand() * 4) + rand() * 10);
      const impressions = Math.round(clicks * (45 + rand() * 35));
      const conversions =
        seed.objective === 'TRAFFIC' ? 0 : Math.max(0, Math.round(leads * (0.25 + rand() * 0.2)));

      const totals = { spend, impressions, clicks, leads, conversions };
      const metrics = deriveRates(totals);

      insights.push({
        id: `${dateKey}_${seed.id}`,
        client_id: seed.client_id,
        campaign_id: seed.id,
        campaign_name: seed.name,
        date: dateKey,
        synced_at: date.toISOString(),
        ...metrics,
        by_adset: splitAcrossAdSets(metrics, campaignAdSets, `${seed.id}-${dateKey}`),
      });
    }
  }

  return insights;
}

/** Splits a campaign's daily totals across its ad sets with stable weights. */
function splitAcrossAdSets(
  metrics: InsightMetrics,
  adSets: AdSet[],
  seed: string,
): Record<string, InsightMetrics> {
  if (adSets.length === 0) return {};
  const rand = seededRandom(`split-${seed}`);
  const weights = adSets.map(() => 0.5 + rand());
  const total = weights.reduce((a, b) => a + b, 0);

  const result: Record<string, InsightMetrics> = {};
  adSets.forEach((adSet, index) => {
    const share = weights[index] / total;
    const totals = {
      spend: round(metrics.spend * share, 2),
      impressions: Math.round(metrics.impressions * share),
      clicks: Math.round(metrics.clicks * share),
      leads: Math.round(metrics.leads * share),
      conversions: Math.round(metrics.conversions * share),
    };
    result[adSet.id] = deriveRates(totals);
  });
  return result;
}

/* ------------------------------------------------------ pending actions */

export function buildMockPendingActions(): PendingAction[] {
  const now = Date.now();
  const base = [
    {
      id: 'act-001',
      client_id: 'nova-dental',
      client_name: 'Nova Dental Clinic',
      action_type: 'pause' as const,
      campaign_id: 'cmp-nova-implant',
      campaign_name: 'Nova — Dental Implant Leads',
      adset_id: 'cmp-nova-implant-as3',
      suggestion_text: 'Pause ad set "Implant Leads · Interest Stack"',
      reason:
        'CPL on this ad set rose from RM24 to RM39 over the last 7 days while the campaign target is RM28. It now consumes 31% of the budget and returns 18% of the leads.',
      metadata: { current_cpl: 39.4, target_cpl: 28, performance_change: 64.2 },
      status: 'pending' as const,
      hoursAgo: 2,
    },
    {
      id: 'act-002',
      client_id: 'zafran-property',
      client_name: 'Zafran Property',
      action_type: 'budget_change' as const,
      campaign_id: 'cmp-zaf-condo',
      campaign_name: 'Zafran — Condo Launch KL',
      suggestion_text: 'Raise daily budget from RM250 to RM320',
      reason:
        'CPL held at RM44 (target RM55) for 9 consecutive days with frequency still below 2.1. Headroom exists to scale ~28% without CPL decay.',
      metadata: { current_cpl: 44.1, target_cpl: 55, current_budget: 250, proposed_budget: 320 },
      status: 'pending' as const,
      hoursAgo: 6,
    },
    {
      id: 'act-003',
      client_id: 'boldstep-house',
      client_name: 'Boldstep (Own Account)',
      action_type: 'pause' as const,
      campaign_id: 'cmp-bs-webinar',
      campaign_name: 'Boldstep — Webinar Funnel',
      suggestion_text: 'Pause campaign "Webinar Funnel" until creative refresh',
      reason:
        'Frequency reached 4.2 and CTR fell 41% week-over-week. Creative fatigue pattern matches 3 previous occurrences in memory.',
      metadata: { current_cpl: 51.8, target_cpl: 38, performance_change: -41 },
      status: 'pending' as const,
      hoursAgo: 11,
    },
    {
      id: 'act-004',
      client_id: 'kasih-tuition',
      client_name: 'Kasih Tuition Centre',
      action_type: 'analysis' as const,
      campaign_id: 'cmp-kasih-trial',
      campaign_name: 'Kasih — Free Trial Class',
      suggestion_text: 'Weekly analysis: trial-class funnel is the cheapest entry point',
      reason:
        'Free Trial Class delivers leads at RM13.90 vs RM19.40 for SPM Intensive. Consider shifting 20% of SPM budget once trial capacity allows.',
      metadata: { current_cpl: 13.9, target_cpl: 18 },
      status: 'pending' as const,
      hoursAgo: 20,
    },
    {
      id: 'act-005',
      client_id: 'boldstep-house',
      client_name: 'Boldstep (Own Account)',
      action_type: 'budget_change' as const,
      campaign_id: 'cmp-bs-agency',
      campaign_name: 'Boldstep — Agency Retainer Leads',
      suggestion_text: 'Reduce daily budget from RM150 to RM110',
      reason: 'CPL exceeded target for 5 straight days after the Raya period ended.',
      metadata: { current_cpl: 88.2, target_cpl: 72, current_budget: 150, proposed_budget: 110 },
      status: 'executed' as const,
      hoursAgo: 52,
    },
  ];

  return base.map((a) => ({
    id: a.id,
    client_id: a.client_id,
    client_name: a.client_name,
    from_model: 'glm' as const,
    action_type: a.action_type,
    campaign_id: a.campaign_id,
    campaign_name: a.campaign_name,
    adset_id: 'adset_id' in a ? (a as { adset_id?: string }).adset_id : undefined,
    suggestion_text: a.suggestion_text,
    reason: a.reason,
    metadata: a.metadata,
    status: a.status,
    fadhil_decision: a.status === 'executed' ? 'Approved — agreed with the CPL read.' : '',
    created_at: new Date(now - a.hoursAgo * 3600_000).toISOString(),
    executed_at:
      a.status === 'executed' ? new Date(now - (a.hoursAgo - 1) * 3600_000).toISOString() : undefined,
    meta_result:
      a.status === 'executed'
        ? {
            ok: true,
            mode: 'mock' as const,
            message: 'Budget updated on Meta.',
            applied: { daily_budget: 110 },
            executed_at: new Date(now - (a.hoursAgo - 1) * 3600_000).toISOString(),
          }
        : undefined,
  }));
}

/* ---------------------------------------------------------- creatives */

export function buildMockCreatives(): Creative[] {
  const seeds: { client: string; campaign: string; name: string; type: 'image' | 'video' }[] = [
    { client: 'nova-dental', campaign: 'cmp-nova-implant', name: 'implant-before-after-01.jpg', type: 'image' },
    { client: 'nova-dental', campaign: 'cmp-nova-braces', name: 'braces-promo-story.mp4', type: 'video' },
    { client: 'zafran-property', campaign: 'cmp-zaf-condo', name: 'condo-launch-carousel-a.png', type: 'image' },
    { client: 'kasih-tuition', campaign: 'cmp-kasih-spm', name: 'spm-testimonial-reel.mp4', type: 'video' },
    { client: 'boldstep-house', campaign: 'cmp-bs-agency', name: 'agency-case-study.png', type: 'image' },
  ];

  return seeds.map((seed, index) => {
    const uploaded = daysAgo(index + 1);
    const expires = new Date(uploaded.getTime() + 7 * 86400_000);
    return {
      id: `crv-${index + 1}`,
      client_id: seed.client,
      file_name: seed.name,
      file_type: seed.type,
      content_type: seed.type === 'image' ? 'image/png' : 'video/mp4',
      storage_path: `creatives/${seed.client}/crv-${index + 1}-${seed.name}`,
      campaign_id: seed.campaign,
      download_url: '',
      url_expires_at: expires.toISOString(),
      uploaded_at: uploaded.toISOString(),
      size_bytes: seed.type === 'image' ? 480_000 + index * 90_000 : 8_400_000 + index * 1_200_000,
      status: 'approved' as const,
      uploaded_by: 'fadhil' as const,
      reviewed_at: uploaded.toISOString(),
    };
  });
}

/* ------------------------------------------------------ manual entries */

export function buildMockManualEntries(): ManualEntry[] {
  const entries: ManualEntry[] = [];
  const seeds = [
    { client: 'nova-dental', campaign: 'cmp-nova-implant', type: 'leads_closed' as const, base: 4 },
    { client: 'nova-dental', campaign: 'cmp-nova-implant', type: 'sales_value' as const, base: 5200 },
    { client: 'zafran-property', campaign: 'cmp-zaf-condo', type: 'leads_closed' as const, base: 2 },
    { client: 'kasih-tuition', campaign: 'cmp-kasih-spm', type: 'leads_closed' as const, base: 6 },
    { client: 'boldstep-house', campaign: 'cmp-bs-agency', type: 'sales_value' as const, base: 9800 },
  ];

  seeds.forEach((seed, seedIndex) => {
    for (let dayOffset = 0; dayOffset < 6; dayOffset += 1) {
      const date = daysAgo(dayOffset);
      const rand = seededRandom(`manual-${seed.campaign}-${seed.type}-${dayOffset}`);
      entries.push({
        id: `man-${seedIndex}-${dayOffset}`,
        client_id: seed.client,
        campaign_id: seed.campaign,
        metric_type: seed.type,
        value: round(seed.base * (0.6 + rand() * 0.9), seed.type === 'sales_value' ? 2 : 0),
        notes: seed.type === 'sales_value' ? 'Closed via WhatsApp follow-up' : 'Confirmed by sales team',
        entered_by: 'fadhil',
        created_at: date.toISOString(),
        date: toDateKey(date),
        status: 'approved',
      });
    }
  });

  // A client-submitted entry awaiting review, so the approval queue is
  // demonstrable before any real client has submitted anything.
  const submittedAt = daysAgo(0, new Date(new Date().setHours(11, 5, 0, 0)));
  entries.push({
    id: 'man-client-0',
    client_id: 'nova-dental',
    campaign_id: 'cmp-nova-implant',
    metric_type: 'leads_closed',
    value: 3,
    notes: '3 walk-in cases from the implant workshop — not captured in Meta',
    entered_by: 'client',
    created_at: submittedAt.toISOString(),
    date: toDateKey(submittedAt),
    status: 'pending_approval',
  });

  return entries;
}

/* --------------------------------------------------------- hermes ---- */

export function buildMockHermesPatterns(): HermesPattern[] {
  return [
    {
      pattern_id: 'weekend-cpl-spike',
      description: 'CPL rises 18–25% on Saturday and Sunday across lead-gen campaigns.',
      frequency: 11,
      examples: ['Nova — Dental Implant Leads (4x)', 'Zafran — Condo Launch KL (5x)', 'Kasih — SPM Intensive (2x)'],
      confidence: 0.82,
      last_seen: daysAgo(2).toISOString(),
    },
    {
      pattern_id: 'creative-fatigue-freq-4',
      description: 'CTR drops sharply once ad set frequency passes 3.8 — refresh creative before it hits 4.2.',
      frequency: 6,
      examples: ['Boldstep — Webinar Funnel', 'Nova — Braces Promo Q3'],
      confidence: 0.91,
      last_seen: daysAgo(1).toISOString(),
    },
    {
      pattern_id: 'budget-scale-safe-25',
      description: 'Budget increases up to 25% hold CPL steady; beyond 40% CPL degrades within 3 days.',
      frequency: 4,
      examples: ['Zafran — Condo Launch KL', 'Kasih — Free Trial Class'],
      confidence: 0.74,
      last_seen: daysAgo(5).toISOString(),
    },
    {
      pattern_id: 'payday-conversion-lift',
      description: 'Conversions lift 30%+ on the 25th–28th of each month (Malaysian payday cycle).',
      frequency: 3,
      examples: ['Kasih — SPM Intensive Signup', 'Boldstep — Webinar Funnel'],
      confidence: 0.68,
      last_seen: daysAgo(12).toISOString(),
    },
  ];
}

export function buildMockApprovalLog(): HermesApprovalLog[] {
  return [
    {
      id: 'log-1',
      decision: 'approved',
      campaign: 'Boldstep — Agency Retainer Leads',
      reason: 'CPL exceeded target 5 days running after Raya.',
      outcome: 'CPL back to RM70 within 3 days. Budget cut held.',
      timestamp: daysAgo(2).toISOString(),
    },
    {
      id: 'log-2',
      decision: 'rejected',
      campaign: 'Kasih — Free Trial Class',
      reason: 'Hermes suggested pausing on a 2-day CPL spike.',
      outcome: 'Correct call to reject — CPL normalised on day 3 without intervention.',
      timestamp: daysAgo(6).toISOString(),
    },
    {
      id: 'log-3',
      decision: 'modified',
      campaign: 'Zafran — Condo Launch KL',
      reason: 'Suggested +40% budget; applied +20% instead.',
      outcome: 'CPL stable at RM45. Confirms the 25% safe-scaling pattern.',
      timestamp: daysAgo(9).toISOString(),
    },
    {
      id: 'log-4',
      decision: 'approved',
      campaign: 'Nova — Retargeting Warm',
      reason: 'Audience exhausted, frequency 5.1.',
      outcome: 'Paused. Spend redirected to Implant Leads.',
      timestamp: daysAgo(14).toISOString(),
    },
  ];
}

export function defaultHermesSettings(): HermesSettings {
  return {
    frequency: '12h',
    auto_execute: false,
    notification_channel: 'telegram',
    monitored_campaigns: 'all',
    updated_at: new Date().toISOString(),
  };
}

export function buildMockOwner() {
  return {
    id: 'owner_fadhil',
    email: DEMO_OWNER_EMAIL,
    password_hash: hashPassword(DEMO_OWNER_PASSWORD),
    created_at: daysAgo(HISTORY_DAYS + 30).toISOString(),
    permissions: ['read', 'write', 'execute'] as const,
  };
}

function hashCode(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
  }
  return h;
}
