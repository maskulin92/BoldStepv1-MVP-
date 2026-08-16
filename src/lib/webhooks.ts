import 'server-only';
import { createHmac } from 'node:crypto';
import { listWebhooks, updateWebhook } from './firestore';
import type { Webhook, WebhookEvent } from '@/types';

/**
 * Webhook delivery.
 *
 * Phase 1 registered endpoints and recorded what *would* be dispatched. Phase 2
 * turns on real outbound delivery: HMAC-signed POSTs with exponential-backoff
 * retries and per-hook failure tracking. A hook that keeps failing is disabled
 * after MAX_FAILURES consecutive errors so a dead endpoint cannot stall the
 * pipeline — re-register (or set active=true) to re-enable it.
 *
 * WEBHOOK_DISPATCH_ENABLED controls delivery:
 *   - `true`                -> deliver (with retries)
 *   - anything else / unset -> record only, as in Phase 1
 */

const RETRY_DELAYS_MS = [1_000, 5_000, 30_000];
const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_FAILURES = 10;

export const WEBHOOK_DISPATCH_ENABLED =
  process.env.WEBHOOK_DISPATCH_ENABLED === 'true';

export interface WebhookEnvelope<T> {
  event: WebhookEvent;
  delivered_at: string;
  data: T;
}

/** HMAC-SHA256 over the raw body, sent as `X-Boldstep-Signature: sha256=…`. */
export function signWebhookPayload(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export interface DeliveryResult {
  webhook_id: string;
  ok: boolean;
  attempts: number;
  status?: number;
  error?: string;
}

export async function dispatchWebhook<T>(event: WebhookEvent, data: T): Promise<DeliveryResult[]> {
  try {
    const hooks = (await listWebhooks('owner_fadhil')).filter(
      (hook) => hook.active && hook.event === event,
    );
    if (hooks.length === 0) return [];

    if (!WEBHOOK_DISPATCH_ENABLED) {
      console.info(
        `[boldstep:webhook:QUEUED] ${event} -> ${hooks.length} endpoint(s). Set WEBHOOK_DISPATCH_ENABLED=true to deliver.`,
      );
      return hooks.map((hook) => ({
        webhook_id: hook.id,
        ok: false,
        attempts: 0,
        error: 'dispatch disabled',
      }));
    }

    const envelope: WebhookEnvelope<T> = {
      event,
      delivered_at: new Date().toISOString(),
      data,
    };
    const body = JSON.stringify(envelope);

    return await Promise.all(hooks.map((hook) => deliverWithRetry(hook, event, body)));
  } catch (error) {
    // A webhook problem must never fail the request that produced the event.
    console.error('[boldstep:webhook] dispatch error:', error);
    return [];
  }
}

async function deliverWithRetry(
  hook: Webhook,
  event: WebhookEvent,
  body: string,
): Promise<DeliveryResult> {
  const result = await deliver(hook, event, body);

  if (result.ok) {
    if (hook.failure_count > 0 || hook.last_triggered_at) {
      void updateWebhook(hook.id, { failure_count: 0, last_triggered_at: new Date().toISOString() }).catch(
        () => undefined,
      );
    }
    return result;
  }

  let final = result;
  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    await sleep(RETRY_DELAYS_MS[attempt - 1]);
    final = await deliver(hook, event, body);
    if (final.ok) break;
  }

  const failures = hook.failure_count + final.attempts;
  const disabled = failures >= MAX_FAILURES;
  void updateWebhook(hook.id, {
    failure_count: failures,
    last_triggered_at: new Date().toISOString(),
    ...(disabled ? { active: false } : {}),
  }).catch(() => undefined);

  if (disabled) {
    console.warn(
      `[boldstep:webhook] ${hook.id} disabled after ${failures} consecutive failures.`,
    );
  }

  return final;
}

async function deliver(
  hook: Webhook,
  event: WebhookEvent,
  body: string,
): Promise<DeliveryResult> {
  try {
    const response = await fetch(hook.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Boldstep-Event': event,
        'X-Boldstep-Signature': signWebhookPayload(hook.secret, body),
      },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    const ok = response.ok;
    if (!ok) {
      console.warn(
        `[boldstep:webhook] ${hook.id} -> ${hook.webhook_url} responded ${response.status}`,
      );
    }
    return { webhook_id: hook.id, ok, attempts: 1, status: response.status };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    console.warn(`[boldstep:webhook] ${hook.id} delivery failed: ${detail}`);
    return { webhook_id: hook.id, ok: false, attempts: 1, error: detail };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
