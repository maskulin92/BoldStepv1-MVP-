'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import Navbar from '@/components/common/Navbar';
import Sidebar, { type OwnerSection } from '@/components/common/Sidebar';
import ClientSelector from './ClientSelector';
import ClientDashboard from './ClientDashboard';
import DateRangeSelector from './DateRangeSelector';
import OverviewCards from './OverviewCards';
import TrendChart from '@/components/reports/TrendChart';
import CampaignTable from '@/components/reports/CampaignTable';
import PerformanceMetrics from '@/components/reports/PerformanceMetrics';
import ExportButtons from '@/components/reports/ExportButtons';
import PendingApprovals from '@/components/hermes/PendingApprovals';
import HermesControlPanel from '@/components/hermes/HermesControlPanel';
import CreativeUpload from '@/components/creatives/CreativeUpload';
import CreativeLibrary from '@/components/creatives/CreativeLibrary';
import ManualDataForm from '@/components/manual-entry/ManualDataForm';
import EntryHistory from '@/components/manual-entry/EntryHistory';
import { ErrorState, InlineNotice } from '@/components/common/States';
import { LoadingPanel } from '@/components/common/LoadingSpinner';
import { API } from '@/constants/api-endpoints';
import { ApiClientError, apiPost } from '@/lib/api-client';
import { useAuth } from '@/hooks/useAuth';
import { useFirestoreList } from '@/hooks/useFirestore';
import { useClientData } from '@/hooks/useClientData';
import { usePendingApprovals } from '@/hooks/usePendingApprovals';
import type { DatePresetValue } from '@/constants/form-options';
import type { PublicClient } from '@/types';

/** Section A/B/C shell for the owner. */
export default function OwnerDashboard({ mockMode }: { mockMode: boolean }) {
  const { logout } = useAuth();
  const searchParams = useSearchParams();

  const [section, setSection] = useState<OwnerSection>('clients');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const clients = useFirestoreList<PublicClient>(API.clients.list);
  const approvals = usePendingApprovals();

  const ownerClient = useMemo(
    () => clients.items.find((client) => client.is_owner) ?? null,
    [clients.items],
  );
  const managedClients = useMemo(
    () => clients.items.filter((client) => !client.is_owner),
    [clients.items],
  );

  // A Telegram approval link lands on ?action=… — jump straight to Section B.
  const deepLinkAction = searchParams.get('action');
  useEffect(() => {
    if (deepLinkAction) setSection('own');
  }, [deepLinkAction]);

  useEffect(() => {
    if (!selectedClientId && managedClients.length > 0) {
      setSelectedClientId(managedClients[0].id);
    }
  }, [managedClients, selectedClientId]);

  const activeClient =
    section === 'own'
      ? ownerClient
      : (clients.items.find((client) => client.id === selectedClientId) ?? null);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        section={section}
        onSectionChange={setSection}
        pendingCount={approvals.actions.length}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        footer={
          mockMode ? (
            <p className="text-xs text-cream-100/40">
              Mock mode — data is generated locally. Add Firebase credentials to .env.local for
              live data.
            </p>
          ) : null
        }
      >
        {section === 'clients' ? (
          <ClientSelector
            clients={managedClients}
            selectedId={selectedClientId}
            onSelect={(id) => {
              setSelectedClientId(id);
              setSidebarOpen(false);
            }}
            loading={clients.loading}
          />
        ) : null}
      </Sidebar>

      <div className="flex min-w-0 flex-1 flex-col">
        <Navbar
          title={
            section === 'clients'
              ? (activeClient?.name ?? 'Client accounts')
              : section === 'own'
                ? (ownerClient?.name ?? 'Own ads account')
                : 'Hermes control panel'
          }
          subtitle={
            section === 'clients'
              ? 'Section A · monitor every client from one place'
              : section === 'own'
                ? 'Section B · your ads plus the approval queue'
                : 'Section C · chat, approvals, memory and settings'
          }
          onToggleSidebar={() => setSidebarOpen((value) => !value)}
          onLogout={() => void logout('/auth/owner')}
        />

        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">
          {clients.error ? (
            <ErrorState message={clients.error} onRetry={() => void clients.refetch()} />
          ) : clients.loading ? (
            <LoadingPanel label="Loading clients…" />
          ) : section === 'clients' ? (
            <SectionA clientId={activeClient?.id ?? null} clientName={activeClient?.name} />
          ) : section === 'own' ? (
            <SectionB
              client={ownerClient}
              highlightActionId={deepLinkAction}
              onApprovalsChanged={() => void approvals.refetch()}
            />
          ) : (
            <HermesControlPanel
              clients={clients.items}
              defaultClientId={selectedClientId}
              pendingCount={approvals.actions.length}
            />
          )}
        </main>
      </div>
    </div>
  );
}

