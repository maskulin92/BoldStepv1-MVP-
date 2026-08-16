import type { CampaignObjective, HermesFrequency, ManualMetricType, PrimaryGoal } from '@/types';

export const PRIMARY_GOALS: { value: PrimaryGoal; label: string }[] = [
  { value: 'leads', label: 'Leads' },
  { value: 'conversions', label: 'Conversions' },
  { value: 'traffic', label: 'Traffic' },
];

export const CAMPAIGN_OBJECTIVES: { value: CampaignObjective; label: string }[] = [
  { value: 'LEAD_GENERATION', label: 'Lead Generation' },
  { value: 'CONVERSIONS', label: 'Conversions' },
  { value: 'TRAFFIC', label: 'Traffic' },
];

export const MANUAL_METRIC_TYPES: { value: ManualMetricType; label: string; hint: string }[] = [
  { value: 'leads_closed', label: 'Leads Closed', hint: 'Number of leads that converted to customers' },
  { value: 'sales_value', label: 'Sales Value (RM)', hint: 'Total revenue attributed to this campaign' },
  { value: 'conversion_custom', label: 'Custom Conversion', hint: 'Any other conversion you track offline' },
];

export const HERMES_FREQUENCIES: { value: HermesFrequency; label: string }[] = [
  { value: '6h', label: 'Every 6 hours' },
  { value: '12h', label: 'Every 12 hours' },
  { value: '24h', label: 'Once a day' },
];

export const DATE_PRESETS = [
  { value: '7d', label: 'Last 7 days', days: 7 },
  { value: '14d', label: 'Last 14 days', days: 14 },
  { value: '30d', label: 'Last 30 days', days: 30 },
  { value: '90d', label: 'Last 90 days', days: 90 },
] as const;

export type DatePresetValue = (typeof DATE_PRESETS)[number]['value'];

export const WEBHOOK_EVENTS = [
  'insight.synced',
  'action.created',
  'action.approved',
  'action.executed',
  'creative.uploaded',
  'manual_entry.created',
] as const;

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

export const ALLOWED_UPLOAD_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
] as const;

/** Signed download URLs live for 7 days, per the brief. */
export const CREATIVE_URL_TTL_DAYS = 7;
