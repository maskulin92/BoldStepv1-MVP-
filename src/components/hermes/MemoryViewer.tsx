'use client';

import { Brain, CheckCircle2, PencilLine, XCircle } from 'lucide-react';
import { API } from '@/constants/api-endpoints';
import { useFirestore } from '@/hooks/useFirestore';
import { EmptyState, ErrorState } from '@/components/common/States';
import { LoadingPanel } from '@/components/common/LoadingSpinner';
import { formatDateTime, relativeTime } from '@/lib/utils';
import type { ApprovalDecision, HermesApprovalLog, HermesPattern } from '@/types';

interface MemoryResponse {
  patterns: HermesPattern[];
  approval_history: HermesApprovalLog[];
  counts: {
    patterns: number;
    decisions: number;
    approved: number;
    rejected: number;
    modified: number;
  };
}

const DECISION_ICONS: Record<ApprovalDecision, React.ReactNode> = {
  approved: <CheckCircle2 className="h-4 w-4 text-accent-success" aria-hidden />,
  rejected: <XCircle className="h-4 w-4 text-accent-danger" aria-hidden />,
  modified: <PencilLine className="h-4 w-4 text-accent-info" aria-hidden />,
};

export default function MemoryViewer() {
  const { data, loading, error, refetch } = useFirestore<MemoryResponse>(API.hermes.memory);

  if (loading) return <LoadingPanel label="Loading Hermes memory…" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const patterns = data?.patterns ?? [];
  const history = data?.approval_history ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Patterns learned', data?.counts.patterns ?? 0],
          ['Decisions logged', data?.counts.decisions ?? 0],
          ['Approved', data?.counts.approved ?? 0],
          ['Rejected', data?.counts.rejected ?? 0],
        ].map(([label, value]) => (
          <div key={String(label)} className="card p-4">
            <p className="text-xs uppercase tracking-wide text-cream-100/45">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-cream-100">{value}</p>
          </div>
        ))}
      </div>

      <section className="card p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold text-cream-100">Patterns identified</h2>

        {patterns.length === 0 ? (
          <EmptyState
            icon={<Brain className="h-6 w-6" aria-hidden />}
            title="No patterns yet"
            description="Hermes writes patterns here once it has enough history to generalise from."
          />
        ) : (
          <ul className="space-y-2">
            {patterns.map((pattern) => (
              <li
                key={pattern.pattern_id}
                className="rounded-lg border border-surface-border bg-navy-950/40 p-3.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="min-w-0 flex-1 text-sm text-cream-100/90">{pattern.description}</p>
                  <span className="badge border-accent-info/30 bg-accent-info/15 text-accent-info">
                    {Math.round(pattern.confidence * 100)}% confidence
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-cream-100/45">
                  <span>Seen {pattern.frequency}×</span>
                  <span>Last {relativeTime(pattern.last_seen)}</span>
                </div>

                {pattern.examples.length > 0 ? (
                  <p className="mt-2 text-xs text-cream-100/55">
                    Examples: {pattern.examples.join(' · ')}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold text-cream-100">Decision history</h2>

        {history.length === 0 ? (
          <EmptyState
            title="No decisions logged yet"
            description="Every approve, reject or modify is recorded here with its outcome."
          />
        ) : (
          <ol className="space-y-3">
            {history.map((entry) => (
              <li key={entry.id} className="flex gap-3">
                <span className="mt-0.5 shrink-0">{DECISION_ICONS[entry.decision]}</span>
                <div className="min-w-0 flex-1 border-b border-surface-border pb-3 last:border-0">
                  <p className="text-sm font-medium text-cream-100">{entry.campaign}</p>
                  <p className="mt-0.5 text-sm text-cream-100/65">{entry.reason}</p>
                  <p className="mt-1 text-sm text-cream-100/50">{entry.outcome}</p>
                  <p className="mt-1 text-xs text-cream-100/35">
                    {formatDateTime(entry.timestamp)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
