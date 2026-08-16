export type CreativeFileType = 'image' | 'video';

/** `creatives/{clientId}/items/{creativeId}` */
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
