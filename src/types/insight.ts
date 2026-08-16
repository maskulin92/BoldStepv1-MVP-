export interface InsightMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  conversions: number;
  ctr: number;
  cpm: number;
  cpc: number;
  cpl: number;
}

/** `daily_insights/{clientId}/{date}/{campaignId}` */
export interface DailyInsight extends InsightMetrics {
  id: string;
  client_id: string;
  campaign_id: string;
  campaign_name: string;
  date: string;
  synced_at: string;
  by_adset: Record<string, InsightMetrics>;
}

export type ManualMetricType = 'leads_closed' | 'sales_value' | 'conversion_custom';

/** `manual_entries/{clientId}/{date}/{entryId}` */
export interface ManualEntry {
  id: string;
  client_id: string;
  campaign_id: string;
  adset_id?: string;
  metric_type: ManualMetricType;
  value: number;
  notes: string;
  entered_by: 'fadhil' | 'client';
  created_at: string;
  date: string;
}

export interface TrendPoint {
  date: string;
  spend: number;
  leads: number;
  cpl: number;
  clicks: number;
  impressions: number;
  ctr: number;
}

export interface DateRange {
  start: string;
  end: string;
}
