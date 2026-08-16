'use client';

import { useEffect, useState } from 'react';
import { Save, ShieldAlert } from 'lucide-react';
import { API } from '@/constants/api-endpoints';
import { ApiClientError, apiPut } from '@/lib/api-client';
import { useFirestore } from '@/hooks/useFirestore';
import { HERMES_FREQUENCIES } from '@/constants/form-options';
import { LoadingPanel, LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorState, InlineNotice } from '@/components/common/States';
import { formatDateTime } from '@/lib/utils';
import type { HermesFrequency, HermesSettings as Settings } from '@/types';

interface SettingsResponse extends Settings {
  agent_connected: boolean;
  notifications_configured: boolean;
}

export default function HermesSettings() {
  const { data, loading, error, refetch } = useFirestore<SettingsResponse>(API.hermes.settings);

  const [frequency, setFrequency] = useState<HermesFrequency>('12h');
  const [autoExecute, setAutoExecute] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!data) return;
    setFrequency(data.frequency);
    setAutoExecute(data.auto_execute);
  }, [data]);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await apiPut(API.hermes.settings, { frequency, auto_execute: autoExecute });
      setSaved(true);
      await refetch();
    } catch (err) {
      setSaveError(err instanceof ApiClientError ? err.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingPanel label="Loading Hermes settings…" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const dirty = data ? frequency !== data.frequency || autoExecute !== data.auto_execute : false;

  return (
    <section className="card p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-cream-100">Hermes settings</h2>
      <p className="mt-1 text-xs text-cream-100/45">
        Applied by the agent on its next cycle. Last updated{' '}
        {data ? formatDateTime(data.updated_at) : '—'}.
      </p>

      <div className="mt-5 space-y-5">
        <div>
          <label className="label" htmlFor="frequency">
            Analysis frequency
          </label>
          <select
            id="frequency"
            value={frequency}
            onChange={(event) => setFrequency(event.target.value as HermesFrequency)}
            className="w-full sm:max-w-xs"
          >
            {HERMES_FREQUENCIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-lg border border-surface-border bg-navy-950/40 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-cream-100">Auto-execute</p>
              <p className="mt-1 text-xs text-cream-100/50">
                Let Hermes apply changes without waiting for your approval. Off is the right
                setting for the MVP.
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={autoExecute}
              onClick={() => setAutoExecute((value) => !value)}
              className={
                autoExecute
                  ? 'relative h-6 w-11 shrink-0 rounded-full bg-accent-warning transition'
                  : 'relative h-6 w-11 shrink-0 rounded-full bg-cream-100/20 transition'
              }
            >
              <span
                className={
                  autoExecute
                    ? 'absolute left-[22px] top-0.5 h-5 w-5 rounded-full bg-navy-950 transition-all'
                    : 'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-cream-100 transition-all'
                }
              />
              <span className="sr-only">Toggle auto-execute</span>
            </button>
          </div>

          {autoExecute ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-accent-warning/30 bg-accent-warning/10 px-3 py-2 text-xs text-accent-warning">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                Hermes will change live ad accounts on its own. Only enable this once you trust
                its track record in the memory viewer.
              </span>
            </div>
          ) : null}
        </div>

        <div>
          <p className="label">Notification channel</p>
          <div className="flex items-center gap-2 rounded-lg border border-surface-border bg-navy-950/40 px-3.5 py-2.5 text-sm text-cream-100/80">
            Telegram
            <span
              className={
                data?.notifications_configured
                  ? 'badge border-accent-success/30 bg-accent-success/15 text-accent-success'
                  : 'badge border-accent-warning/30 bg-accent-warning/15 text-accent-warning'
              }
            >
              {data?.notifications_configured ? 'connected' : 'not configured'}
            </span>
          </div>
          {!data?.notifications_configured ? (
            <p className="mt-1.5 text-xs text-cream-100/45">
              Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.local. Until then, notifications
              are written to the server console.
            </p>
          ) : null}
        </div>

        <div>
          <p className="label">Agent connection</p>
          <div className="flex items-center gap-2 rounded-lg border border-surface-border bg-navy-950/40 px-3.5 py-2.5 text-sm text-cream-100/80">
            Hermes agent
            <span
              className={
                data?.agent_connected
                  ? 'badge border-accent-success/30 bg-accent-success/15 text-accent-success'
                  : 'badge border-cream-100/20 bg-cream-100/10 text-cream-100/60'
              }
            >
              {data?.agent_connected ? 'API key configured' : 'not connected (Phase 2)'}
            </span>
          </div>
        </div>

        {saveError ? <InlineNotice tone="danger">{saveError}</InlineNotice> : null}
        {saved && !dirty ? <InlineNotice tone="success">Settings saved.</InlineNotice> : null}

        <button
          type="button"
          className="btn-primary"
          onClick={() => void save()}
          disabled={saving || !dirty}
        >
          {saving ? <LoadingSpinner size="sm" /> : <Save className="h-4 w-4" aria-hidden />}
          Save settings
        </button>
      </div>
    </section>
  );
}
