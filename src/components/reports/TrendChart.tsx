'use client';

import { useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { THEME } from '@/constants/theme';
import { EmptyState } from '@/components/common/States';
import { Skeleton } from '@/components/common/LoadingSpinner';
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import type { TrendPoint } from '@/types';

type Metric = 'spend_leads' | 'cpl' | 'ctr';

const METRIC_TABS: { id: Metric; label: string }[] = [
  { id: 'spend_leads', label: 'Spend vs Leads' },
  { id: 'cpl', label: 'Cost per lead' },
  { id: 'ctr', label: 'CTR' },
];

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string; dataKey: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-surface-border bg-navy-950/95 px-3 py-2 shadow-card backdrop-blur">
      <p className="text-xs font-medium text-cream-100/60">{label ? formatDate(label) : ''}</p>
      <div className="mt-1.5 space-y-1">
        {payload.map((entry) => (
          <div key={entry.dataKey} className="flex items-center gap-2 text-sm">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: entry.color }}
              aria-hidden
            />
            <span className="text-cream-100/70">{entry.name}</span>
            <span className="ml-auto font-medium text-cream-100">
              {entry.dataKey === 'spend' || entry.dataKey === 'cpl'
                ? formatCurrency(entry.value)
                : entry.dataKey === 'ctr'
                  ? `${entry.value.toFixed(2)}%`
                  : formatNumber(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TrendChart({
  data,
  loading,
  title = 'Performance trend',
}: {
  data: TrendPoint[];
  loading?: boolean;
  title?: string;
}) {
  const [metric, setMetric] = useState<Metric>('spend_leads');

  const axisProps = {
    stroke: THEME.chart.axis,
    tick: { fill: THEME.chart.axis, fontSize: 11 },
    tickLine: false,
    axisLine: false,
  };

  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-cream-100">{title}</h2>
        <div
          className="flex rounded-lg border border-surface-border p-0.5"
          role="tablist"
          aria-label="Chart metric"
        >
          {METRIC_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={metric === tab.id}
              onClick={() => setMetric(tab.id)}
              className={
                metric === tab.id
                  ? 'rounded-md bg-cream-100 px-3 py-1 text-xs font-medium text-navy-900'
                  : 'rounded-md px-3 py-1 text-xs font-medium text-cream-100/55 hover:text-cream-100'
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-[280px] w-full" />
      ) : data.length === 0 ? (
        <EmptyState
          title="No data for this period"
          description="Once a sync runs for this client, the daily trend appears here."
        />
      ) : (
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            {metric === 'spend_leads' ? (
              <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={THEME.chart.spend} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={THEME.chart.spend} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="leadsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={THEME.chart.leads} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={THEME.chart.leads} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={THEME.chart.grid} vertical={false} />
                <XAxis dataKey="date" tickFormatter={(value: string) => formatDate(value)} {...axisProps} />
                <YAxis yAxisId="left" {...axisProps} width={56} />
                <YAxis yAxisId="right" orientation="right" {...axisProps} width={40} />
                <Tooltip content={<ChartTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 12, color: THEME.colors.textMuted, paddingTop: 8 }}
                />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="spend"
                  name="Spend (RM)"
                  stroke={THEME.chart.spend}
                  strokeWidth={2}
                  fill="url(#spendFill)"
                />
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="leads"
                  name="Leads"
                  stroke={THEME.chart.leads}
                  strokeWidth={2}
                  fill="url(#leadsFill)"
                />
              </AreaChart>
            ) : (
              <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="singleFill" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={metric === 'cpl' ? THEME.chart.cpl : THEME.chart.clicks}
                      stopOpacity={0.35}
                    />
                    <stop
                      offset="100%"
                      stopColor={metric === 'cpl' ? THEME.chart.cpl : THEME.chart.clicks}
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={THEME.chart.grid} vertical={false} />
                <XAxis dataKey="date" tickFormatter={(value: string) => formatDate(value)} {...axisProps} />
                <YAxis {...axisProps} width={56} />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey={metric === 'cpl' ? 'cpl' : 'ctr'}
                  name={metric === 'cpl' ? 'Cost per lead (RM)' : 'CTR (%)'}
                  stroke={metric === 'cpl' ? THEME.chart.cpl : THEME.chart.clicks}
                  strokeWidth={2}
                  fill="url(#singleFill)"
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
