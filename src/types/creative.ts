export type CreativeFileType = 'image' | 'video';

/**
 * Client-uploaded creatives start as `pending_review` and only appear in the
 * client-facing library and Top Performing Ads once approved.
 */
export type CreativeStatus = 'pending_review' | 'approved' | 'rejected';

/** `creatives/{accountId}/items/{creativeId}` */
export interface Creative {
  id: string;
  client_id: string;
  file_name: string;
  file_type: CreativeFileType;
  content_type: string;
  storage_path: string;
  campaign_id: string;
  adset_id?: string;
  download_url: string;
  url_expires_at: string;
  uploaded_at: string;
  size_bytes: number;
  status: CreativeStatus;
  uploaded_by?: 'fadhil' | 'client';
  review_note?: string;
  reviewed_at?: string;
}

export interface TopPerformingAd {
  creative_id: string;
  file_name: string;
  file_type: CreativeFileType;
  download_url: string;
  campaign_name: string;
  spend: number;
  leads: number;
  cpl: number;
  ctr: number;
}
