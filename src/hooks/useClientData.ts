'use client';

import { useMemo } from 'react';
import { API } from '@/constants/api-endpoints';
import { useFirestore } from './useFirestore';
import { daysAgo, toDateKey } from '@/lib/utils';
import type {
  Campaign,
  ClientSummary,
  Creative,
  DailyInsight,
  PublicClient,
  TrendPoint,
} from '@/types';

export interface CampaignWithStats extends Campaign {
  stats: ClientSummary;
}

interface CampaignsResponse {
  campaigns: CampaignWithStats[];
  range: { start: string; end: string };
  summary: ClientSummary;
}

interface InsightsResponse {
  insights: DailyInsight[];
  trend: TrendPoint[];
  summary: ClientSummary;
  range: { start: string; end: string };
}

export function dateRangeForDays(days: number): { start: string; end: string } {
  return { start: toDateKey(daysAgo(days - 1)), end: toDateKey(new Date()) };
}

/**
 * Everything one client dashboard needs: campaigns, the insight series for the
 * selected window, and the creative library. Each piece keeps its own loading
 * and error state so a single failure doesn't blank the whole page.
 */
export function useClientData(accountId: string | null, days = 7) {
  const range = useMemo(() => dateRangeForDays(days), [days]);

  const query = `?startDate=${range.start}&endDate=${range.end}`;

  const client = useFirestore<{ client: PublicClient; settings: PublicClient['settings'] }>(
    accountId ? API.clients.detail(accountId) : null,
    [accountId],
  );

  const campaigns = useFirestore<CampaignsResponse>(
    accountId ? `${API.campaigns.list(accountId)}${query}` : null,
    [accountId, days],
  );

  const insights = useFirestore<InsightsResponse>(
    accountId ? `${API.meta.insights(accountId)}${query}` : null,
    [accountId, days],
  );

  const creatives = useFirestore<Creative[]>(null);

  const refetchAll = async () => {
    await Promise.all([client.refetch(), campaigns.refetch(), insights.refetch()]);
  };

  return {
    range,
    client,
    campaigns,
    insights,
    creatives,
    loading: client.loading || campaigns.loading || insights.loading,
    error: client.error ?? campaigns.error ?? insights.error,
    refetchAll,
  };
}
