import { created, list, parseJson, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, requireOwner, requirePermission } from '@/lib/api-auth';
import { createPendingAction, getClient, getCampaign, listPendingActions } from '@/lib/firestore';
import { notifyPendingAction } from '@/lib/telegram';
import { paginate } from '@/lib/utils';
import { dispatchWebhook } from '@/lib/webhooks';
import { ApiError } from '@/lib/api-response';
import { randomUUID } from 'node:crypto';
import type { PendingAction } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/approvals?status=pending&client_id=
 * Owner only. Defaults to pending, newest first.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const caller = await requireOwner(request);
  enforceRateLimit(request, caller);

  const url = new URL(request.url);
  const status = url.searchParams.get('status') ?? 'pending';
  const accountId = url.searchParams.get('client_id') ?? undefined;
  const page = Number(url.searchParams.get('page') ?? 1);
  const perPage = Number(url.searchParams.get('per_page') ?? 50);

  const actions = await listPendingActions({
    accountId,
    status: status === 'all' ? undefined : status,
  });

  const { items, pagination } = paginate(actions, page, perPage);
  return list(items, pagination);
});

/**
 * POST /api/approvals
 * How Hermes files a suggestion. Creates the action, then fires the Telegram
 * notification that carries the approval link (step 2 of the workflow).
 */
export const POST = withErrorHandling(async (request: Request) => {
  const caller = await requireOwner(request);
  requirePermission(caller, 'write');
  enforceRateLimit(request, caller);

  const body = await parseJson(request);
  const accountId = String(body.client_id ?? '');
  const campaignId = String(body.campaign_id ?? '');

  const client = await getClient(accountId);
  if (!client) throw new ApiError('INVALID_CLIENT_ID', `No client with id "${accountId}".`);

  const campaign = await getCampaign(accountId, campaignId);
  if (!campaign) {
    throw new ApiError('INVALID_CAMPAIGN_ID', `No campaign "${campaignId}" for this client.`);
  }

  const actionType = String(body.action_type ?? 'analysis');
  if (!['pause', 'resume', 'budget_change', 'analysis', 'rotate', 'optimize'].includes(actionType)) {
    throw new ApiError(
      'VALIDATION_ERROR',
      'action_type must be pause, resume, budget_change, analysis, rotate or optimize.',
    );
  }

  // Dedupe: if a PENDING action for this campaign + type already exists (a
  // retry, a double-click, or the agent re-running a cycle), return it instead
  // of piling another identical copy on top. Idempotency lives here so every
  // caller (Run Now, the scheduled agent, integrations) is covered.
  const existing = await listPendingActions({ accountId, status: 'pending' });
  const duplicate = existing.find(
    (a) => a.campaign_id === campaignId && a.action_type === actionType,
  );
  if (duplicate) {
    return created({
      action: duplicate,
      duplicate: true,
      notification: { sent: false, mode: 'mock' as const },
    });
  }

  const action: PendingAction = {
    id: `act-${randomUUID().slice(0, 8)}`,
    client_id: accountId,
    client_name: client.name,
    from_model: body.from_model === 'claude' ? 'claude' : 'glm',
    action_type: actionType as PendingAction['action_type'],
    campaign_id: campaignId,
    campaign_name: campaign.name,
    adset_id: body.adset_id ? String(body.adset_id) : undefined,
    suggestion_text: String(body.suggestion_text ?? '').slice(0, 500) || 'Untitled suggestion',
    reason: String(body.reason ?? '').slice(0, 2000),
    metadata: (body.metadata as PendingAction['metadata']) ?? {},
    confidence:
      typeof body.confidence === 'number'
        ? Math.max(0, Math.min(100, Math.round(body.confidence)))
        : undefined,
    status: 'pending',
    fadhil_decision: '',
    created_at: new Date().toISOString(),
  };

  await createPendingAction(action);

  const notification = client.settings.notification_enabled
    ? await notifyPendingAction(action)
    : { sent: false, mode: 'mock' as const, message: 'notifications disabled for this client' };

  void dispatchWebhook('action.created', action);

  return created({ action, notification: { sent: notification.sent, mode: notification.mode } });
});
