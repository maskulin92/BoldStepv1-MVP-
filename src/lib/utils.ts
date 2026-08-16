import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { DailyInsight, InsightMetrics, ClientSummary, TrendPoint } from '@/types';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------ dates */

/** YYYY-MM-DD in UTC — the canonical date key used across Firestore. */
export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function daysAgo(days: number, from: Date = new Date()): Date {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

export function defaultDateRange(days = 7): { start: string; end: string } {
  const end = new Date();
  return { start: toDateKey(daysAgo(days - 1, end)), end: toDateKey(end) };
}

/** Inclusive list of YYYY-MM-DD keys between two dates. */
export function dateRangeKeys(start: string, end: string): string[] {
  const keys: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return keys;
  let guard = 0;
  while (cursor <= last && guard < 400) {
    keys.push(toDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard += 1;
  }
  return keys;
}

export function isValidDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function formatDate(value: string, locale = 'en-MY'): string {
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function formatDateTime(value: string, locale = 'en-MY'): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

export function relativeTime(value: string): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/* ---------------------------------------------------------------- numbers */

export function formatCurrency(value: number, currency = 'RM'): string {
  if (!Number.isFinite(value)) return `${currency} 0.00`;
  return `${currency} ${value.toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString('en-MY', { maximumFractionDigits: 0 });
}

export function formatPercent(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '0%';
  return `${value.toFixed(digits)}%`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Guards every division in the codebase against 0 and NaN. */
export function safeDivide(numerator: number, denominator: number): number {
  if (!denominator || !Number.isFinite(denominator) || !Number.isFinite(numerator)) return 0;
  return numerator / denominator;
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor;
}

/** Percentage change from `previous` to `current`. */
export function percentChange(current: number, previous: number): number {
  if (!previous) return current > 0 ? 100 : 0;
  return round(((current - previous) / previous) * 100, 1);
}

/* --------------------------------------------------------------- metrics */

export const EMPTY_METRICS: InsightMetrics = {
  spend: 0,
  impressions: 0,
  clicks: 0,
  leads: 0,
  conversions: 0,
  ctr: 0,
  cpm: 0,
  cpc: 0,
  cpl: 0,
};

/** Recomputes derived rates from the raw totals — never sum ratios directly. */
export function deriveRates(raw: {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  conversions: number;
}): InsightMetrics {
  return {
    ...raw,
    ctr: round(safeDivide(raw.clicks, raw.impressions) * 100, 2),
    cpm: round(safeDivide(raw.spend, raw.impressions) * 1000, 2),
    cpc: round(safeDivide(raw.spend, raw.clicks), 2),
    cpl: round(safeDivide(raw.spend, raw.leads), 2),
  };
}

export function sumInsights(insights: DailyInsight[]): ClientSummary {
  const totals = insights.reduce(
    (acc, i) => ({
      spend: acc.spend + (i.spend || 0),
      impressions: acc.impressions + (i.impressions || 0),
      clicks: acc.clicks + (i.clicks || 0),
      leads: acc.leads + (i.leads || 0),
      conversions: acc.conversions + (i.conversions || 0),
    }),
    { spend: 0, impressions: 0, clicks: 0, leads: 0, conversions: 0 },
  );

  const rates = deriveRates(totals);
  return {
    total_spend: round(totals.spend),
    total_leads: totals.leads,
    total_conversions: totals.conversions,
    total_clicks: totals.clicks,
    total_impressions: totals.impressions,
    avg_cpl: rates.cpl,
    avg_ctr: rates.ctr,
    avg_cpm: rates.cpm,
    avg_cpc: rates.cpc,
  };
}

/** Collapses per-campaign rows into one point per day for the trend chart. */
export function buildTrend(insights: DailyInsight[]): TrendPoint[] {
  const byDate = new Map<string, { spend: number; impressions: number; clicks: number; leads: number; conversions: number }>();

  for (const insight of insights) {
    const current = byDate.get(insight.date) ?? {
      spend: 0,
      impressions: 0,
      clicks: 0,
      leads: 0,
      conversions: 0,
    };
    byDate.set(insight.date, {
      spend: current.spend + (insight.spend || 0),
      impressions: current.impressions + (insight.impressions || 0),
      clicks: current.clicks + (insight.clicks || 0),
      leads: current.leads + (insight.leads || 0),
      conversions: current.conversions + (insight.conversions || 0),
    });
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, totals]) => {
      const rates = deriveRates(totals);
      return {
        date,
        spend: round(totals.spend),
        leads: totals.leads,
        cpl: rates.cpl,
        clicks: totals.clicks,
        impressions: totals.impressions,
        ctr: rates.ctr,
      };
    });
}

/* ----------------------------------------------------------------- misc */

export function paginate<T>(items: T[], page: number, perPage: number) {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safePerPage = Math.min(200, Math.max(1, Math.floor(perPage) || 25));
  const start = (safePage - 1) * safePerPage;
  return {
    items: items.slice(start, start + safePerPage),
    pagination: {
      page: safePage,
      per_page: safePerPage,
      total: items.length,
      total_pages: Math.max(1, Math.ceil(items.length / safePerPage)),
    },
  };
}

/** Deterministic pseudo-random in [0,1) — keeps mock data stable across reloads. */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** Strips path separators so a user-supplied filename can't escape its prefix. */
export function sanitizeFileName(name: string): string {
  return (
    name
      .replace(/[/\\]/g, '_')
      .replace(/[^\w.\- ]/g, '')
      .replace(/\s+/g, '_')
      .slice(-120) || 'file'
  );
}
