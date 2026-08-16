'use client';

import { useState } from 'react';
import { Download, Film, ImageIcon } from 'lucide-react';
import { API } from '@/constants/api-endpoints';
import { useFirestoreList } from '@/hooks/useFirestore';
import { downloadFile, ApiClientError } from '@/lib/api-client';
import { EmptyState, ErrorState, InlineNotice } from '@/components/common/States';
import { Skeleton } from '@/components/common/LoadingSpinner';
import { formatBytes, relativeTime } from '@/lib/utils';
import type { Creative } from '@/types';

interface CreativeRow extends Creative {
  url_expired: boolean;
}

export default function CreativeLibrary({
  clientId,
  refreshKey = 0,
  compact = false,
}: {
  clientId: string;
  /** Bump to force a reload after an upload. */
  refreshKey?: number;
  compact?: boolean;
}) {
  const { items, loading, error, refetch } = useFirestoreList<CreativeRow>(
    API.creatives.list(clientId),
    [clientId, refreshKey],
  );

  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const download = async (creative: CreativeRow) => {
    setDownloadingId(creative.id);
    setDownloadError(null);
    try {
      await downloadFile(API.creatives.download(creative.id), creative.file_name);
    } catch (err) {
      setDownloadError(
        err instanceof ApiClientError ? err.message : 'Could not download that file.',
      );
    } finally {
      setDownloadingId(null);
    }
  };

  if (error) return <ErrorState message={error} onRetry={refetch} />;

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {Array.from({ length: compact ? 2 : 4 }).map((_, index) => (
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<ImageIcon className="h-6 w-6" aria-hidden />}
        title="No creatives uploaded"
        description="Upload images or video and they appear here with a 7-day download link."
      />
    );
  }

  const visible = compact ? items.slice(0, 4) : items;

  return (
    <div>
      {downloadError ? (
        <InlineNotice tone="danger" className="mb-3">
          {downloadError}
        </InlineNotice>
      ) : null}

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {visible.map((creative) => (
          <li
            key={creative.id}
            className="flex items-center gap-3 rounded-lg border border-surface-border bg-navy-950/40 p-3"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cream-100/10 text-cream-100/60">
              {creative.file_type === 'video' ? (
                <Film className="h-4 w-4" aria-hidden />
              ) : (
                <ImageIcon className="h-4 w-4" aria-hidden />
              )}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-cream-100">
                {creative.file_name}
              </span>
              <span className="block text-xs text-cream-100/45">
                {formatBytes(creative.size_bytes)} · {relativeTime(creative.uploaded_at)}
                {creative.url_expired ? ' · link re-signed on download' : ''}
              </span>
            </span>

            <button
              type="button"
              className="btn-ghost shrink-0 px-2 py-1.5"
              onClick={() => void download(creative)}
              disabled={downloadingId === creative.id}
              aria-label={`Download ${creative.file_name}`}
            >
              <Download className="h-4 w-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      {compact && items.length > visible.length ? (
        <p className="mt-2 text-xs text-cream-100/45">
          Showing {visible.length} of {items.length} creatives.
        </p>
      ) : null}
    </div>
  );
}
