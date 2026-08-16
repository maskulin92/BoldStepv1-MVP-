import 'server-only';
import { createHmac } from 'node:crypto';
import { listWebhooks } from './firestore';
import type { WebhookEvent } from '@/types';

/**
 * Webhook foundation.
 *
 * Phase 1 registers endpoints and records what *would* be dispatched; it does
 * not fire outbound HTTP. Turning delivery on in Phase 2 is a matter of
 * flipping WEBHOOK_DISPATCH_ENABLED — the signature scheme, payload shape and
 * registration API are already fixed here so integrators can build against them.
 */

export const WEBHOOK_DISPATCH_ENABLED = false;

export interface WebhookEnvelope<T> {
  event: WebhookEvent;
  delivered_at: string;
  data: T;
}

/** HMAC-SHA256 over the raw body, sent as `X-Boldstep-Signature: sha256=…`. */
export function signWebhookPayload(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export async function dispatchWebhook<T>(event: WebhookEvent, data: T): Promise<void> {
  try {
    const hooks = (await listWebhooks('owner_fadhil')).filter(
      (hook) => hook.active && hook.event === event,
    );
    if (hooks.length === 0) return;

    const envelope: WebhookEnvelope<T> = {
      event,
      delivered_at: new Date().toISOString(),
      data,
    };

    if (!WEBHOOK_DISPATCH_ENABLED) {
      console.info(
        `[boldstep:webhook:QUEUED] ${event} -> ${hooks.length} endpoint(s). Delivery lands in Phase 2.`,
      );
      return;
    }

    const body = JSON.stringify(envelope);
    await Promise.allSettled(
      hooks.map((hook) =>
        fetch(hook.webhook_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Boldstep-Event': event,
            'X-Boldstep-Signature': signWebhookPayload(hook.secret, body),
          },
          body,
          cache: 'no-store',
        }),
      ),
    );
  } catch (error) {
    // A webhook problem must never fail the request that produced the event.
    console.error('[boldstep:webhook] dispatch error:', error);
  }
}
