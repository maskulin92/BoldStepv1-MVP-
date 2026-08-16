import { created, ok, parseJson, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, requireOwner, requirePermission } from '@/lib/api-auth';
import { generateApiKey } from '@/lib/auth';
import { createApiKey, listApiKeys } from '@/lib/firestore';
import { generateKeySchema, validate } from '@/lib/validation';
import { randomUUID } from 'node:crypto';
import type { ApiKeyRecord } from '@/types';

export const dynamic = 'force-dynamic';

/** GET /api/integrations/auth/generate-key — list existing keys (never the secrets). */
export const GET = withErrorHandling(async (request: Request) => {
  const caller = await requireOwner(request);
  enforceRateLimit(request, caller);

  const keys = await listApiKeys(caller.id);
  return ok({
    keys: keys.map(({ key_hash: _hash, ...rest }) => rest),
  });
});

/**
 * POST /api/integrations/auth/generate-key  { name, expires_in_days?, permissions? }
 *
 * The plaintext key is returned exactly once — only its SHA-256 hash is stored,
 * so a leaked database does not leak working credentials.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const caller = await requireOwner(request);
  requirePermission(caller, 'write');
  enforceRateLimit(request, caller, 20, 'api-keys');

  const { name, expires_in_days = 365, permissions = ['read'] } = validate(
    generateKeySchema,
    await parseJson(request),
  );

  const { plaintext, hash, prefix } = generateApiKey();
  const now = new Date();

  const record: ApiKeyRecord = {
    id: `key-${randomUUID().slice(0, 8)}`,
    name,
    key_hash: hash,
    key_prefix: prefix,
    owner_id: caller.id,
    permissions,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + expires_in_days * 86400_000).toISOString(),
    status: 'active',
  };

  await createApiKey(record);

  return created({
    api_key: plaintext,
    key_id: record.id,
    name: record.name,
    permissions: record.permissions,
    created_at: record.created_at,
    expires_at: record.expires_at,
    status: record.status,
    warning: 'Store this key now — it is not retrievable after this response.',
  });
});
