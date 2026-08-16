import { ok, withErrorHandling } from '@/lib/api-response';
import { SESSION_COOKIE_NAME } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/** POST /api/auth/logout — clears the session cookie. */
export const POST = withErrorHandling(async () => {
  const response = ok({ logged_out: true });
  response.cookies.set(SESSION_COOKIE_NAME, '', { path: '/', maxAge: 0 });
  return response;
});
