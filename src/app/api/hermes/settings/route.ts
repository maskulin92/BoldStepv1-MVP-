import { ok, parseJson, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, requireOwner, requirePermission } from '@/lib/api-auth';
import { getHermesSettings, updateHermesSettings } from '@/lib/firestore';
import { hermesSettingsSchema, validate } from '@/lib/validation';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** GET /api/hermes/settings */
export const GET = withErrorHandling(async (request: Request) => {
  const caller = await requireOwner(request);
  enforceRateLimit(request, caller);

  const settings = await getHermesSettings();
  return ok({
    ...settings,
    agent_connected: Boolean(env.hermes.apiKey),
    notifications_configured: env.telegram.isConfigured,
  });
});

/** PUT /api/hermes/settings */
export const PUT = withErrorHandling(async (request: Request) => {
  const caller = await requireOwner(request);
  requirePermission(caller, 'write');
  enforceRateLimit(request, caller);

  const patch = validate(hermesSettingsSchema, await parseJson(request));
  const updated = await updateHermesSettings(patch);
  return ok({ updated_settings: updated });
});
