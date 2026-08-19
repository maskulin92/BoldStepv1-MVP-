import { ApiError, ok, parseJson, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, requireOwner, requirePermission } from '@/lib/api-auth';
import { getClient, listCampaigns, listInsights, listPendingActions } from '@/lib/firestore';
import { buildAnalysisContext } from '@/lib/glm-client';
import { runAnalysis } from '@/lib/hermes-analysis';
import { defaultDateRange } from '@/lib/utils';
import { notifyPendingAction } from '@/lib/telegram';
import { createPendingAction } from '@/lib/firestore';
import { randomUUID } from 'node:crypto';
import type { PendingAction } from '@/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/hermes/run  { client_id }
 *
 * "Run Now" — immediate analysis for one client, bypassing the schedule.
 * Syncs the client, builds context, asks the model (or heuristic), and files
 * suggestions through the same POST /api/approvals path the scheduled agent
 * uses. Draft-only: never auto-executes.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const caller = await requireOwner(request);
  requirePermission(caller, 'write');
  enforceRateLimit(request, caller, 6, 'hermes-run');

  const { client_id } = await parseJson(request);
  if (!client_id || typeof client_id !== 'string') {
    throw new ApiError('VALIDATION_ERROR', 'client_id is required.');
  }

  const client = await getClient(client_id);
  if (!client) throw new ApiError('INVALID_CLIENT_ID', `No client with id "${client_id}".`);

  const range = defaultDateRange(14);
  const [campaigns, insights, existingActions] = await Promise.all([
    listCampaigns(client_id),
    listInsights(client_id, range.start, range.end),
    listPendingActions({ accountId: client_id }),
  ]);

  // Dedupe key: a pending action for the same campaign + type already exists —
  // re-running "Run Now" must not pile another identical copy on top.
  const alreadyPending = new Set(
    existingActions
      .filter((a) => a.status === 'pending')
      .map((a) => `${a.campaign_id}|${a.action_type}`),
  );

  // The model is only given campaign names (not ids) in the context, so it may
  // return a name instead of an id. Resolve both forms to a real campaign id.
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));
  const campaignByName = new Map(campaigns.map((c) => [c.name, c]));
  const resolveCampaign = (raw: string) =>
    campaignById.get(raw) ?? campaignByName.get(raw) ?? null;

  const context = buildAnalysisContext({ clientName: client.name, campaigns, insights });

  const filed: PendingAction[] = [];
  let notificationsSent = 0;

  const result = await runAnalysis({
    clientName: client.name,
    context,
    onFile: async (suggestion) => {
      const campaign = resolveCampaign(suggestion.campaign_id);
      if (!campaign) return; // unknown campaign — skip, don't 500

      const dedupeKey = `${campaign.id}|${suggestion.action_type}`;
      if (alreadyPending.has(dedupeKey)) return; // already suggested, skip

      const action: PendingAction = {
        id: `act-${randomUUID().slice(0, 8)}`,
        client_id,
        client_name: client.name,
        from_model: 'glm',
        action_type: suggestion.action_type,
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        suggestion_text: suggestion.suggestion_text,
        reason: suggestion.reason,
        confidence: suggestion.confidence,
        metadata: {
          current_cpl: suggestion.current_cpl,
          performance_change: suggestion.performance_change,
        },
        status: 'pending',
        fadhil_decision: '',
        created_at: new Date().toISOString(),
      };

      await createPendingAction(action);
      alreadyPending.add(dedupeKey); // within this run, avoid re-filing the same suggestion
      if (client.settings.notification_enabled) {
        await notifyPendingAction(action);
        notificationsSent += 1;
      }
      filed.push(action);
    },
  });

  return ok({
    run_at: new Date().toISOString(),
    model: result.model,
    filed_count: filed.length,
    notifications_sent: notificationsSent,
    actions: filed.map((a) => ({ id: a.id, action_type: a.action_type, confidence: a.confidence })),
  });
});
