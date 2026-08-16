import { ApiError, ok, parseJson, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, requireOwner, requirePermission } from '@/lib/api-auth';
import {
  appendApprovalLog,
  getClient,
  getPendingAction,
  updateCampaign,
  updatePendingAction,
} from '@/lib/firestore';
import { executeAction, resolveMetaContext } from '@/lib/meta-api';
import { notifyExecution } from '@/lib/telegram';
import { dispatchWebhook } from '@/lib/webhooks';
import { approvalDecisionSchema, validate } from '@/lib/validation';
import { randomUUID } from 'node:crypto';
import type { PendingAction } from '@/types';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ actionId: string }> };

/** GET /api/approvals/[actionId] */
export const GET = withErrorHandling(async (request: Request, context: Context) => {
  const { actionId } = await context.params;
  const caller = await requireOwner(request);
  enforceRateLimit(request, caller);

  const action = await getPendingAction(actionId);
  if (!action) throw new ApiError('ACTION_NOT_FOUND', `No action with id "${actionId}".`);
  return ok({ action });
});

/**
 * POST /api/approvals/[actionId]
 * Body: { decision: "approved" | "rejected" | "modified", note?, modified_params? }
 *
 * Approving (or modifying) executes against Meta immediately, records the
 * outcome on the action, appends to Hermes' approval log so the memory viewer
 * reflects it, and notifies Telegram.
 */
export const POST = withErrorHandling(async (request: Request, context: Context) => {
  const { actionId } = await context.params;
  const caller = await requireOwner(request);
  requirePermission(caller, 'execute');
  enforceRateLimit(request, caller);

  const { decision, note, modified_params } = validate(
    approvalDecisionSchema,
    await parseJson(request),
  );

  const action = await getPendingAction(actionId);
  if (!action) throw new ApiError('ACTION_NOT_FOUND', `No action with id "${actionId}".`);
  if (action.status !== 'pending') {
    throw new ApiError(
      'ACTION_ALREADY_RESOLVED',
      `This action was already ${action.status}. Actions can only be decided once.`,
      { current_status: action.status },
    );
  }

  const decidedAt = new Date().toISOString();
  const decisionNote = note?.trim() ?? '';

  /* --- rejected: no Meta call, just record it ------------------------- */
  if (decision === 'rejected') {
    const updated = await updatePendingAction(actionId, {
      status: 'rejected',
      fadhil_decision: decisionNote || 'Rejected.',
      executed_at: decidedAt,
    });

    await appendApprovalLog({
      id: `log-${randomUUID().slice(0, 8)}`,
      decision: 'rejected',
      campaign: action.campaign_name,
      reason: action.suggestion_text,
      outcome: decisionNote || 'Rejected by owner — no change applied.',
      timestamp: decidedAt,
    });

    void dispatchWebhook('action.approved', updated);
    return ok({ action: updated });
  }

  /* --- approved / modified: execute ----------------------------------- */
  const client = await getClient(action.client_id);
  const metaContext = resolveMetaContext(client);

  const overrides: Record<string, number> = {};
  if (decision === 'modified' && modified_params?.budget) {
    overrides.budget = modified_params.budget;
  }

  const result = await executeAction(action, metaContext, overrides);

  const patch: Partial<PendingAction> = {
    status: result.ok ? 'executed' : 'failed',
    fadhil_decision:
      decisionNote ||
      (decision === 'modified'
        ? `Modified and approved${overrides.budget ? ` (budget RM${overrides.budget})` : ''}.`
        : 'Approved.'),
    executed_at: result.executed_at,
    meta_result: result,
    ...(decision === 'modified' && overrides.budget
      ? { metadata: { ...action.metadata, proposed_budget: overrides.budget } }
      : {}),
  };

  const updated = await updatePendingAction(actionId, patch);

  // Keep the locally stored campaign in step with what we just told Meta.
  if (result.ok && !action.adset_id) {
    if (action.action_type === 'pause') {
      await updateCampaign(action.client_id, action.campaign_id, { status: 'PAUSED' });
    } else if (action.action_type === 'resume') {
      await updateCampaign(action.client_id, action.campaign_id, { status: 'ACTIVE' });
    } else if (action.action_type === 'budget_change') {
      const budget = Number(overrides.budget ?? action.metadata.proposed_budget ?? 0);
      if (budget > 0) {
        await updateCampaign(action.client_id, action.campaign_id, { budget_daily: budget });
      }
    }
  }

  await appendApprovalLog({
    id: `log-${randomUUID().slice(0, 8)}`,
    decision: decision === 'modified' ? 'modified' : 'approved',
    campaign: action.campaign_name,
    reason: action.suggestion_text,
    outcome: result.message,
    timestamp: decidedAt,
  });

  if (client?.settings.notification_enabled) {
    void notifyExecution(action, result.ok, result.message);
  }
  void dispatchWebhook('action.executed', updated);

  return ok({ action: updated, meta_result: result });
});
