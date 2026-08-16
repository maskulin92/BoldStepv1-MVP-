'use client';

import { ClipboardList } from 'lucide-react';
import { API } from '@/constants/api-endpoints';
import { useFirestoreList } from '@/hooks/useFirestore';
import { EmptyState, ErrorState } from '@/components/common/States';
import { Skeleton } from '@/components/common/LoadingSpinner';
import { MANUAL_METRIC_TYPES } from '@/constants/form-options';
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import type { ManualEntry } from '@/types';

const LABELS = Object.fromEntries(
  MANUAL_METRIC_TYPES.map((option) => [option.value, option.label]),
) as Record<string, string>;

export default function EntryHistory({
  clientId,
  refreshKey = 0,
  campaignNames = {},
}: {
  clientId: string;
  refreshKey?: number;
  campaignNames?: Record<string, string>;
}) {
  const { items, loading, error, refetch } = useFirestoreList<ManualEntry>(
    API.manualEntry.list(clientId),
    [clientId, refreshKey],
  );

  if (error) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <section className="card p-4 sm:p-5">
      <h2 className="mb-4 text-sm font-semibold text-cream-100">Entry history</h2>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-6 w-6" aria-hidden />}
          title="No manual entries yet"
          description="Entries you record above appear here and flow into reports."
        />
      ) : (
        <div className="table-wrap">
          <table className="w-full border-collapse">
            <thead className="bg-navy-950/50">
              <tr>
                <th className="th">Date</th>
                <th className="th">Campaign</th>
                <th className="th">Metric</th>
                <th className="th text-right">Value</th>
                <th className="th">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {items.map((entry) => (
                <tr key={entry.id}>
                  <td className="td">{formatDate(entry.date)}</td>
                  <td className="td max-w-[220px] truncate">
                    {campaignNames[entry.campaign_id] ?? entry.campaign_id}
                  </td>
                  <td className="td">{LABELS[entry.metric_type] ?? entry.metric_type}</td>
                  <td className="td text-right font-medium text-cream-100">
                    {entry.metric_type === 'sales_value'
                      ? formatCurrency(entry.value)
                      : formatNumber(entry.value)}
                  </td>
                  <td className="td max-w-[260px] truncate text-cream-100/55">
                    {entry.notes || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