/* ---------------------------------------------- Section A: client monitor */

function SectionA({ clientId, clientName }: { clientId: string | null; clientName?: string }) {
  if (!clientId) {
    return (
      <InlineNotice tone="info">
        No client accounts yet. Add documents to the `clients` collection in Firestore to see them
        here.
      </InlineNotice>
    );
  }

  return (
    <div className="space-y-4">
      <ClientDashboard clientId={clientId} clientName={clientName} embedded />
      <PendingApprovals
        clientId={clientId}
        title={`Pending approvals · ${clientName ?? 'this client'}`}
      />
    </div>
  );
}

/* ------------------------------------------------ Section B: own account */

function SectionB({
  client,
  highlightActionId,
  onApprovalsChanged,
}: {
  client: PublicClient | null;
  highlightActionId: string | null;
  onApprovalsChanged: () => void;
}) {
  const [preset, setPreset] = useState<DatePresetValue>('7d');
  const [days, setDays] = useState(7);
  const [creativeKey, setCreativeKey] = useState(0);
  const [entryKey, setEntryKey] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(
    null,
  );

  const clientId = client?.id ?? null;
  const { range, campaigns, insights, refetchAll } = useClientData(clientId, days);

  // Memoised so the identity is stable — a fresh `[]` on every render would
  // re-run the lookup map and re-render the children that receive it.
  const campaignList = useMemo(
    () => campaigns.data?.campaigns ?? [],
    [campaigns.data],
  );
  const campaignNames = useMemo(
    () => Object.fromEntries(campaignList.map((campaign) => [campaign.id, campaign.name])),
    [campaignList],
  );

  const sync = async () => {
    if (!clientId) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = await apiPost<{ records_updated: number; mode: string; note?: string }>(
        API.meta.sync,
        { client_id: clientId },
      );
      setSyncMessage({
        tone: 'success',
        text:
          result.note ??
          `Synced ${result.records_updated} rows from Meta (${result.mode} mode).`,
      });
      await refetchAll();
    } catch (err) {
      setSyncMessage({
        tone: 'danger',
        text: err instanceof ApiClientError ? err.message : 'Sync failed.',
      });
    } finally {
      setSyncing(false);
    }
  };

  if (!client || !clientId) {
    return (
      <InlineNotice tone="info">
        No owner account found. Mark one client document with `is_owner: true` to use this section.
      </InlineNotice>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangeSelector
          value={preset}
          onChange={(next, nextDays) => {
            setPreset(next);
            setDays(nextDays);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <ExportButtons clientId={clientId} range={range} />
          <button type="button" className="btn-secondary" onClick={() => void sync()} disabled={syncing}>
            <RefreshCw className={syncing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden />
            {syncing ? 'Syncing…' : 'Sync Meta'}
          </button>
        </div>
      </div>

      {syncMessage ? <InlineNotice tone={syncMessage.tone}>{syncMessage.text}</InlineNotice> : null}

      <OverviewCards summary={insights.data?.summary ?? null} loading={insights.loading} />
      <PerformanceMetrics summary={insights.data?.summary ?? null} loading={insights.loading} />

      <div onFocus={onApprovalsChanged}>
        <PendingApprovals
          clientId={clientId}
          title="Approval queue"
          highlightActionId={highlightActionId}
        />
      </div>

      <TrendChart
        data={insights.data?.trend ?? []}
        loading={insights.loading}
        title={`Spend and results · last ${days} days`}
      />

      <CampaignTable
        campaigns={campaignList}
        loading={campaigns.loading}
        error={campaigns.error}
        onRetry={() => void campaigns.refetch()}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <CreativeUpload
          clientId={clientId}
          campaigns={campaignList}
          onUploaded={() => setCreativeKey((key) => key + 1)}
        />
        <section className="card p-4 sm:p-5">
          <h2 className="mb-4 text-sm font-semibold text-cream-100">Creative library</h2>
          <CreativeLibrary clientId={clientId} refreshKey={creativeKey} />
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ManualDataForm
          clientId={clientId}
          campaigns={campaignList}
          onSaved={() => setEntryKey((key) => key + 1)}
        />
        <EntryHistory
          clientId={clientId}
          refreshKey={entryKey}
          campaignNames={campaignNames}
        />
      </div>
    </div>
  );
}
