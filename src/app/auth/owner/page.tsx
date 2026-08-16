import type { Metadata } from 'next';
import OwnerLogin from '@/components/auth/OwnerLogin';
import { MOCK_MODE } from '@/lib/env';

export const metadata: Metadata = { title: 'Owner sign in' };
export const dynamic = 'force-dynamic';

export default function OwnerLoginPage() {
  // Read on the server so demo credentials can never leak into a live build.
  return <OwnerLogin mockMode={MOCK_MODE} />;
}
