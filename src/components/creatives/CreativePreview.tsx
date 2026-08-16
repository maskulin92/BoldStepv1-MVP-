'use client';

import { Film, ImageIcon } from 'lucide-react';
import { API } from '@/constants/api-endpoints';
import { formatBytes, formatDateTime } from '@/lib/utils';
import type { Creative } from '@/types';

/**
 * Inline preview for a single creative. The media element points at the
 * authenticated download route, which relies on the session cookie.
 */
export default function CreativePreview({ creative }: { creative: Creative }) {
  const source = API.creatives.download(creative.id);

  return (
    <div className="space-y-3">
      <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg border border-surface-border bg-navy-950/60">
        {creative.file_type === 'video' ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={source} controls className="h-full w-full object-contain" preload="metadata">
            <Film className="h-8 w-8" aria-hidden />
          </video>
        ) : (
          // Signed/streamed URL — Next's image optimiser can't fetch it, so use <img>.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={source}
            alt={creative.file_name}
            className="h-full w-full object-contain"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        )}
      </div>

      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-cream-100/45">File</dt>
          <dd className="truncate text-cream-100">{creative.file_name}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-cream-100/45">Type</dt>
          <dd className="flex items-center gap-1.5 text-cream-100">
            {creative.file_type === 'video' ? (
              <Film className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ImageIcon className="h-3.5 w-3.5" aria-hidden />
            )}
            {creative.content_type}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-cream-100/45">Size</dt>
          <dd className="text-cream-100">{formatBytes(creative.size_bytes)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-cream-100/45">Uploaded</dt>
          <dd className="text-cream-100">{formatDateTime(creative.uploaded_at)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-cream-100/45">Link expires</dt>
          <dd className="text-cream-100">{formatDateTime(creative.url_expires_at)}</dd>
        </div>
      </dl>
    </div>
  );
}
