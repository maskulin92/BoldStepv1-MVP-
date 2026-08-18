export type CampaignObjective = 'LEAD_GENERATION' | 'CONVERSIONS' | 'TRAFFIC';

export type CampaignStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

export type AdSetStatus = 'ACTIVE' | 'PAUSED';

/** `campaigns/{accountId}/items/{campaignId}` */
export interface Campaign {
  id: string;
  client_id: string;
  name: string;
  objective: CampaignObjective;
  status: CampaignStatus;
  budget_daily: number;
  created_at: string;
  last_synced: string;
  meta_campaign_id: string;
  /**
   * The approved creative attached at launch, if any. Only ever set after the
   * server has verified the creative exists, belongs to this client and is
   * approved — the form's dropdown can offer choices, the API decides.
   */
  creative_id?: string;
  creative_name?: string;
}

export interface AdSetTargeting {
  age_min: number;
  age_max: number;
  genders: string[];
  locations: string[];
  interests: string[];
}

/** `ad_sets/{accountId}/{campaignId}/{adSetId}` */
export interface AdSet {
  id: string;
  client_id: string;
  campaign_id: string;
  name: string;
  daily_budget: number;
  targeting: AdSetTargeting;
  status: AdSetStatus;
  created_at: string;
  meta_adset_id: string;
}
