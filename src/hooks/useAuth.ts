'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API } from '@/constants/api-endpoints';
import {
  ApiClientError,
  apiGet,
  apiPost,
  clearToken,
  getStoredRole,
  getToken,
  setToken,
} from '@/lib/api-client';

export interface Identity {
  id: string;
  role: 'owner' | 'client';
  permissions: string[];
  client: { id: string; name: string; link_id: string } | null;
}

interface LoginResult {
  token: string;
  user: { id: string; email: string; permissions: string[] };
}

interface PinResult {
  token: string;
  client: { id: string; name: string; goal: string; link_id: string };
}

/**
 * Session state for both roles. The token lives in localStorage (for the
 * Authorization header) while the server also sets an httpOnly cookie — the
 * cookie is what makes authenticated file downloads work from a plain link.
 */
export function useAuth() {
  const router = useRouter();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setIdentity(null);
      setLoading(false);
      return;
    }
    try {
      const me = await apiGet<Identity>(API.auth.me);
      setIdentity(me);
    } catch {
      // Expired or revoked — drop the stale token rather than looping.
      clearToken();
      setIdentity(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loginOwner = useCallback(
    async (email: string, password: string) => {
      const result = await apiPost<LoginResult>(API.auth.login, { email, password });
      setToken(result.token, 'owner');
      await refresh();
      return result;
    },
    [refresh],
  );

  const loginClient = useCallback(
    async (linkId: string, pin: string) => {
      const result = await apiPost<PinResult>(API.auth.verifyPin, { link_id: linkId, pin });
      setToken(result.token, 'client');
      await refresh();
      return result;
    },
    [refresh],
  );

  const logout = useCallback(
    async (redirectTo = '/') => {
      try {
        await apiPost(API.auth.logout);
      } catch {
        // Clearing locally is what matters; a failed call must not trap the user.
      }
      clearToken();
      setIdentity(null);
      router.push(redirectTo);
      router.refresh();
    },
    [router],
  );

  return {
    identity,
    loading,
    isAuthenticated: Boolean(identity),
    isOwner: identity?.role === 'owner',
    storedRole: getStoredRole(),
    loginOwner,
    loginClient,
    logout,
    refresh,
  };
}

export function describeAuthError(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}
