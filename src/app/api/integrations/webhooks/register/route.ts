import { created, parseJson, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, requireApiKey, requirePermission } from '@/lib/api-auth';
import { createWebhook } from '@/lib/firestore';
import { WEBHOOK_DISPATCH_ENABLED } from '@/lib/webhooks';
import { registerWebhookSchema, validate } from '@/lib/validation';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Webhook } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/integrations/webhooks/register  { event, webhook_url, active? }
 * Auth: API key with `write`.
 *
 * Registration is live in Phase 1; outbound delivery switches on in Phase 2.
 * The response says which, so an integrator is never left guessing.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const caller = await requireApiKey(request);
  requirePermission(caller, 'write');
  enforceRateLimit(request, caller);

  const { event, webhook_url, active = true } = validate(
    registerWebhookSchema,
    await parseJson(request),
  );

  const secret = randomBytes(24).toString('hex');
  const webhook: Webhook = {
    id: `wh-${randomUUID().slice(0, 8)}`,
    event,
    webhook_url,
    active,
    owner_id: caller.id,
    secret,
    created_at: new Date().toISOString(),
    failure_count: 0,
  };

  await createWebhook(webhook);

  return created({
    webhook_id: webhook.id,
    event: webhook.event,
    webhook_url: webhook.webhook_url,
    active: webhook.active,
    created_at: webhook.created_at,
    // Needed to verify the X-Boldstep-Signature header. Shown once.
    signing_secret: secret,
    dispatch_enabled: WEBHOOK_DISPATCH_ENABLED,
    note: WEBHOOK_DISPATCH_ENABLED
      ? undefined
      : 'Registered. Events are recorded but not yet delivered — outbound dispatch lands in Phase 2.',
  });
});
