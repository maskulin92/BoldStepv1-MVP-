'use client';

import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import Navbar from '@/components/common/Navbar';
import OverviewCards from './OverviewCards';
import DateRangeSelector from './DateRangeSelector';
import TrendChart from '@/components/reports/TrendChart';
import CampaignTable from '@/components/reports/CampaignTable';
import PerformanceMetrics from '@/components/reports/PerformanceMetrics';
import ExportButtons from '@/components/reports/ExportButtons';
import CreativeLibrary from '@/components/creatives/CreativeLibrary';
import { ErrorState } from '@/components/common/States';
import { useAuth } from '@/hooks/useAuth';
import { useClientData } from '@/hooks/useClientData';
import type { DatePresetValue } from '@/constants/form-options';

/**
 * The read-only view a client sees at /dashboard/client/[linkId].
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
  const [preset, setPreset] = useState<DatePresetValue>('7d');
  const [days, setDays] = useState(7);

  const { range, client, campaigns, insights, loading, refetchAll } = useClientData(clientId, days);

  const name = clientName ?? client.data?.client.name ?? 'Client dashboard';
  const goalLabel = useMemo(() => {
    const goal = client.data?.client.primary_goal;
    if (goal === 'conversions') return 'Conversions';
    if (goal === 'traffic') return 'Clicks';
    return 'Leads';
  }, [client.data]);

  const body = (
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

      {insights.error && campaigns.error ? (
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
            campaigns={campaigns.data?.campaigns ?? []}
            loading={campaigns.loading}
            error={campaigns.error}
            onRetry={() => void campaigns.refetch()}
          />

          <section className="card p-4 sm:p-5">
            <h2 className="mb-4 text-sm font-semibold text-cream-100">Creative library</h2>
            <CreativeLibrary clientId={clientId} />
          </section>
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
