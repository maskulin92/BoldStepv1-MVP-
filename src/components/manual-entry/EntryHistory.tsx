'use client';

import { ClipboardList } from 'lucide-react';
import { API } from '@/constants/api-endpoints';
import { useFirestoreList } from '@/hooks/useFirestore';
import { EmptyState, ErrorState } from '@/components/common/States';
import { Skeleton } from '@/components/common/LoadingSpinner';
import { MANUAL_METRIC_TYPES } from '@/constants/form-options';
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import type { ManualEntry, ManualEntryStatus } from '@/types';

const LABELS = Object.fromEntries(
  MANUAL_METRIC_TYPES.map((option) => [option.value, option.label]),
) as Record<string, string>;

const STATUS_STYLES: Record<ManualEntryStatus, { label: string; className: string }> = {
  pending_approval: { label: 'Pending', className: 'bg-amber-400/15 text-amber-300' },
  approved: { label: 'Approved', className: 'bg-emerald-400/15 text-emerald-300' },
  rejected: { label: 'Rejected', className: 'bg-red-400/15 text-red-300' },
};

export default function EntryHistory({
  accountId,
  refreshKey = 0,
  campaignNames = {},
}: {
  accountId: string;
  refreshKey?: number;
  campaignNames?: Record<string, string>;
}) {
  // approved_only=false so submitters can follow the review status of what
  // they filed — the API still scopes the rows to this client.
  const { items, loading, error, refetch } = useFirestoreList<ManualEntry>(
    `${API.manualEntry.list(accountId)}?approved_only=false`,
    [accountId, refreshKey],
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
          description="Entries recorded here flow into reports once approved."
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
                <th className="th">Status</th>
                <th className="th">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {items.map((entry) => {
                const status = STATUS_STYLES[entry.status ?? 'approved'];
                return (
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
                    <td className="td">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${status.className}`}
                        title={entry.review_note ?? undefined}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="td max-w-[260px] truncate text-cream-100/55">
                      {entry.notes || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
