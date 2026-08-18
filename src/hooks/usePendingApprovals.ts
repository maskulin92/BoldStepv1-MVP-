'use client';

import { useCallback, useState } from 'react';
import { API } from '@/constants/api-endpoints';
import { ApiClientError, apiPost } from '@/lib/api-client';
import { useFirestoreList } from './useFirestore';
import type { ApprovalDecision, MetaExecutionResult, PendingAction } from '@/types';

interface DecisionResponse {
  action: PendingAction;
  meta_result?: MetaExecutionResult;
}

/**
 * Pending approvals plus the decide() action. Keeps a per-action "deciding"
 * flag so only the row being acted on shows a spinner.
 */
export function usePendingApprovals(options: { accountId?: string; status?: string } = {}) {
  const { accountId, status = 'pending' } = options;

  const params = new URLSearchParams();
  if (accountId) params.set('client_id', accountId);
  params.set('status', status);

  const query = useFirestoreList<PendingAction>(`${API.approvals.list}?${params.toString()}`, [
    accountId,
    status,
  ]);

  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<DecisionResponse | null>(null);

  const decide = useCallback(
    async (
      actionId: string,
      decision: ApprovalDecision,
      extras: { note?: string; budget?: number } = {},
    ) => {
      setDecidingId(actionId);
      setDecisionError(null);
      try {
        const result = await apiPost<DecisionResponse>(API.approvals.decide(actionId), {
          decision,
          note: extras.note,
          ...(extras.budget ? { modified_params: { budget: extras.budget } } : {}),
        });
        setLastResult(result);
        await query.refetch();
        return result;
      } catch (error) {
        const message =
          error instanceof ApiClientError ? error.message : 'Could not record that decision.';
        setDecisionError(message);
        throw error;
      } finally {
        setDecidingId(null);
      }
    },
    [query],
  );

  return {
    actions: query.items,
    loading: query.loading,
    error: query.error,
    refetch: query.refetch,
    decide,
    decidingId,
    decisionError,
    lastResult,
    clearResult: () => setLastResult(null),
  };
}
