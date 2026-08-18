import { list, withErrorHandling } from '@/lib/api-response';
import { assertClientAccess, enforceRateLimit, requireCaller } from '@/lib/api-auth';
import { listManualEntries } from '@/lib/firestore';
import { isValidDateKey, paginate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ accountId: string }> };

/** GET /api/manual-entry/[accountId]?date=&startDate=&endDate= */
export const GET = withErrorHandling(async (request: Request, context: Context) => {
  const { accountId } = await context.params;
  const caller = await requireCaller(request);
  enforceRateLimit(request, caller);
  assertClientAccess(caller, accountId);

  const url = new URL(request.url);
  const date = url.searchParams.get('date');
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');

  // `approvedOnly=false` lets a caller see its own pending/rejected entries
  // (Entry History shows submission status). The owner may also pass
  // status=pending_approval to list the review queue across a client.
  const wantsAll = url.searchParams.get('approved_only') === 'false';

  const entries = await listManualEntries(accountId, {
    date: isValidDateKey(date) ? date : undefined,
    startDate: isValidDateKey(startDate) ? startDate : undefined,
    endDate: isValidDateKey(endDate) ? endDate : undefined,
    approvedOnly: !wantsAll,
  });

  const filtered = wantsAll && url.searchParams.get('status')
    ? entries.filter((e) => e.status === url.searchParams.get('status'))
    : entries;

  const { items, pagination } = paginate(
    filtered,
    Number(url.searchParams.get('page') ?? 1),
    Number(url.searchParams.get('per_page') ?? 100),
  );
  return list(items, pagination);
});
