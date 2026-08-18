import { ApiError, created, list, parseJson, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, requireCaller, requireOwner, requirePermission } from '@/lib/api-auth';
import { createAccount, isLinkIdTaken, listClients, toPublicClient } from '@/lib/firestore';
import { encryptToken, hashPin } from '@/lib/auth';
import { paginate, slugify } from '@/lib/utils';
import { createAccountSchema, validate } from '@/lib/validation';
import type { Client } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/clients
 * Owner sees every client; a client session sees only itself.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const caller = await requireCaller(request);
  enforceRateLimit(request, caller);

  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page') ?? 1);
  const perPage = Number(url.searchParams.get('per_page') ?? 50);

  const all = await listClients();
  const scoped =
    caller.role === 'owner' ? all : all.filter((client) => client.id === caller.client_id);

  const { items, pagination } = paginate(scoped.map(toPublicClient), page, perPage);
  return list(items, pagination);
});

/**
 * POST /api/clients — owner only.
 *
 * Creates a client account. The 6-digit PIN is hashed before storage and is
 * never returned again; the shareable link is returned so it can be handed to
 * the client straight away.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const caller = await requireOwner(request);
  requirePermission(caller, 'write');
  enforceRateLimit(request, caller, 30, 'clients-write');

  const input = validate(createAccountSchema, await parseJson(request));

  if (await isLinkIdTaken(input.link_id)) {
    throw new ApiError(
      'VALIDATION_ERROR',
      `The link "${input.link_id}" is already used by another client.`,
      { link_id: 'This link is already taken.' },
    );
  }

  // Derive the document id from the link so Firestore paths stay readable.
  const id = slugify(input.link_id) || input.link_id;

  const client: Client = {
    id,
    name: input.name,
    link_id: input.link_id,
    ad_account_id: input.ad_account_id ?? '',
    access_token_encrypted: input.meta_access_token
      ? encryptToken(input.meta_access_token)
      : '',
    access_pin_hash: hashPin(input.pin),
    primary_goal: input.primary_goal,
    created_at: new Date().toISOString(),
    is_owner: input.is_owner ?? false,
    settings: {
      notification_enabled: input.settings?.notification_enabled ?? true,
      auto_execute: input.settings?.auto_execute ?? false,
      notification_channel: 'telegram',
    },
  };

  await createAccount(client);

  return created({
    client: toPublicClient(client),
    // Convenience for the UI — the exact URL to send to the client.
    access_url: `/auth/client/${client.link_id}`,
  });
});
