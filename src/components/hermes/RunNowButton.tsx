'use client';

import { useState } from 'react';
import { PlayCircle, RefreshCw } from 'lucide-react';
import { API } from '@/constants/api-endpoints';
import { ApiClientError, apiPost } from '@/lib/api-client';
import { InlineNotice } from '@/components/common/States';
import type { PublicClient } from '@/types';

interface RunResult {
  run_at: string;
  model: string;
  filed_count: number;
  notifications_sent: number;
  actions: { id: string; action_type: string; confidence?: number }[];
}

/**
 * "Run Now" — triggers an immediate Hermes analysis for the selected client,
 * bypassing the schedule. Draft-only: results land in Pending Approvals.
 */
export default function RunNowButton({
  clients,
  defaultClientId,
  onRun,
}: {
  clients: PublicClient[];
  defaultClientId?: string | null;
  onRun?: () => void;
}) {
  const [clientId, setClientId] = useState(defaultClientId ?? clients[0]?.id ?? '');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const run = async () => {
    if (!clientId) {
      setResult({ tone: 'danger', text: 'Select an account first.' });
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const data = await apiPost<RunResult>(API.hermes.run, { client_id: clientId });
      setResult({
        tone: 'success',
        text: `Filed ${data.filed_count} suggestion(s) via ${data.model}.`,
      });
      onRun?.();
    } catch (err) {
      setResult({
        tone: 'danger',
        text: `Run failed: ${err instanceof ApiClientError ? err.message : 'unknown error'}`,
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          className="min-w-0 flex-1"
          aria-label="Account to analyse"
        >
          {clients.length === 0 ? <option value="">No accounts</option> : null}
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void run()}
          disabled={running || !clientId}
        >
          {running ? (
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <PlayCircle className="h-4 w-4" aria-hidden />
          )}
          {running ? 'Running…' : 'Run Now'}
        </button>
      </div>
      {result ? <InlineNotice tone={result.tone}>{result.text}</InlineNotice> : null}
    </div>
  );
}
