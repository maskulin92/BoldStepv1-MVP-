import { ApiError, ok, parseJson, withErrorHandling } from '@/lib/api-response';
import {
  assertClientAccess,
  enforceRateLimit,
  requireCaller,
  requireOwner,
  requirePermission,
} from '@/lib/api-auth';
import {
  deleteAccount,
  getClient,
  isLinkIdTaken,
  listCampaigns,
  listInsights,
  listPendingActions,
  toPublicClient,
  updateClient,
} from '@/lib/firestore';
import { encryptToken, hashPin } from '@/lib/auth';
import { defaultDateRange, sumInsights } from '@/lib/utils';
import { updateClientSchema, validate } from '@/lib/validation';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ accountId: string }> };

/** GET /api/clients/[accountId] — client record + recent campaigns + settings. */
export const GET = withErrorHandling(async (request: Request, context: Context) => {
  const { accountId } = await context.params;
  const caller = await requireCaller(request);
  enforceRateLimit(request, caller);
  assertClientAccess(caller, accountId);

  const client = await getClient(accountId);
  if (!client) throw new ApiError('INVALID_CLIENT_ID', `No client with id "${accountId}".`);

  const range = defaultDateRange(7);
  const [campaigns, insights, pendingActions] = await Promise.all([
    listCampaigns(accountId),
    listInsights(accountId, range.start, range.end),
    caller.role === 'owner'
      ? listPendingActions({ accountId, status: 'pending' })
      : Promise.resolve([]),
  ]);

  return ok({
    client: toPublicClient(client),
    recent_campaigns: campaigns,
    summary_7d: sumInsights(insights),
    pending_actions_count: pendingActions.length,
    settings: client.settings,
  });
});

/** PUT /api/clients/[accountId] — owner only. */
export const PUT = withErrorHandling(async (request: Request, context: Context) => {
  const { accountId } = await context.params;
  const caller = await requireOwner(request);
  enforceRateLimit(request, caller);

  const patch = validate(updateClientSchema, await parseJson(request));

  const existing = await getClient(accountId);
  if (!existing) throw new ApiError('INVALID_CLIENT_ID', `No client with id "${accountId}".`);

  const { settings, pin, link_id, meta_access_token, ...fields } = patch;

  // A new link must not collide with another client's.
  if (link_id && link_id !== existing.link_id && (await isLinkIdTaken(link_id, accountId))) {
    throw new ApiError(
      'VALIDATION_ERROR',
      `The link "${link_id}" is already used by another client.`,
      { link_id: 'This link is already taken.' },
    );
  }

  const updated = await updateClient(accountId, {
    ...fields,
    ...(link_id ? { link_id } : {}),
    // Only rotate the PIN / token when a new one was actually supplied.
    ...(pin ? { access_pin_hash: hashPin(pin) } : {}),
    ...(meta_access_token ? { access_token_encrypted: encryptToken(meta_access_token) } : {}),
    // Merge settings rather than replacing the whole object, so a partial
    // update can't drop a flag the caller didn't mention.
    ...(settings ? { settings: { ...existing.settings, ...settings } } : {}),
  });

  if (!updated) throw new ApiError('INVALID_CLIENT_ID', `No client with id "${accountId}".`);
  return ok({ updatedClient: toPublicClient(updated), pin_rotated: Boolean(pin) });
});

/**
 * DELETE /api/clients/[accountId] — owner only, irreversible.
 *
 * Removes the client together with its campaigns, ad sets, insights, actions,
 * manual entries, creatives and stored files. Requires `?confirm=<name>`
 * matching the client's name, so a mistyped id cannot wipe the wrong account.
 */
export const DELETE = withErrorHandling(async (request: Request, context: Context) => {
  const { accountId } = await context.params;
  const caller = await requireOwner(request);
  requirePermission(caller, 'execute');
  enforceRateLimit(request, caller, 30, 'clients-write');

  const client = await getClient(accountId);
  if (!client) throw new ApiError('INVALID_CLIENT_ID', `No client with id "${accountId}".`);

  // Section B of the dashboard is built around the owner's own account.
  if (client.is_owner) {
    throw new ApiError(
      'FORBIDDEN',
      'The owner account cannot be deleted. Clear `is_owner` on it first if you really mean to remove it.',
    );
  }

  const confirm = new URL(request.url).searchParams.get('confirm');
  if (confirm !== client.name) {
    throw new ApiError(
      'VALIDATION_ERROR',
      'Deleting a client is irreversible. Pass ?confirm=<exact client name> to proceed.',
      { expected: client.name, received: confirm ?? null },
    );
  }

  const result = await deleteAccount(accountId);

  return ok({
    deleted: true,
    client_id: accountId,
    name: client.name,
    ...result,
  });
});
