'use client';

import { useMemo, useState } from 'react';
import { ArrowUpDown, ChevronRight } from 'lucide-react';
import { EmptyState, ErrorState } from '@/components/common/States';
import { Skeleton } from '@/components/common/LoadingSpinner';
import { STATUS_STYLES } from '@/constants/theme';
import { cn, formatCurrency, formatNumber, formatPercent, relativeTime } from '@/lib/utils';
import type { CampaignWithStats } from '@/hooks/useClientData';

type SortKey = 'name' | 'spend' | 'leads' | 'cpl' | 'ctr';

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'name', label: 'Campaign' },
  { key: 'spend', label: 'Spend', numeric: true },
  { key: 'leads', label: 'Results', numeric: true },
  { key: 'cpl', label: 'CPL', numeric: true },
  { key: 'ctr', label: 'CTR', numeric: true },
];

export default function CampaignTable({
  campaigns,
  loading,
  error,
  onRetry,
  onSelect,
}: {
  campaigns: CampaignWithStats[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onSelect?: (campaign: CampaignWithStats) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('spend');
  const [ascending, setAscending] = useState(false);

  const sorted = useMemo(() => {
    const value = (campaign: CampaignWithStats): number | string => {
      switch (sortKey) {
        case 'name':
          return campaign.name.toLowerCase();
        case 'spend':
          return campaign.stats.total_spend;
        case 'leads':
          return campaign.stats.total_leads;
        case 'cpl':
          return campaign.stats.avg_cpl;
        case 'ctr':
          return campaign.stats.avg_ctr;
      }
    };

    return [...campaigns].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      const comparison =
        typeof left === 'string' && typeof right === 'string'
          ? left.localeCompare(right)
          : Number(left) - Number(right);
      return ascending ? comparison : -comparison;
    });
  }, [campaigns, sortKey, ascending]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setAscending((value) => !value);
    else {
      setSortKey(key);
      setAscending(key === 'name');
    }
  };

  if (error) {
    return (
      <section className="card p-4 sm:p-5">
        <h2 className="mb-4 text-sm font-semibold text-cream-100">Campaign breakdown</h2>
        <ErrorState message={error} onRetry={onRetry} />
      </section>
    );
  }

  return (
    <section className="card p-4 sm:p-5">
      <h2 className="mb-4 text-sm font-semibold text-cream-100">Campaign breakdown</h2>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          description="Campaigns appear here after the first Meta sync for this client."
        />
      ) : (
        <div className="table-wrap">
          <table className="w-full border-collapse">
            <thead className="bg-navy-950/50">
              <tr>
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    className={cn('th', column.numeric && 'text-right')}
                    aria-sort={
                      sortKey === column.key ? (ascending ? 'ascending' : 'descending') : 'none'
                    }
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className={cn(
                        'inline-flex items-center gap-1 transition hover:text-cream-100',
                        sortKey === column.key && 'text-cream-100',
                      )}
                    >
                      {column.label}
                      <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden />
                    </button>
                  </th>
                ))}
                <th className="th">Status</th>
                <th className="th text-right">Updated</th>
                {onSelect ? <th className="th w-10" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {sorted.map((campaign) => (
                <tr
                  key={campaign.id}
                  className={cn('transition hover:bg-cream-100/[0.04]', onSelect && 'cursor-pointer')}
                  onClick={onSelect ? () => onSelect(campaign) : undefined}
                >
                  <td className="td max-w-[260px] truncate font-medium text-cream-100">
                    {campaign.name}
                  </td>
                  <td className="td text-right">{formatCurrency(campaign.stats.total_spend)}</td>
                  <td className="td text-right">{formatNumber(campaign.stats.total_leads)}</td>
                  <td className="td text-right">{formatCurrency(campaign.stats.avg_cpl)}</td>
                  <td className="td text-right">{formatPercent(campaign.stats.avg_ctr)}</td>
                  <td className="td">
                    <span className={cn('badge', STATUS_STYLES[campaign.status])}>
                      {campaign.status}
                    </span>
                  </td>
                  <td className="td text-right text-cream-100/50">
                    {relativeTime(campaign.last_synced)}
                  </td>
                  {onSelect ? (
                    <td className="td text-right text-cream-100/35">
                      <ChevronRight className="h-4 w-4" aria-hidden />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
