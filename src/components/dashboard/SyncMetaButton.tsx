'use client';

import { useState } from 'react';
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { API } from '@/constants/api-endpoints';
import { ApiClientError, apiPost } from '@/lib/api-client';

interface SyncResult {
  mode: 'live' | 'mock';
  synced_count: number;
  records_updated: number;
  note?: string;
}

/**
 * "Sync Meta" trigger. Pulls campaigns/ad sets/insights for one client via
 * POST /api/meta/sync, then lets the caller refresh its views.
 */
export default function SyncMetaButton({
  accountId,
  onSynced,
  label = 'Sync Meta',
}: {
  accountId: string;
  onSynced?: () => void;
  label?: string;
}) {
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const sync = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const result = await apiPost<SyncResult>(API.meta.sync, { client_id: accountId });
      setMessage({
        tone: 'success',
        text: `Synced ${result.synced_count} campaigns (${result.records_updated} insight rows, ${result.mode} mode)${result.note ? ` — ${result.note}` : ''}`,
      });
      onSynced?.();
      // Spec: success state clears after 3 seconds.
      window.setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({
        tone: 'danger',
        text: `Sync failed: ${err instanceof ApiClientError ? err.message : 'unknown error'}`,
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn-secondary"
        onClick={() => void sync()}
        disabled={syncing}
        aria-label="Sync campaign data from Meta"
      >
        {syncing ? (
          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
        ) : message?.tone === 'success' ? (
          <CheckCircle2 className="h-4 w-4 text-accent-success" aria-hidden />
        ) : message?.tone === 'danger' ? (
          <XCircle className="h-4 w-4 text-accent-danger" aria-hidden />
        ) : (
          <RefreshCw className="h-4 w-4" aria-hidden />
        )}
        <span className="hidden sm:inline">{syncing ? 'Syncing…' : label}</span>
      </button>
      {message ? (
        <span
          className={`max-w-[240px] truncate text-xs sm:max-w-xs ${
            message.tone === 'success' ? 'text-accent-success' : 'text-accent-danger'
          }`}
          title={message.text}
        >
          {message.tone === 'success' ? '✓ ' : '✗ '}
          {message.text}
        </span>
      ) : null}
    </div>
  );
}
