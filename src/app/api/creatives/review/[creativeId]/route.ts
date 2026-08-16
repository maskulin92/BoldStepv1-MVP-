import { ApiError, ok, parseJson, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, requireOwner, requirePermission } from '@/lib/api-auth';
import { getCreative, updateCreative } from '@/lib/firestore';
import { dispatchWebhook } from '@/lib/webhooks';
import { reviewDecisionSchema, validate } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * POST /api/creatives/review/[creativeId]  { decision, note? }
 * Owner only. Approving publishes a client-submitted creative into the client
 * library and Top Performing Ads; rejecting hides it. The file stays in
 * Storage either way — rejection is a review verdict, not deletion.
 */
export const POST = withErrorHandling(async (request: Request, context: { params: Promise<{ creativeId: string }> }) => {
  const caller = await requireOwner(request);
  requirePermission(caller, 'write');
  enforceRateLimit(request, caller, 60, 'creative-review');

  const { creativeId } = await context.params;
  const { decision, note } = validate(reviewDecisionSchema, await parseJson(request));

  const creative = await getCreative(creativeId);
  if (!creative) throw new ApiError('CREATIVE_NOT_FOUND', `No creative with id "${creativeId}".`);
  if (creative.status !== 'pending_review') {
    throw new ApiError('ACTION_ALREADY_RESOLVED', `This creative was already ${creative.status}.`);
  }

  const updated = await updateCreative(creativeId, creative.client_id, {
    status: decision,
    review_note: note,
    reviewed_at: new Date().toISOString(),
  });

  return ok({ creative: updated });
});
