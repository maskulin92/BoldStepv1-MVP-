'use client';

import { useMemo, useState } from 'react';
import { BarChart3, CloudUpload, ClipboardPen, RefreshCw } from 'lucide-react';
import Navbar from '@/components/common/Navbar';
import OverviewCards from './OverviewCards';
import DateRangeSelector from './DateRangeSelector';
import TrendChart from '@/components/reports/TrendChart';
import CampaignTable from '@/components/reports/CampaignTable';
import PerformanceMetrics from '@/components/reports/PerformanceMetrics';
import ExportButtons from '@/components/reports/ExportButtons';
import CreativeLibrary from '@/components/creatives/CreativeLibrary';
import CreativeUpload from '@/components/creatives/CreativeUpload';
import ManualDataForm from '@/components/manual-entry/ManualDataForm';
import EntryHistory from '@/components/manual-entry/EntryHistory';
import { ErrorState } from '@/components/common/States';
import { useAuth } from '@/hooks/useAuth';
import { useClientData } from '@/hooks/useClientData';
import { cn } from '@/lib/utils';
import type { DatePresetValue } from '@/constants/form-options';

type Tab = 'overview' | 'upload' | 'entry';

const TABS: { id: Tab; label: string; icon: typeof BarChart3 }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'upload', label: 'Upload Creative', icon: CloudUpload },
  { id: 'entry', label: 'Data Entry', icon: ClipboardPen },
];

/**
 * The client-facing view at /dashboard/client/[linkId] — read-only reporting
 * plus two contribution tabs (creative upload, manual data entry) whose
 * submissions go through the owner's review queue before they count.
 * The same component backs Section A of the owner dashboard, minus the chrome.
 */
export default function ClientDashboard({
  clientId,
  clientName,
  embedded = false,
}: {
  clientId: string;
  clientName?: string;
  /** True when rendered inside the owner shell (no navbar, no logout). */
  embedded?: boolean;
}) {
  const { logout } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [preset, setPreset] = useState<DatePresetValue>('7d');
  const [days, setDays] = useState(7);
  const [entryRefresh, setEntryRefresh] = useState(0);

  const { range, client, campaigns, insights, loading, refetchAll } = useClientData(clientId, days);

  const name = clientName ?? client.data?.client.name ?? 'Client dashboard';
  const goalLabel = useMemo(() => {
    const goal = client.data?.client.primary_goal;
    if (goal === 'conversions') return 'Conversions';
    if (goal === 'traffic') return 'Clicks';
    return 'Leads';
  }, [client.data]);

  const campaignList = useMemo(
    () => campaigns.data?.campaigns ?? [],
    [campaigns.data],
  );
  const campaignNames = useMemo(
    () => Object.fromEntries(campaignList.map((c) => [c.id, c.name])),
    [campaignList],
  );

  const body = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg bg-navy-950/60 p-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={tab === id}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                tab === id
                  ? 'bg-cream-100 text-navy-900'
                  : 'text-cream-100/60 hover:bg-navy-900/60 hover:text-cream-100',
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {tab === 'overview' && (
            <>
              <DateRangeSelector
                value={preset}
                onChange={(next, nextDays) => {
                  setPreset(next);
                  setDays(nextDays);
                }}
              />
              <ExportButtons clientId={clientId} range={range} />
            </>
          )}
          <button
            type="button"
            className="btn-ghost"
            onClick={() => void refetchAll()}
            disabled={loading}
            aria-label="Refresh data"
          >
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden />
          </button>
        </div>
      </div>

      {tab === 'overview' &&
        (insights.error && campaigns.error ? (
          <ErrorState message={insights.error} onRetry={() => void refetchAll()} />
        ) : (
          <>
            <OverviewCards
              summary={insights.data?.summary ?? null}
              loading={insights.loading}
              goalLabel={goalLabel}
            />

            <PerformanceMetrics
              summary={insights.data?.summary ?? null}
              loading={insights.loading}
            />

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

            <section className="card p-4 sm:p-5">
              <h2 className="mb-4 text-sm font-semibold text-cream-100">Creative library</h2>
              <CreativeLibrary clientId={clientId} />
            </section>
          </>
        ))}

      {tab === 'upload' && (
        <>
          <CreativeUpload
            clientId={clientId}
            campaigns={campaignList}
            onUploaded={() => setEntryRefresh((n) => n + 1)}
          />
          <section className="card p-4 sm:p-5">
            <h2 className="mb-4 text-sm font-semibold text-cream-100">Creative library</h2>
            <p className="mb-4 text-xs text-cream-100/45">
              Approved creatives. New uploads appear after review.
            </p>
            <CreativeLibrary clientId={clientId} refreshKey={entryRefresh} />
          </section>
        </>
      )}

      {tab === 'entry' && (
        <>
          <ManualDataForm
            clientId={clientId}
            campaigns={campaignList}
            onSaved={() => setEntryRefresh((n) => n + 1)}
          />
          <EntryHistory
            clientId={clientId}
            refreshKey={entryRefresh}
            campaignNames={campaignNames}
          />
        </>
      )}
    </div>
  );

  if (embedded) return body;

  return (
    <div className="min-h-screen">
      <Navbar
        title={name}
        subtitle={`Performance report · ${range.start} to ${range.end}`}
        onLogout={() => void logout('/')}
      />
      <main className="mx-auto max-w-7xl p-4 sm:p-6">{body}</main>
    </div>
  );
}
