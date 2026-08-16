import { z } from 'zod';
import { ApiError } from './api-response';

/**
 * Zod issues -> a single VALIDATION_ERROR envelope with per-field details.
 * Generic over the schema (not its output) so `.default()` and `.optional()`
 * infer correctly at the call site.
 */
export function validate<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details: Record<string, string> = {};
    for (const issue of result.error.issues) {
      details[issue.path.join('.') || '_'] = issue.message;
    }
    throw new ApiError('VALIDATION_ERROR', 'One or more fields are invalid.', details);
  }
  return result.data;
}

export const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format');

export const loginSchema = z.object({
  email: z.string().email('A valid email address is required'),
  password: z.string().min(1, 'Password is required'),
});

export const verifyPinSchema = z.object({
  link_id: z.string().min(1, 'link_id is required'),
  pin: z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
});

/** The URL segment in /client/[linkId] — kept slug-safe so links stay clean. */
export const linkId = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/,
    'Use 3–48 characters: lowercase letters, numbers and hyphens only',
  );

const clientSettingsSchema = z.object({
  notification_enabled: z.boolean().optional(),
  auto_execute: z.boolean().optional(),
  notification_channel: z.literal('telegram').optional(),
});

export const createClientSchema = z.object({
  name: z.string().trim().min(2).max(120),
  link_id: linkId,
  pin: z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
  primary_goal: z.enum(['leads', 'conversions', 'traffic']).default('leads'),
  ad_account_id: z.string().trim().max(64).optional(),
  /** Per-client Meta token; encrypted before it is stored. */
  meta_access_token: z.string().trim().max(500).optional(),
  is_owner: z.boolean().optional(),
  settings: clientSettingsSchema.optional(),
});

export const updateClientSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  link_id: linkId.optional(),
  /** Supplying a PIN rotates it; omitting it leaves the existing one alone. */
  pin: z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits').optional(),
  primary_goal: z.enum(['leads', 'conversions', 'traffic']).optional(),
  ad_account_id: z.string().trim().max(64).optional(),
  meta_access_token: z.string().trim().max(500).optional(),
  settings: clientSettingsSchema.optional(),
});

export const approvalDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'modified']),
  note: z.string().max(1000).optional(),
  modified_params: z
    .object({
      budget: z.number().positive().max(1_000_000).optional(),
    })
    .optional(),
});

export const hermesChatSchema = z.object({
  message: z.string().min(1, 'message is required').max(2000),
  client_id: z.string().optional(),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'hermes']),
        content: z.string().max(4000),
      }),
    )
    .max(20)
    .optional(),
});

export const hermesSettingsSchema = z.object({
  frequency: z.enum(['6h', '12h', '24h']).optional(),
  auto_execute: z.boolean().optional(),
  notification_channel: z.literal('telegram').optional(),
  monitored_campaigns: z.union([z.literal('all'), z.array(z.string()).max(200)]).optional(),
});

export const manualEntrySchema = z.object({
  client_id: z.string().min(1),
  campaign_id: z.string().min(1),
  adset_id: z.string().optional(),
  metric_type: z.enum(['leads_closed', 'sales_value', 'conversion_custom']),
  value: z.number().finite().min(0).max(100_000_000),
  date: dateKey,
  notes: z.string().max(500).optional(),
});

/** Owner decision on a client-submitted entry or creative. */
export const reviewDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().max(500).optional(),
});

export const metaSyncSchema = z.object({
  client_id: z.string().min(1),
  start_date: dateKey.optional(),
  end_date: dateKey.optional(),
});

export const reportSchema = z.object({
  client_id: z.string().min(1),
  date_range: z.object({ start: dateKey, end: dateKey }),
});

export const generateKeySchema = z.object({
  name: z.string().min(2).max(80),
  expires_in_days: z.number().int().min(1).max(3650).optional(),
  permissions: z.array(z.enum(['read', 'write', 'execute'])).optional(),
});

export const registerWebhookSchema = z.object({
  event: z.enum([
    'insight.synced',
    'action.created',
    'action.approved',
    'action.executed',
    'creative.uploaded',
    'manual_entry.created',
  ]),
  webhook_url: z.string().url('webhook_url must be a valid absolute URL'),
  active: z.boolean().optional(),
});

export const syncConversionsSchema = z.object({
  client_id: z.string().min(1),
  campaign_id: z.string().min(1),
  conversions: z
    .array(
      z.object({
        date: dateKey,
        value: z.number().finite().min(0),
        metric_type: z
          .enum(['leads_closed', 'sales_value', 'conversion_custom'])
          .default('conversion_custom'),
        notes: z.string().max(500).optional(),
        adset_id: z.string().optional(),
      }),
    )
    .min(1, 'At least one conversion is required')
    .max(500),
});

export const syncCrmSchema = z.object({
  client_id: z.string().min(1),
  source: z.string().min(2).max(60),
  records: z
    .array(
      z.object({
        campaign_id: z.string().min(1),
        date: dateKey,
        leads_closed: z.number().finite().min(0).optional(),
        sales_value: z.number().finite().min(0).optional(),
        notes: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(500),
});
