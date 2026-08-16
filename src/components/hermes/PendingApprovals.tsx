'use client';

import { useState } from 'react';
import { CheckCircle2, Clock, PauseCircle, PlayCircle, Sliders, Sparkles, XCircle } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { EmptyState, ErrorState, InlineNotice } from '@/components/common/States';
import { LoadingSpinner, Skeleton } from '@/components/common/LoadingSpinner';
import { usePendingApprovals } from '@/hooks/usePendingApprovals';
import { STATUS_STYLES } from '@/constants/theme';
import { cn, formatCurrency, relativeTime } from '@/lib/utils';
import type { ActionType, ApprovalDecision, PendingAction } from '@/types';

const ACTION_ICONS: Record<ActionType, React.ReactNode> = {
  pause: <PauseCircle className="h-4 w-4" aria-hidden />,
  resume: <PlayCircle className="h-4 w-4" aria-hidden />,
  budget_change: <Sliders className="h-4 w-4" aria-hidden />,
  analysis: <Sparkles className="h-4 w-4" aria-hidden />,
};

/**
 * The approval queue. Approve and Modify both execute against Meta; every
 * decision is confirmed in a dialog first, since it changes a live ad account.
 */
export default function PendingApprovals({
  clientId,
  status = 'pending',
  title = 'Pending approvals',
  highlightActionId,
}: {
  clientId?: string;
  status?: string;
  title?: string;
  /** Action id from a Telegram deep link — opens its dialog immediately. */
  highlightActionId?: string | null;
}) {
  const { actions, loading, error, refetch, decide, decidingId, decisionError } =
    usePendingApprovals({ clientId, status });

  const [pendingDecision, setPendingDecision] = useState<{
    action: PendingAction;
    decision: ApprovalDecision;
  } | null>(null);
  const [note, setNote] = useState('');
  const [budget, setBudget] = useState('');
  const [banner, setBanner] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const open = (action: PendingAction, decision: ApprovalDecision) => {
    setPendingDecision({ action, decision });
    setNote('');
    setBudget(String(action.metadata.proposed_budget ?? action.metadata.current_budget ?? ''));
  };

  const confirm = async () => {
    if (!pendingDecision) return;
    const { action, decision } = pendingDecision;
    try {
      const result = await decide(action.id, decision, {
        note: note.trim() || undefined,
        budget: decision === 'modified' && budget ? Number(budget) : undefined,
      });
      setBanner({
        tone: result.action.status === 'failed' ? 'danger' : 'success',
        text:
          result.meta_result?.message ??
          (decision === 'rejected' ? 'Suggestion rejected.' : 'Decision recorded.'),
      });
      setPendingDecision(null);
    } catch {
      // decisionError already carries the message for the dialog.
    }
  };

  if (error) return <ErrorState message={error} onRetry={refetch} />;

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, index) => (
          <Skeleton key={index} className="h-36 w-full" />
        ))}
      </div>
    );
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-cream-100">
          {title}
          {actions.length > 0 ? (
            <span className="ml-2 rounded-full bg-accent-warning/20 px-2 py-0.5 text-xs text-accent-warning">
              {actions.length}
            </span>
          ) : null}
        </h2>
      </div>

      {banner ? (
        <InlineNotice tone={banner.tone} className="mb-3">
          {banner.text}
        </InlineNotice>
      ) : null}

      {actions.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-6 w-6" aria-hidden />}
          title="Nothing waiting on you"
          description="When Hermes finds something worth changing, it lands here and pings Telegram."
        />
      ) : (
        <ul className="space-y-3">
          {actions.map((action) => (
            <li
              key={action.id}
              className={cn(
                'card p-4',
                highlightActionId === action.id && 'ring-2 ring-accent-warning/50',
              )}
            >
              <div className="flex flex-wrap items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cream-100/10 text-cream-100/70">
                  {ACTION_ICONS[action.action_type]}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-cream-100">{action.suggestion_text}</p>
                  <p className="mt-0.5 text-xs text-cream-100/45">
                    {action.client_name} · {action.campaign_name} · {relativeTime(action.created_at)}
                    {' · '}
                    {action.from_model === 'glm-5-3' ? 'GLM 5.3' : 'Claude'}
                  </p>
                </div>

                <span className={cn('badge shrink-0', STATUS_STYLES[action.status])}>
                  {action.status}
                </span>
              </div>

              <p className="mt-3 text-sm leading-relaxed text-cream-100/70">{action.reason}</p>

              {(action.metadata.current_cpl !== undefined ||
                action.metadata.proposed_budget !== undefined) && (
                <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-xs">
                  {action.metadata.current_cpl !== undefined ? (
                    <div className="flex gap-1.5">
                      <dt className="text-cream-100/45">Current CPL</dt>
                      <dd className="font-medium text-cream-100">
                        {formatCurrency(Number(action.metadata.current_cpl))}
                      </dd>
                    </div>
                  ) : null}
                  {action.metadata.target_cpl !== undefined ? (
                    <div className="flex gap-1.5">
                      <dt className="text-cream-100/45">Target</dt>
                      <dd className="font-medium text-cream-100">
                        {formatCurrency(Number(action.metadata.target_cpl))}
                      </dd>
                    </div>
                  ) : null}
                  {action.metadata.proposed_budget !== undefined ? (
                    <div className="flex gap-1.5">
                      <dt className="text-cream-100/45">Proposed budget</dt>
                      <dd className="font-medium text-cream-100">
                        {formatCurrency(Number(action.metadata.proposed_budget))}/day
                      </dd>
                    </div>
                  ) : null}
                </dl>
              )}

              {action.status === 'pending' ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-success"
                    onClick={() => open(action, 'approved')}
                    disabled={decidingId === action.id}
                  >
                    {decidingId === action.id ? (
                      <LoadingSpinner size="sm" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" aria-hidden />
                    )}
                    Approve
                  </button>

                  {action.action_type === 'budget_change' ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => open(action, 'modified')}
                      disabled={decidingId === action.id}
                    >
                      <Sliders className="h-4 w-4" aria-hidden />
                      Modify
                    </button>
                  ) : null}

                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => open(action, 'rejected')}
                    disabled={decidingId === action.id}
                  >
                    <XCircle className="h-4 w-4" aria-hidden />
                    Reject
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-surface-border bg-navy-950/40 px-3 py-2 text-xs text-cream-100/60">
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    {action.fadhil_decision || 'Resolved.'}
                    {action.meta_result ? ` — ${action.meta_result.message}` : ''}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={pendingDecision !== null}
        onClose={() => setPendingDecision(null)}
        title={
          pendingDecision?.decision === 'rejected'
            ? 'Reject this suggestion?'
            : pendingDecision?.decision === 'modified'
              ? 'Modify and approve'
              : 'Approve and execute?'
        }
        description={pendingDecision?.action.suggestion_text}
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPendingDecision(null)}
              disabled={decidingId !== null}
            >
              Cancel
            </button>
            <button
              type="button"
              className={pendingDecision?.decision === 'rejected' ? 'btn-danger' : 'btn-primary'}
              onClick={() => void confirm()}
              disabled={decidingId !== null}
            >
              {decidingId !== null ? <LoadingSpinner size="sm" /> : null}
              {pendingDecision?.decision === 'rejected' ? 'Reject' : 'Confirm and execute'}
            </button>
          </>
        }
      >
        {pendingDecision?.decision !== 'rejected' ? (
          <InlineNotice tone="warning" className="mb-4">
            This applies the change to the live Meta ad account.
          </InlineNotice>
        ) : null}

        {pendingDecision?.decision === 'modified' ? (
          <div className="mb-4">
            <label className="label" htmlFor="budget">
              New daily budget (RM)
            </label>
            <input
              id="budget"
              type="number"
              min="1"
              step="1"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              className="w-full"
            />
          </div>
        ) : null}

        <div>
          <label className="label" htmlFor="note">
            Note (optional)
          </label>
          <textarea
            id="note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Why you made this call — it feeds Hermes' memory."
            className="w-full resize-none"
          />
        </div>

        {decisionError ? (
          <InlineNotice tone="danger" className="mt-4">
            {decisionError}
          </InlineNotice>
        ) : null}
      </Modal>
    </section>
  );
}
