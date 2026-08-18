'use client';

import { useState } from 'react';
import { ChevronDown, Layers } from 'lucide-react';
import { API } from '@/constants/api-endpoints';
import { useFirestore } from '@/hooks/useFirestore';
import { EmptyState, ErrorState } from '@/components/common/States';
import { LoadingPanel } from '@/components/common/LoadingSpinner';
import { STATUS_STYLES } from '@/constants/theme';
import { cn, formatCurrency, formatNumber, formatPercent } from '@/lib/utils';
import type { AdSet, Campaign, InsightMetrics, PendingAction, TrendPoint } from '@/types';

interface AdSetWithStats extends AdSet {
  stats: InsightMetrics;
}

interface CampaignDetail {
  campaign: Campaign;
  ad_sets: AdSetWithStats[];
  trend_30d: TrendPoint[];
  pending_actions: PendingAction[];
}

/** Ad-set level drill-down for one campaign. */
export default function AdSetBreakdown({
  accountId,
  campaignId,
}: {
  accountId: string;
  campaignId: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, loading, error, refetch } = useFirestore<CampaignDetail>(
    API.campaigns.detail(accountId, campaignId),
    [accountId, campaignId],
  );

  if (loading) return <LoadingPanel label="Loading ad sets…" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data || data.ad_sets.length === 0) {
    return (
      <EmptyState
        icon={<Layers className="h-6 w-6" aria-hidden />}
        title="No ad sets for this campaign"
        description="Ad sets appear after a sync that includes ad-set level data."
      />
    );
  }

  return (
    <div className="space-y-2">
      {data.ad_sets.map((adSet) => {
        const open = expanded === adSet.id;
        return (
          <div key={adSet.id} className="rounded-lg border border-surface-border bg-navy-950/40">
            <button
              type="button"
              onClick={() => setExpanded(open ? null : adSet.id)}
              aria-expanded={open}
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
            >
              <ChevronDown
                className={cn(
                  'h-4 w-4 shrink-0 text-cream-100/40 transition-transform',
                  open && 'rotate-180',
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-cream-100">
                  {adSet.name}
                </span>
                <span className="block text-xs text-cream-100/45">
                  Budget {formatCurrency(adSet.daily_budget)}/day
                </span>
              </span>
              <span className="hidden text-right sm:block">
                <span className="block text-sm font-medium text-cream-100">
                  {formatCurrency(adSet.stats.spend)}
                </span>
                <span className="block text-xs text-cream-100/45">
                  CPL {formatCurrency(adSet.stats.cpl)}
                </span>
              </span>
              <span className={cn('badge shrink-0', STATUS_STYLES[adSet.status])}>
                {adSet.status}
              </span>
            </button>

            {open ? (
              <div className="border-t border-surface-border px-4 py-3">
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ['Spend', formatCurrency(adSet.stats.spend)],
                    ['Leads', formatNumber(adSet.stats.leads)],
                    ['CPL', formatCurrency(adSet.stats.cpl)],
                    ['CTR', formatPercent(adSet.stats.ctr)],
                    ['Impressions', formatNumber(adSet.stats.impressions)],
                    ['Clicks', formatNumber(adSet.stats.clicks)],
                    ['CPC', formatCurrency(adSet.stats.cpc)],
                    ['CPM', formatCurrency(adSet.stats.cpm)],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs uppercase tracking-wide text-cream-100/45">{label}</dt>
                      <dd className="mt-0.5 text-sm font-medium text-cream-100">{value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-4 border-t border-surface-border pt-3">
                  <p className="text-xs uppercase tracking-wide text-cream-100/45">Targeting</p>
                  <p className="mt-1 text-sm text-cream-100/75">
                    Age {adSet.targeting.age_min}–{adSet.targeting.age_max}
                    {adSet.targeting.locations.length > 0
                      ? ` · ${adSet.targeting.locations.join(', ')}`
                      : ''}
                    {adSet.targeting.interests.length > 0
                      ? ` · ${adSet.targeting.interests.join(', ')}`
                      : ''}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
