'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ClientDashboard from '@/components/dashboard/ClientDashboard';
import { LoadingPanel } from '@/components/common/LoadingSpinner';
import { useAuth } from '@/hooks/useAuth';

/**
 * Resolves the link segment to the authenticated client.
 *
 * The session — not the URL — decides which client's data loads, so editing
 * the link cannot reach another account. The API enforces the same rule.
 */
export default function ClientDashboardPage({ linkId }: { linkId: string }) {
  const router = useRouter();
  const { identity, loading } = useAuth();

  const session = identity?.client ?? null;
  const matches = Boolean(session && (session.link_id === linkId || session.id === linkId));
  const denied = !loading && (!identity || !session || !matches);

  useEffect(() => {
    if (denied) router.replace(`/auth/client/${encodeURIComponent(linkId)}`);
  }, [denied, linkId, router]);

  if (loading) return <LoadingPanel label="Checking your access code…" />;
  if (denied || !session) return <LoadingPanel label="Redirecting…" />;

  return <ClientDashboard clientId={session.id} clientName={session.name} />;
}
