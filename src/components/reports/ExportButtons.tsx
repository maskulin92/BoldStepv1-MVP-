'use client';

import { useState } from 'react';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { API } from '@/constants/api-endpoints';
import { ApiClientError, apiPost, downloadFile } from '@/lib/api-client';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { InlineNotice } from '@/components/common/States';

interface ReportResponse {
  download_url: string;
  file_name: string;
  expires_at: string;
}

/**
 * Generates a report server-side, then pulls the file through the
 * authenticated download route.
 */
export default function ExportButtons({
  clientId,
  range,
}: {
  clientId: string;
  range: { start: string; end: string };
}) {
  const [busy, setBusy] = useState<'pdf' | 'csv' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (format: 'pdf' | 'csv') => {
    setBusy(format);
    setError(null);
    try {
      const endpoint = format === 'pdf' ? API.reports.pdf : API.reports.csv;
      const report = await apiPost<ReportResponse>(endpoint, {
        client_id: clientId,
        date_range: range,
      });
      await downloadFile(report.download_url, report.file_name);
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : `Could not generate the ${format} report.`,
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void run('pdf')}
          disabled={busy !== null}
        >
          {busy === 'pdf' ? (
            <LoadingSpinner size="sm" />
          ) : (
            <FileText className="h-4 w-4" aria-hidden />
          )}
          PDF report
        </button>

        <button
          type="button"
          className="btn-secondary"
          onClick={() => void run('csv')}
          disabled={busy !== null}
        >
          {busy === 'csv' ? (
            <LoadingSpinner size="sm" />
          ) : (
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
          )}
          CSV export
        </button>
      </div>

      {error ? (
        <InlineNotice tone="danger" className="mt-2">
          {error}
        </InlineNotice>
      ) : null}
    </div>
  );
}
