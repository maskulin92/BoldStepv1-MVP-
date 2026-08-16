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

/**
 * Client-submitted entries start as `pending_approval` and only count toward
 * metrics once approved. Owner-entered entries are approved immediately.
 * Rejected entries are kept for audit but never aggregated.
 */
export type ManualEntryStatus = 'pending_approval' | 'approved' | 'rejected';

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
  status: ManualEntryStatus;
  review_note?: string;
  reviewed_by?: 'fadhil';
  reviewed_at?: string;
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
