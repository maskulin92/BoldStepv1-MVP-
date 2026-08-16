'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Image as ImageIcon, Film } from 'lucide-react';
import { API } from '@/constants/api-endpoints';
import { useFirestoreList } from '@/hooks/useFirestore';
import { formatBytes, formatDate } from '@/lib/utils';
import type { Creative } from '@/types';

interface CreativeRow extends Creative {
  url_expired: boolean;
}

/**
 * "Select a Creative" dropdown for the campaign form — lists APPROVED
 * creatives only (the endpoint enforces the same rule server-side, so even a
 * hand-crafted request cannot attach a pending or rejected asset). Optional:
 * the campaign can launch without one.
 */
export default function CreativeSelect({
  clientId,
  value,
  onChange,
}: {
  clientId: string;
  value: string;
  onChange: (creativeId: string) => void;
}) {
  const { items, loading, error } = useFirestoreList<CreativeRow>(
    `${API.creatives.list(clientId)}?status=approved`,
    [clientId],
  );

  const selected = useMemo(
    () => items.find((creative) => creative.id === value) ?? null,
    [items, value],
  );

  return (
    <div>
      <label className="label" htmlFor="campaign-creative">
        Select a Creative <span className="text-cream-100/35">(optional)</span>
      </label>

      {loading ? (
        <p className="text-sm text-cream-100/45">Loading creatives…</p>
      ) : error ? (
        <p className="text-sm text-accent-danger">{error}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-cream-100/45">
          No approved creatives yet — upload and approve one first, or launch without.
        </p>
      ) : (
        <>
          <select
            id="campaign-creative"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="w-full"
          >
            <option value="">No creative — launch without</option>
            {items.map((creative) => (
              <option key={creative.id} value={creative.id}>
                {creative.file_name} · {creative.file_type} · {formatBytes(creative.size_bytes)} ·{' '}
                {formatDate(creative.uploaded_at.slice(0, 10))}
              </option>
            ))}
          </select>

          {selected ? (
            <div className="mt-3 flex items-center gap-3 rounded-lg border border-surface-border bg-navy-950/40 p-3">
              {selected.file_type === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element -- bytes come from the app's own download route
                <img
                  src={API.creatives.download(selected.id)}
                  alt={selected.file_name}
                  className="h-14 w-14 shrink-0 rounded-md object-cover"
                />
              ) : (
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-navy-900">
                  <Film className="h-6 w-6 text-cream-100/50" aria-hidden />
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-cream-100">
                  {selected.file_name}
                </p>
                <p className="flex items-center gap-1 text-xs text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" aria-hidden />
                  Approved · {selected.campaign_id}
                </p>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Icon used by the empty state in the library; re-exported for symmetry. */
export const CreativeIcon = ImageIcon;
