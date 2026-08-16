import { list, withErrorHandling } from '@/lib/api-response';
import { assertClientAccess, enforceRateLimit, requireCaller } from '@/lib/api-auth';
import { listCreatives } from '@/lib/firestore';
import { isUrlExpired } from '@/lib/storage';
import { paginate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ clientId: string }> };

/** GET /api/creatives/[clientId] */
export const GET = withErrorHandling(async (request: Request, context: Context) => {
  const { clientId } = await context.params;
  const caller = await requireCaller(request);
  enforceRateLimit(request, caller);
  assertClientAccess(caller, clientId);

  const url = new URL(request.url);
  const campaignId = url.searchParams.get('campaign_id');
  // A client session only ever sees approved creatives; the owner can ask for
  // any status (the review queue asks for pending_review).
  const requested = url.searchParams.get('status');
  const statusFilter =
    caller.role === 'owner' && requested ? (requested as 'pending_review' | 'approved' | 'rejected') : 'approved';
  const page = Number(url.searchParams.get('page') ?? 1);
  const perPage = Number(url.searchParams.get('per_page') ?? 50);

  const creatives = (await listCreatives(clientId, { status: statusFilter }))
    .filter((creative) => !campaignId || creative.campaign_id === campaignId)
    .map((creative) => ({
      ...creative,
      url_expired: isUrlExpired(creative.url_expires_at),
      // Always route through the download endpoint so an expired signed URL
      // gets re-signed transparently instead of 403-ing in the browser.
      download_url: `/api/creatives/download/${creative.id}`,
    }));

  const { items, pagination } = paginate(creatives, page, perPage);
  return list(items, pagination);
});
