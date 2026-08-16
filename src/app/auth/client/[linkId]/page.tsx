import type { Metadata } from 'next';
import LinkPinAuth from '@/components/auth/LinkPinAuth';
import { MOCK_MODE } from '@/lib/env';

export const metadata: Metadata = { title: 'Client access' };
export const dynamic = 'force-dynamic';

export default async function ClientAuthPage({
  params,
}: {
  params: Promise<{ linkId: string }>;
}) {
  const { linkId } = await params;
  return <LinkPinAuth linkId={linkId} mockMode={MOCK_MODE} />;
}
