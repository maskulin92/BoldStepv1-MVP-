import { ok, parseJson, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, requireCaller } from '@/lib/api-auth';
import { buildPdf } from '@/lib/export';
import { loadReportPayload, storeReport } from '@/lib/reports';
import { reportSchema, validate } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/reports/pdf  { client_id, date_range: { start, end } }
 * Returns a handle the browser can GET to download the file.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const caller = await requireCaller(request);
  enforceRateLimit(request, caller, 20, 'reports');

  const { client_id, date_range } = validate(reportSchema, await parseJson(request));

  const payload = await loadReportPayload({ caller, clientId: client_id, range: date_range });
  const buffer = buildPdf(payload);

  const stored = await storeReport({
    clientId: client_id,
    range: date_range,
    extension: 'pdf',
    buffer,
    contentType: 'application/pdf',
  });

  return ok({ ...stored, format: 'pdf', pdf_url: stored.download_url });
});
