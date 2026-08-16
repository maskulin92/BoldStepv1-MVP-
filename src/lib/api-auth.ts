import 'server-only';
import { ApiError } from './api-response';
import { hashApiKey, verifySession } from './auth';
import { findApiKeyByHash, touchApiKey } from './firestore';
import { checkRateLimit } from './rate-limit';
import { env } from './env';
import type { Permission, SessionPayload } from '@/types';

/**
 * Two ways in:
 *   - `Authorization: Bearer <jwt>`      — the dashboard (owner or client)
 *   - `Authorization: Bearer boldstep_sk_…` — integrations and Hermes
 *
 * Both collapse into one `Caller` so route handlers only reason about
 * identity and permissions.
 */

export interface Caller {
  kind: 'session' | 'api_key';
  id: string;
  role: 'owner' | 'client';
  client_id?: string;
  permissions: Permission[];
  key_name?: string;
}

const SESSION_COOKIE = 'boldstep_session';

export function extractToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  // Cookie fallback so server components and plain <a> downloads authenticate too.
  const cookie = request.headers.get('cookie');
  if (cookie) {
    const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;

/** Resolves a caller from either credential type, or null when absent/invalid. */
export async function resolveCaller(request: Request): Promise<Caller | null> {
  const token = extractToken(request);
  if (!token) return null;

  if (token.startsWith('boldstep_sk_')) {
    return resolveApiKey(token);
  }

  const session: SessionPayload | null = await verifySession(token);
  if (!session) return null;
  return {
    kind: 'session',
    id: session.sub,
    role: session.role,
    client_id: session.client_id,
    permissions: session.permissions ?? [],
  };
}

async function resolveApiKey(token: string): Promise<Caller | null> {
  // The Hermes agent key is configured directly in the environment so the
  // agent can authenticate before any key has been minted through the UI.
  if (env.hermes.apiKey && token === env.hermes.apiKey) {
    return {
      kind: 'api_key',
      id: 'hermes-agent',
      role: 'owner',
      permissions: ['read', 'write', 'execute'],
      key_name: 'Hermes Agent',
    };
  }

  const record = await findApiKeyByHash(hashApiKey(token));
  if (!record) return null;
  if (record.status !== 'active') return null;
  if (record.expires_at && new Date(record.expires_at).getTime() < Date.now()) return null;

  void touchApiKey(record.id).catch(() => undefined);

  return {
    kind: 'api_key',
    id: record.owner_id,
    role: 'owner',
    permissions: record.permissions,
    key_name: record.name,
  };
}

/* --------------------------------------------------------------- guards */

/** Any authenticated caller. Throws 401 otherwise. */
export async function requireCaller(request: Request): Promise<Caller> {
  const caller = await resolveCaller(request);
  if (!caller) {
    throw new ApiError('UNAUTHORIZED', 'Authentication required. Send a Bearer token.');
  }
  return caller;
}

/** Owner-only routes (approvals, Hermes control, client management). */
export async function requireOwner(request: Request): Promise<Caller> {
  const caller = await requireCaller(request);
  if (caller.role !== 'owner') {
    throw new ApiError('FORBIDDEN', 'This endpoint is restricted to the account owner.');
  }
  return caller;
}

/** API-key-only routes (`/api/integrations/*`). */
export async function requireApiKey(request: Request): Promise<Caller> {
  const caller = await requireCaller(request);
  if (caller.kind !== 'api_key') {
    throw new ApiError(
      'INVALID_API_KEY',
      'This endpoint requires an API key. Generate one at POST /api/integrations/auth/generate-key.',
    );
  }
  return caller;
}

export function requirePermission(caller: Caller, permission: Permission): void {
  if (!caller.permissions.includes(permission)) {
    throw new ApiError(
      'INSUFFICIENT_PERMISSIONS',
      `This credential is missing the "${permission}" permission.`,
    );
  }
}

/**
 * Clients may only ever touch their own data; the owner may touch anyone's.
 * Every client-scoped route funnels through here.
 */
export function assertClientAccess(caller: Caller, clientId: string): void {
  if (caller.role === 'owner') return;
  if (caller.client_id !== clientId) {
    throw new ApiError('FORBIDDEN', 'You do not have access to this client.');
  }
}

/* ---------------------------------------------------------- rate limit */

/**
 * `scope` gives each budget its own bucket. Without it, a caller's requests to
 * cheap endpoints would eat the much smaller allowance of expensive ones
 * (report generation, uploads) and trip a 429 on the first call.
 */
export function enforceRateLimit(
  request: Request,
  caller: Caller | null,
  limit = 100,
  scope = 'api',
): void {
  const identity =
    caller?.kind === 'api_key'
      ? `key:${caller.id}:${caller.key_name ?? ''}`
      : caller
        ? `session:${caller.id}`
        : `ip:${clientIp(request)}`;

  const result = checkRateLimit(`${scope}|${identity}`, limit);
  if (!result.allowed) {
    throw new ApiError('RATE_LIMIT_EXCEEDED', 'Too many requests. Slow down and retry.', {
      limit: result.limit,
      retry_after_seconds: result.retry_after_seconds,
    });
  }
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  );
}
