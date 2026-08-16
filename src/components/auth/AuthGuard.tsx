'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { LoadingPanel } from '@/components/common/LoadingSpinner';

interface AuthGuardProps {
  children: React.ReactNode;
  /** Which role this subtree requires. */
  role: 'owner' | 'client';
  /** Where to send an unauthenticated visitor. */
  redirectTo: string;
  /** For client routes: the client this page belongs to. */
  clientId?: string;
}

/**
 * Route-level gate. Server routes enforce the same rules independently —
 * this only avoids rendering a dashboard the API would refuse to fill.
 */
export default function AuthGuard({ children, role, redirectTo, clientId }: AuthGuardProps) {
  const router = useRouter();
  const { identity, loading } = useAuth();

  const wrongRole = Boolean(identity && identity.role !== role);
  const wrongClient = Boolean(
    identity && role === 'client' && clientId && identity.client?.id !== clientId,
  );
  const denied = !loading && (!identity || wrongRole || wrongClient);

  useEffect(() => {
    if (denied) router.replace(redirectTo);
  }, [denied, redirectTo, router]);

  if (loading) return <LoadingPanel label="Checking your session…" />;
  if (denied) return <LoadingPanel label="Redirecting…" />;

  return <>{children}</>;
}
