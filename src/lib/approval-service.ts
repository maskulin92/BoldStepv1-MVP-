import 'server-only';
import { findOrCreatePendingAction } from './firestore';
import { notifyPendingAction, type NotifyResult } from './telegram';
import { dispatchWebhook } from './webhooks';
import type { Client, PendingAction } from '@/types';

/**
 * Shared approval-filing service — the single code path that both
 * POST /api/approvals and POST /api/hermes/run ("Run Now") call.
 *
 * Before this existed, the two routes each had their own dedupe + create +
 * notify logic, which drifted apart over time (Run Now never fired webhooks,
 * each had a different dedupe implementation). Now there is one path:
 *
 *   1. findOrCreatePendingAction — atomic dedupe via Firestore transaction
 *      (closes the race condition that created 600+ duplicates).
 *   2. notifyPendingAction — Telegram, only on a genuine create.
 *   3. dispatchWebhook — action.created, only on a genuine create.
 *
 * Returns the action (existing or new), a `created` flag, and the
 * notification result so callers can include it in their response.
 */
export async function filePendingAction(
  action: PendingAction,
  client: Client,
): Promise<{ action: PendingAction; created: boolean; notification: NotifyResult }> {
  const { action: resolved, created } = await findOrCreatePendingAction(action);

  if (!created) {
    return {
      action: resolved,
      created: false,
      notification: { sent: false, mode: 'mock' as const, message: 'duplicate — no notification sent' },
    };
  }

  const notification = client.settings.notification_enabled
    ? await notifyPendingAction(resolved)
    : { sent: false, mode: 'mock' as const, message: 'notifications disabled for this client' };

  void dispatchWebhook('action.created', resolved);

  return { action: resolved, created: true, notification };
}
