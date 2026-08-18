import { ok, parseJson, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, requireCaller } from '@/lib/api-auth';
import { buildCsv } from '@/lib/export';
import { loadReportPayload, storeReport } from '@/lib/reports';
import { reportSchema, validate } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST /api/reports/csv  { client_id, date_range: { start, end } } */
export const POST = withErrorHandling(async (request: Request) => {
  const caller = await requireCaller(request);
  enforceRateLimit(request, caller, 20, 'reports');

  const { client_id, date_range } = validate(reportSchema, await parseJson(request));

  const payload = await loadReportPayload({ caller, accountId: client_id, range: date_range });
  const buffer = Buffer.from(buildCsv(payload), 'utf8');

  const stored = await storeReport({
    accountId: client_id,
    range: date_range,
    extension: 'csv',
    buffer,
    contentType: 'text/csv; charset=utf-8',
  });

  return ok({ ...stored, format: 'csv', csv_url: stored.download_url });
});
