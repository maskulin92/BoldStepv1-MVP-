import { Suspense } from 'react';
import type { Metadata } from 'next';
import AuthGuard from '@/components/auth/AuthGuard';
import OwnerDashboard from '@/components/dashboard/OwnerDashboard';
import { LoadingPanel } from '@/components/common/LoadingSpinner';
import { MOCK_MODE } from '@/lib/env';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  return (
    <AuthGuard role="owner" redirectTo="/auth/owner">
      {/* OwnerDashboard reads search params for Telegram approval deep links. */}
      <Suspense fallback={<LoadingPanel label="Loading dashboard…" />}>
        <OwnerDashboard mockMode={MOCK_MODE} />
      </Suspense>
    </AuthGuard>
  );
}
