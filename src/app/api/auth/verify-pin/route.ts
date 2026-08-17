import { ApiError, fail, ok, parseJson, withErrorHandling } from '@/lib/api-response';
import { signClientSession, verifyPin } from '@/lib/auth';
import { clearPinAttempts, getClientByLinkId, getPinAttemptState, recordFailedPinAttempt } from '@/lib/firestore';
import { SESSION_COOKIE_NAME, clientIp } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validate, verifyPinSchema } from '@/lib/validation';
import { IS_PRODUCTION } from '@/lib/env';

export const dynamic = 'force-dynamic';

const PIN_MAX_ATTEMPTS = 10;

/**
 * POST /api/auth/verify-pin  { link_id, pin }
 * Client session (link + 6-digit PIN). Token lives 30 days.
 *
 * Two independent layers:
 *   1. Firestore-backed per-link counter — 10 consecutive failures lock the
 *      link for 15 minutes. Survives serverless cold starts and is shared
 *      across instances, so the ceiling holds in production.
 *   2. The in-memory IP limiter (8/min per link+IP) stays as a secondary
 *      layer for burst traffic.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const body = await parseJson(request);
  const { link_id, pin } = validate(verifyPinSchema, body);

  // Layer 1: persistent per-link lockout, checked before anything else.
  const lockState = await getPinAttemptState(link_id);
  if (lockState.locked) {
    return fail('RATE_LIMIT_EXCEEDED', 'This link is temporarily locked after too many incorrect codes. Try again later.', {
      retry_after_seconds: lockState.retry_after_seconds,
      locked_until: lockState.locked_until,
    });
  }

  // Layer 2: burst limiter per link+IP.
  const limit = checkRateLimit(`pin:${link_id}:${clientIp(request)}`, 8);
  if (!limit.allowed) {
    return fail('RATE_LIMIT_EXCEEDED', 'Too many attempts. Wait a minute and try again.', {
      retry_after_seconds: limit.retry_after_seconds,
    });
  }

  const client = await getClientByLinkId(link_id);
  if (!client || !client.access_pin_hash || !verifyPin(pin, client.access_pin_hash)) {
    const after = await recordFailedPinAttempt(link_id);
    throw new ApiError(
      'INVALID_PIN',
      after.locked
        ? 'That access code is not valid for this link. The link is now locked for 15 minutes.'
        : `That access code is not valid for this link. ${PIN_MAX_ATTEMPTS - after.failed_attempts} attempt(s) left before this link locks for 15 minutes.`,
      after.locked ? { locked_until: after.locked_until, retry_after_seconds: after.retry_after_seconds } : undefined,
    );
  }

  // Correct PIN clears the persistent counter.
  await clearPinAttempts(link_id);

  const token = await signClientSession(client.id, client.name);

  const response = ok({
    token,
    client: {
      id: client.id,
      name: client.name,
      goal: client.primary_goal,
      link_id: client.link_id,
    },
  });

  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });

  return response;
});
