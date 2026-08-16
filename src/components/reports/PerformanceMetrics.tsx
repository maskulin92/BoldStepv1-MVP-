'use client';

import { Skeleton } from '@/components/common/LoadingSpinner';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils';
import type { ClientSummary } from '@/types';

/** The secondary metric strip beneath the KPI cards. */
export default function PerformanceMetrics({
  summary,
  loading,
}: {
  summary: ClientSummary | null;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index}>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-5 w-20" />
          </div>
        ))}
      </div>
    );
  }

  const data = summary;
  const rows: { label: string; value: string }[] = [
    { label: 'Impressions', value: formatNumber(data?.total_impressions ?? 0) },
    { label: 'Clicks', value: formatNumber(data?.total_clicks ?? 0) },
    { label: 'Conversions', value: formatNumber(data?.total_conversions ?? 0) },
    { label: 'CPM', value: formatCurrency(data?.avg_cpm ?? 0) },
    { label: 'CPC', value: formatCurrency(data?.avg_cpc ?? 0) },
    { label: 'CTR', value: formatPercent(data?.avg_ctr ?? 0) },
  ];

  return (
    <div className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-6">
      {rows.map((row) => (
        <div key={row.label}>
          <p className="text-xs uppercase tracking-wide text-cream-100/45">{row.label}</p>
          <p className="mt-1 text-lg font-semibold text-cream-100">{row.value}</p>
        </div>
      ))}
    </div>
  );
}
