import type { Metadata } from 'next';
import ClientDashboardPage from './ClientDashboardPage';

export const metadata: Metadata = { title: 'Client report' };
export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  return <ClientDashboardPage linkId={linkId} />;
}
