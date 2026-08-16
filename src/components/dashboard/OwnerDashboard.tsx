'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Megaphone, Plus, RefreshCw } from 'lucide-react';
import Navbar from '@/components/common/Navbar';
import Sidebar, { type OwnerSection } from '@/components/common/Sidebar';
import ClientSelector from './ClientSelector';
import ClientDashboard from './ClientDashboard';
import ClientFormModal from './ClientFormModal';
import ClientManageBar from './ClientManageBar';
import CampaignFormModal from './CampaignFormModal';
import DateRangeSelector from './DateRangeSelector';
import OverviewCards from './OverviewCards';
import TrendChart from '@/components/reports/TrendChart';
import CampaignTable from '@/components/reports/CampaignTable';
import PerformanceMetrics from '@/components/reports/PerformanceMetrics';
import ExportButtons from '@/components/reports/ExportButtons';
import PendingApprovals from '@/components/hermes/PendingApprovals';
import HermesControlPanel from '@/components/hermes/HermesControlPanel';
import ReviewQueue from '@/components/review/ReviewQueue';
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
  // null = closed, 'new' = create, otherwise the client being edited.
  const [clientForm, setClientForm] = useState<'new' | PublicClient | null>(null);
  const [campaignFormOpen, setCampaignFormOpen] = useState(false);
  const [launchNotice, setLaunchNotice] = useState<{
    tone: 'success' | 'danger';
    text: string;
  } | null>(null);

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
            onAdd={() => {
              setClientForm('new');
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
            <SectionA
              client={activeClient}
              onAdd={() => setClientForm('new')}
              onEdit={() => activeClient && setClientForm(activeClient)}
              onNewCampaign={() => setCampaignFormOpen(true)}
              onDeleted={(deletedId) => {
                // Fall back to whichever client is left after the removal.
                const remaining = managedClients.filter((c) => c.id !== deletedId);
                setSelectedClientId(remaining[0]?.id ?? null);
                void clients.refetch();
              }}
            />
          ) : section === 'own' ? (
            <SectionB
              client={ownerClient}
              highlightActionId={deepLinkAction}
              onApprovalsChanged={() => void approvals.refetch()}
              onNewCampaign={() => setCampaignFormOpen(true)}
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

      <ClientFormModal
        open={clientForm !== null}
        client={clientForm === 'new' ? null : clientForm}
        onClose={() => setClientForm(null)}
        onSaved={(saved) => {
          setSelectedClientId(saved.id);
          setSection(saved.is_owner ? 'own' : 'clients');
          void clients.refetch();
        }}
      />

      <CampaignFormModal
        open={campaignFormOpen}
        onClose={() => setCampaignFormOpen(false)}
        clientId={activeClient?.id ?? null}
        onSaved={(result) => {
          setLaunchNotice({
            tone: result.launch.ok ? 'success' : 'danger',
            text:
              result.launch.ok && result.campaign.creative_name
                ? `Campaign created with creative "${result.campaign.creative_name}". ${result.launch.message}`
                : result.launch.message,
          });
          void clients.refetch();
        }}
      />

      {launchNotice ? (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm">
          <InlineNotice tone={launchNotice.tone}>{launchNotice.text}</InlineNotice>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------- Section A: client monitor */

function SectionA({
  client,
  onAdd,
  onEdit,
  onNewCampaign,
  onDeleted,
}: {
  client: PublicClient | null;
  onAdd: () => void;
  onEdit: () => void;
  onNewCampaign: () => void;
  onDeleted: (clientId: string) => void;
}) {
  if (!client) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm font-medium text-cream-100">No client accounts yet</p>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-cream-100/55">
          Add a client to give them their own access link and reporting dashboard.
        </p>
        <button type="button" className="btn-primary mx-auto mt-4" onClick={onAdd}>
          <Plus className="h-4 w-4" aria-hidden />
          Add client
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ClientManageBar
        client={client}
        onEdit={onEdit}
        onDeleted={onDeleted}
        extra={
          <button type="button" className="btn-secondary" onClick={onNewCampaign}>
            <Megaphone className="h-4 w-4" aria-hidden />
            New campaign
          </button>
        }
      />
      <ReviewQueue clientId={client.id} />
      <ClientDashboard clientId={client.id} clientName={client.name} embedded />
      <PendingApprovals clientId={client.id} title={`Pending approvals · ${client.name}`} />
    </div>
  );
}

/* ------------------------------------------------ Section B: own account */

function SectionB({
  client,
  highlightActionId,
  onApprovalsChanged,
  onNewCampaign,
}: {
  client: PublicClient | null;
  highlightActionId: string | null;
  onApprovalsChanged: () => void;
  onNewCampaign: () => void;
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
          <button type="button" className="btn-secondary" onClick={onNewCampaign}>
            <Megaphone className="h-4 w-4" aria-hidden />
            New campaign
          </button>
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
