export type PrimaryGoal = 'leads' | 'conversions' | 'traffic';

export type NotificationChannel = 'telegram';

export interface ClientSettings {
  notification_enabled: boolean;
  auto_execute: boolean;
  notification_channel: NotificationChannel;
}

/**
 * `clients/{clientId}`
 *
 * `access_token_encrypted` and `access_pin_hash` are stripped by
 * `toPublicClient()` before anything is returned over the API.
 */
export interface Client {
  id: string;
  name: string;
  link_id: string;
  ad_account_id: string;
  access_token_encrypted: string;
  access_pin_hash: string;
  primary_goal: PrimaryGoal;
  created_at: string;
  is_owner: boolean;
  settings: ClientSettings;
}

/** The shape safe to send to a browser. */
export type PublicClient = Omit<Client, 'access_token_encrypted' | 'access_pin_hash'>;

export interface ClientSummary {
  total_spend: number;
  total_leads: number;
  total_conversions: number;
  total_clicks: number;
  total_impressions: number;
  avg_cpl: number;
  avg_ctr: number;
  avg_cpm: number;
  avg_cpc: number;
}
