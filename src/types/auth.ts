export type Role = 'owner' | 'client';

export type Permission = 'read' | 'write' | 'execute';

/** `auth_users/{userId}` */
export interface AuthUser {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
  permissions: Permission[];
}

export type PublicAuthUser = Omit<AuthUser, 'password_hash'>;

/** Decoded JWT payload for both owner and client sessions. */
export interface SessionPayload {
  sub: string;
  role: Role;
  /** Present on client sessions only — scopes every read to one client. */
  client_id?: string;
  email?: string;
  permissions: Permission[];
  iat?: number;
  exp?: number;
}

/** `api_keys/{keyId}` — hashed at rest, the plaintext is shown exactly once. */
export interface ApiKeyRecord {
  id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  owner_id: string;
  permissions: Permission[];
  created_at: string;
  expires_at: string;
  last_used_at?: string;
  status: 'active' | 'revoked' | 'expired';
}

export type PublicApiKey = Omit<ApiKeyRecord, 'key_hash'>;

/** `audit_log/{entryId}` — operational audit trail (meta syncs, admin actions). */
export interface AuditLogEntry {
  id: string;
  action: string;
  actor: string;
  timestamp: string;
  sync_status?: 'success' | 'partial' | 'failed';
  campaign_count?: number;
  meta_response_time_ms?: number;
  client_id?: string;
  mode?: 'live' | 'mock';
  detail?: string;
}

export type WebhookEvent =
  | 'insight.synced'
  | 'action.created'
  | 'action.approved'
  | 'action.executed'
  | 'creative.uploaded'
  | 'manual_entry.created';

/** `webhooks/{webhookId}` — registered now, dispatched in Phase 2. */
export interface Webhook {
  id: string;
  event: WebhookEvent;
  webhook_url: string;
  active: boolean;
  owner_id: string;
  secret: string;
  created_at: string;
  last_triggered_at?: string;
  failure_count: number;
}
