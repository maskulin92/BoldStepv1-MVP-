'use client';

import { useState } from 'react';
import { CheckCircle2, ClipboardCheck, Image as ImageIcon, XCircle } from 'lucide-react';
import { API } from '@/constants/api-endpoints';
import { ApiClientError, apiPost } from '@/lib/api-client';
import { useFirestoreList } from '@/hooks/useFirestore';
import { EmptyState, ErrorState, InlineNotice } from '@/components/common/States';
import { Skeleton } from '@/components/common/LoadingSpinner';
import { MANUAL_METRIC_TYPES } from '@/constants/form-options';
import { formatBytes, formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import type { Creative, ManualEntry } from '@/types';

const METRIC_LABELS = Object.fromEntries(
  MANUAL_METRIC_TYPES.map((option) => [option.value, option.label]),
) as Record<string, string>;

interface CreativeRow extends Creative {
  url_expired: boolean;
}

/**
 * The owner's quality-control queue in Section A: client-submitted creatives
 * and manual entries wait here until approved (which publishes them into the
 * client-facing library / metrics) or rejected (which hides them).
 */
export default function ReviewQueue({ accountId }: { accountId: string }) {
  const [creativeRefresh, setCreativeRefresh] = useState(0);
  const [entryRefresh, setEntryRefresh] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const creatives = useFirestoreList<CreativeRow>(
    `${API.creatives.list(accountId)}?status=pending_review`,
    [accountId, creativeRefresh],
  );
  const entries = useFirestoreList<ManualEntry>(
    `${API.manualEntry.list(accountId)}?approved_only=false&status=pending_approval`,
    [accountId, entryRefresh],
  );

  const decide = async (
    kind: 'creative' | 'entry',
    id: string,
    decision: 'approved' | 'rejected',
  ) => {
    setBusyId(id);
    setNotice(null);
    try {
      await apiPost(
        kind === 'creative' ? API.creatives.review(id) : API.manualEntry.review(id),
        { decision },
      );
      setNotice({
        tone: 'success',
        text: decision === 'approved' ? 'Approved.' : 'Rejected — excluded from metrics.',
      });
      setCreativeRefresh((n) => n + 1);
      setEntryRefresh((n) => n + 1);
    } catch (err) {
      setNotice({
        tone: 'danger',
        text: err instanceof ApiClientError ? err.message : 'Review failed.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const pendingCount = creatives.items.length + entries.items.length;

  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-cream-100">Review queue</h2>
        {pendingCount > 0 && (
          <span className="rounded-full bg-amber-400/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-300">
            {pendingCount} awaiting review
          </span>
        )}
      </div>

      {notice ? <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice> : null}

      {creatives.error ? (
        <ErrorState message={creatives.error} onRetry={() => void creatives.refetch()} />
      ) : creatives.loading ? (
        <Skeleton className="h-16 w-full" />
      ) : creatives.items.length === 0 && entries.items.length === 0 && !entries.loading ? (
        <EmptyState
          icon={<ClipboardCheck className="h-6 w-6" aria-hidden />}
          title="Nothing to review"
          description="Client uploads and data submissions appear here for approval."
        />
      ) : (
        <div className="space-y-3">
          {creatives.items.length > 0 && (
            <p className="text-xs font-medium uppercase tracking-wide text-cream-100/40">
              Creatives
            </p>
          )}
          {creatives.items.map((creative) => (
            <div
              key={creative.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-surface-border bg-navy-950/40 p-3"
            >
              <ImageIcon className="h-5 w-5 shrink-0 text-cream-100/40" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-cream-100">{creative.file_name}</p>
                <p className="text-xs text-cream-100/50">
                  {creative.file_type} · {formatBytes(creative.size_bytes)} ·{' '}
                  {creative.campaign_id} · uploaded by client
                </p>
              </div>
              <div className="flex gap-2">
                <a
                  href={API.creatives.download(creative.id)}
                  className="btn-ghost text-xs"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Inspect
                </a>
                <ReviewButtons
                  busy={busyId === creative.id}
                  onDecide={(decision) => void decide('creative', creative.id, decision)}
                />
              </div>
            </div>
          ))}

          {entries.loading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            entries.items.length > 0 && (
              <p className="pt-2 text-xs font-medium uppercase tracking-wide text-cream-100/40">
                Data entries
              </p>
            )
          )}
          {entries.items.map((entry) => (
            <div
              key={entry.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-surface-border bg-navy-950/40 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-cream-100">
                  {METRIC_LABELS[entry.metric_type] ?? entry.metric_type}:{' '}
                  <span className="font-semibold">
                    {entry.metric_type === 'sales_value'
                      ? formatCurrency(entry.value)
                      : formatNumber(entry.value)}
                  </span>
                </p>
                <p className="truncate text-xs text-cream-100/50">
                  {formatDate(entry.date)} · {entry.campaign_id} · submitted by client
                  {entry.notes ? ` · "${entry.notes}"` : ''}
                </p>
              </div>
              <ReviewButtons
                busy={busyId === entry.id}
                onDecide={(decision) => void decide('entry', entry.id, decision)}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ReviewButtons({
  busy,
  onDecide,
}: {
  busy: boolean;
  onDecide: (decision: 'approved' | 'rejected') => void;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        className="btn-secondary text-xs"
        disabled={busy}
        onClick={() => onDecide('approved')}
      >
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        Approve
      </button>
      <button
        type="button"
        className="btn-ghost text-xs text-red-300"
        disabled={busy}
        onClick={() => onDecide('rejected')}
      >
        <XCircle className="h-3.5 w-3.5" aria-hidden />
        Reject
      </button>
    </div>
  );
}
