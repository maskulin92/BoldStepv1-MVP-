import { ApiError, ok, parseJson, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, requireOwner, requirePermission } from '@/lib/api-auth';
import {
  appendApprovalLog,
  getClient,
  getHermesSettings,
  getPendingAction,
  updatePendingAction,
} from '@/lib/firestore';
import { executeAction, resolveMetaContext } from '@/lib/meta-api';
import { notifyExecution } from '@/lib/telegram';
import { dispatchWebhook } from '@/lib/webhooks';
import { randomUUID } from 'node:crypto';

export const dynamic = 'force-dynamic';

/**
 * POST /api/hermes/execute  { action_id }
 *
 * The auto-execute path: Hermes calls this with its API key to apply an action
 * WITHOUT a human decision. It is refused unless `auto_execute` is switched on
 * in Hermes settings — which defaults to off for the MVP, per the brief.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const caller = await requireOwner(request);
  requirePermission(caller, 'execute');
  enforceRateLimit(request, caller, 30, 'hermes-execute');

  const settings = await getHermesSettings();
  if (!settings.auto_execute) {
    throw new ApiError(
      'FORBIDDEN',
      'Auto-execute is disabled. Approve this action from the dashboard, or enable auto_execute in Hermes settings.',
    );
  }

  const body = await parseJson(request);
  const actionId = String(body.action_id ?? '');
  const action = await getPendingAction(actionId);
  if (!action) throw new ApiError('ACTION_NOT_FOUND', `No action with id "${actionId}".`);
  if (action.status !== 'pending') {
    throw new ApiError('ACTION_ALREADY_RESOLVED', `This action was already ${action.status}.`);
  }

  const client = await getClient(action.client_id);
  const result = await executeAction(action, resolveMetaContext(client));

  const updated = await updatePendingAction(actionId, {
    status: result.ok ? 'executed' : 'failed',
    fadhil_decision: 'Auto-executed by Hermes (auto_execute enabled).',
    executed_at: result.executed_at,
    meta_result: result,
  });

  await appendApprovalLog({
    id: `log-${randomUUID().slice(0, 8)}`,
    decision: 'approved',
    campaign: action.campaign_name,
    reason: action.suggestion_text,
    outcome: `Auto-executed: ${result.message}`,
    timestamp: result.executed_at,
  });

  if (client?.settings.notification_enabled) {
    void notifyExecution(action, result.ok, `Auto-executed. ${result.message}`);
  }
  void dispatchWebhook('action.executed', updated);

  return ok({ action: updated, meta_result: result });
});
