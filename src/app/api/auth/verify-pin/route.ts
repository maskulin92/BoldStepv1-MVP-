import { ApiError, fail, ok, parseJson, withErrorHandling } from '@/lib/api-response';
import { signClientSession, verifyPin } from '@/lib/auth';
import { getClientByLinkId } from '@/lib/firestore';
import { SESSION_COOKIE_NAME, clientIp } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validate, verifyPinSchema } from '@/lib/validation';
import { IS_PRODUCTION } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/verify-pin  { link_id, pin }
 * Client session (link + 6-digit PIN). Token lives 30 days.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const body = await parseJson(request);
  const { link_id, pin } = validate(verifyPinSchema, body);

  // 8 attempts per minute per link+IP pair — a 6-digit PIN needs this.
  const limit = checkRateLimit(`pin:${link_id}:${clientIp(request)}`, 8);
  if (!limit.allowed) {
    return fail('RATE_LIMIT_EXCEEDED', 'Too many attempts. Wait a minute and try again.', {
      retry_after_seconds: limit.retry_after_seconds,
    });
  }

  const client = await getClientByLinkId(link_id);
  if (!client || !client.access_pin_hash || !verifyPin(pin, client.access_pin_hash)) {
    throw new ApiError('INVALID_PIN', 'That access code is not valid for this link.');
  }

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
