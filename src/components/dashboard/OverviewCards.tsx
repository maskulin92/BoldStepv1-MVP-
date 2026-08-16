'use client';

import { MousePointerClick, Target, TrendingDown, TrendingUp, Users, Wallet } from 'lucide-react';
import { Skeleton } from '@/components/common/LoadingSpinner';
import { cn, formatCurrency, formatNumber, formatPercent } from '@/lib/utils';
import type { ClientSummary } from '@/types';

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  /** Percent change vs the previous window. */
  change?: number | null;
  /** For CPL, a fall is good — flips the colour of the delta. */
  lowerIsBetter?: boolean;
}

function KpiCard({ label, value, hint, icon, change, lowerIsBetter = false }: KpiCardProps) {
  const hasChange = typeof change === 'number' && Number.isFinite(change) && change !== 0;
  const improved = hasChange ? (lowerIsBetter ? change < 0 : change > 0) : false;

  return (
    <div className="card card-hover p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-cream-100/50">
          {label}
        </span>
        <span className="text-cream-100/35">{icon}</span>
      </div>

      <p className="mt-2.5 text-2xl font-semibold tracking-tight text-cream-100">{value}</p>

      <div className="mt-1.5 flex items-center gap-2">
        {hasChange ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 text-xs font-medium',
              improved ? 'text-accent-success' : 'text-accent-danger',
            )}
          >
            {change > 0 ? (
              <TrendingUp className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" aria-hidden />
            )}
            {Math.abs(change).toFixed(1)}%
          </span>
        ) : null}
        {hint ? <span className="text-xs text-cream-100/40">{hint}</span> : null}
      </div>
    </div>
  );
}

interface OverviewCardsProps {
  summary: ClientSummary | null;
  loading?: boolean;
  /** Same metrics for the preceding window, to compute deltas. */
  previous?: ClientSummary | null;
  goalLabel?: string;
}

export default function OverviewCards({
  summary,
  loading,
  previous,
  goalLabel = 'Leads',
}: OverviewCardsProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="card p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-32" />
            <Skeleton className="mt-2 h-3 w-16" />
          </div>
        ))}
      </div>
    );
  }

  const data = summary ?? {
    total_spend: 0,
    total_leads: 0,
    total_conversions: 0,
    total_clicks: 0,
    total_impressions: 0,
    avg_cpl: 0,
    avg_ctr: 0,
    avg_cpm: 0,
    avg_cpc: 0,
  };

  const delta = (current: number, prior: number | undefined): number | null => {
    if (prior === undefined || !prior) return null;
    return ((current - prior) / prior) * 100;
  };

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label="Total spend"
        value={formatCurrency(data.total_spend)}
        icon={<Wallet className="h-4 w-4" aria-hidden />}
        change={delta(data.total_spend, previous?.total_spend)}
      />
      <KpiCard
        label={goalLabel}
        value={formatNumber(data.total_leads)}
        hint={`${formatNumber(data.total_conversions)} conversions`}
        icon={<Users className="h-4 w-4" aria-hidden />}
        change={delta(data.total_leads, previous?.total_leads)}
      />
      <KpiCard
        label="Cost per lead"
        value={formatCurrency(data.avg_cpl)}
        icon={<Target className="h-4 w-4" aria-hidden />}
        change={delta(data.avg_cpl, previous?.avg_cpl)}
        lowerIsBetter
      />
      <KpiCard
        label="CTR"
        value={formatPercent(data.avg_ctr)}
        hint={`CPM ${formatCurrency(data.avg_cpm)}`}
        icon={<MousePointerClick className="h-4 w-4" aria-hidden />}
        change={delta(data.avg_ctr, previous?.avg_ctr)}
      />
    </div>
  );
}
