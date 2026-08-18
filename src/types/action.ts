export type ActionModel = 'glm' | 'claude';

export type ActionType = 'pause' | 'resume' | 'budget_change' | 'analysis';

export type ActionStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';

export type ApprovalDecision = 'approved' | 'rejected' | 'modified';

export interface ActionMetadata {
  current_cpl?: number;
  target_cpl?: number;
  performance_change?: number;
  current_budget?: number;
  proposed_budget?: number;
  [key: string]: number | string | boolean | undefined;
}

/** `pending_actions/{accountId}/items/{actionId}` */
export interface PendingAction {
  id: string;
  client_id: string;
  client_name: string;
  from_model: ActionModel;
  action_type: ActionType;
  campaign_id: string;
  campaign_name: string;
  adset_id?: string;
  suggestion_text: string;
  reason: string;
  metadata: ActionMetadata;
  status: ActionStatus;
  fadhil_decision: string;
  created_at: string;
  executed_at?: string;
  meta_result?: MetaExecutionResult;
}

export interface MetaExecutionResult {
  ok: boolean;
  mode: 'live' | 'mock';
  message: string;
  applied: Record<string, string | number | boolean>;
  executed_at: string;
}

export interface HermesPattern {
  pattern_id: string;
  description: string;
  frequency: number;
  examples: string[];
  confidence: number;
  last_seen: string;
}

export interface HermesApprovalLog {
  id: string;
  decision: ApprovalDecision;
  campaign: string;
  reason: string;
  outcome: string;
  timestamp: string;
}

export type HermesFrequency = '6h' | '12h' | '24h';

export interface HermesSettings {
  frequency: HermesFrequency;
  auto_execute: boolean;
  notification_channel: 'telegram';
  monitored_campaigns: 'all' | string[];
  updated_at: string;
}

export interface HermesChatMessage {
  id: string;
  role: 'user' | 'hermes';
  content: string;
  timestamp: string;
  is_mock?: boolean;
}
