import { ok, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, requireOwner } from '@/lib/api-auth';
import { getHermesApprovalLog, getHermesPatterns } from '@/lib/firestore';

export const dynamic = 'force-dynamic';

/** GET /api/hermes/memory — learned patterns + the decision history. */
export const GET = withErrorHandling(async (request: Request) => {
  const caller = await requireOwner(request);
  enforceRateLimit(request, caller);

  const [patterns, approvalHistory] = await Promise.all([
    getHermesPatterns(),
    getHermesApprovalLog(),
  ]);

  return ok({
    patterns: [...patterns].sort((a, b) => b.confidence - a.confidence),
    approval_history: approvalHistory,
    counts: {
      patterns: patterns.length,
      decisions: approvalHistory.length,
      approved: approvalHistory.filter((entry) => entry.decision === 'approved').length,
      rejected: approvalHistory.filter((entry) => entry.decision === 'rejected').length,
      modified: approvalHistory.filter((entry) => entry.decision === 'modified').length,
    },
  });
});
