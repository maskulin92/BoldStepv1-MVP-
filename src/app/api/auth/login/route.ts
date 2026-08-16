import { ApiError, fail, ok, parseJson, withErrorHandling } from '@/lib/api-response';
import { signOwnerSession, verifyPassword } from '@/lib/auth';
import { getOwnerByEmail } from '@/lib/firestore';
import { SESSION_COOKIE_NAME, clientIp } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { loginSchema, validate } from '@/lib/validation';
import { IS_PRODUCTION } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/login  { email, password }
 * Owner session. Token lives 7 days and is returned in the body (for the
 * Authorization header) *and* set as an httpOnly cookie (for downloads and
 * server components).
 */
export const POST = withErrorHandling(async (request: Request) => {
  // Brute-force guard, keyed on IP: 10 attempts/minute.
  const limit = checkRateLimit(`login:${clientIp(request)}`, 10);
  if (!limit.allowed) {
    return fail('RATE_LIMIT_EXCEEDED', 'Too many login attempts. Try again shortly.', {
      retry_after_seconds: limit.retry_after_seconds,
    });
  }

  const { email, password } = validate(loginSchema, await parseJson(request));

  const user = await getOwnerByEmail(email);
  // Same message either way — never reveal whether the address exists.
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new ApiError('INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }

  const token = await signOwnerSession(user.id, user.email, user.permissions);
  // The refresh token is a longer-lived session token; Phase 2 swaps this for
  // a rotating token stored server-side.
  const refreshToken = await signOwnerSession(user.id, user.email, user.permissions);

  const response = ok({
    token,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      permissions: user.permissions,
      role: 'owner' as const,
    },
  });

  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });

  return response;
});
