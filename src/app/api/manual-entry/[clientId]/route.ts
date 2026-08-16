import { list, withErrorHandling } from '@/lib/api-response';
import { assertClientAccess, enforceRateLimit, requireCaller } from '@/lib/api-auth';
import { listManualEntries } from '@/lib/firestore';
import { isValidDateKey, paginate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ clientId: string }> };

/** GET /api/manual-entry/[clientId]?date=&startDate=&endDate= */
export const GET = withErrorHandling(async (request: Request, context: Context) => {
  const { clientId } = await context.params;
  const caller = await requireCaller(request);
  enforceRateLimit(request, caller);
  assertClientAccess(caller, clientId);

  const url = new URL(request.url);
  const date = url.searchParams.get('date');
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');

  const entries = await listManualEntries(clientId, {
    date: isValidDateKey(date) ? date : undefined,
    startDate: isValidDateKey(startDate) ? startDate : undefined,
    endDate: isValidDateKey(endDate) ? endDate : undefined,
  });

  const { items, pagination } = paginate(
    entries,
    Number(url.searchParams.get('page') ?? 1),
    Number(url.searchParams.get('per_page') ?? 100),
  );
  return list(items, pagination);
});
