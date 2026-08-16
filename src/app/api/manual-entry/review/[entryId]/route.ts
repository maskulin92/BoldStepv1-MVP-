import { ApiError, ok, parseJson, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, requireOwner, requirePermission } from '@/lib/api-auth';
import { getManualEntry, updateManualEntry } from '@/lib/firestore';
import { dispatchWebhook } from '@/lib/webhooks';
import { reviewDecisionSchema, validate } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * POST /api/manual-entry/review/[entryId]  { decision, note? }
 * Owner only. Approving folds a client-submitted entry into the metrics;
 * rejecting keeps it for audit but excludes it from every aggregation.
 */
export const POST = withErrorHandling(async (request: Request, context: { params: Promise<{ entryId: string }> }) => {
  const caller = await requireOwner(request);
  requirePermission(caller, 'write');
  enforceRateLimit(request, caller, 60, 'entry-review');

  const { entryId } = await context.params;
  const { decision, note } = validate(reviewDecisionSchema, await parseJson(request));

  const entry = await getManualEntry(entryId);
  if (!entry) throw new ApiError('NOT_FOUND', `No manual entry with id "${entryId}".`);
  if (entry.status !== 'pending_approval') {
    throw new ApiError('ACTION_ALREADY_RESOLVED', `This entry was already ${entry.status}.`);
  }

  const updated = await updateManualEntry(entryId, {
    status: decision,
    review_note: note,
    reviewed_by: 'fadhil',
    reviewed_at: new Date().toISOString(),
  });

  return ok({ entry: updated });
});
