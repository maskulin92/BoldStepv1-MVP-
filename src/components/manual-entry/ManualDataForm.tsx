'use client';

import { useState } from 'react';
import { PlusCircle } from 'lucide-react';
import { API } from '@/constants/api-endpoints';
import { ApiClientError, apiPost } from '@/lib/api-client';
import { MANUAL_METRIC_TYPES } from '@/constants/form-options';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { InlineNotice } from '@/components/common/States';
import { toDateKey } from '@/lib/utils';
import type { Campaign, ManualMetricType } from '@/types';

/** Offline data entry: closed leads, sales value, custom conversions. */
export default function ManualDataForm({
  accountId,
  campaigns,
  onSaved,
}: {
  accountId: string;
  campaigns: Campaign[];
  onSaved?: () => void;
}) {
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? '');
  const [metricType, setMetricType] = useState<ManualMetricType>('leads_closed');
  const [value, setValue] = useState('');
  const [date, setDate] = useState(toDateKey(new Date()));
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const hint = MANUAL_METRIC_TYPES.find((option) => option.value === metricType)?.hint;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      setError('Enter a value of zero or more.');
      return;
    }

    setSaving(true);
    try {
      await apiPost(API.manualEntry.create, {
        client_id: accountId,
        campaign_id: campaignId,
        metric_type: metricType,
        value: numeric,
        date,
        notes: notes.trim() || undefined,
      });
      setSuccess('Entry saved.');
      setValue('');
      setNotes('');
      onSaved?.();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not save that entry.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-cream-100">Manual data entry</h2>
      <p className="mt-1 text-xs text-cream-100/45">
        Record outcomes Meta cannot see — closed deals, revenue, offline conversions.
      </p>

      <form onSubmit={submit} className="mt-5 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="entry-campaign">
              Campaign
            </label>
            <select
              id="entry-campaign"
              value={campaignId}
              onChange={(event) => setCampaignId(event.target.value)}
              className="w-full"
              required
              disabled={campaigns.length === 0}
            >
              {campaigns.length === 0 ? <option value="">No campaigns available</option> : null}
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="entry-date">
              Date
            </label>
            <input
              id="entry-date"
              type="date"
              value={date}
              max={toDateKey(new Date())}
              onChange={(event) => setDate(event.target.value)}
              className="w-full"
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="entry-metric">
              Metric
            </label>
            <select
              id="entry-metric"
              value={metricType}
              onChange={(event) => setMetricType(event.target.value as ManualMetricType)}
              className="w-full"
            >
              {MANUAL_METRIC_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="entry-value">
              Value
            </label>
            <input
              id="entry-value"
              type="number"
              min="0"
              step={metricType === 'sales_value' ? '0.01' : '1'}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={metricType === 'sales_value' ? '5200.00' : '4'}
              className="w-full"
              required
            />
          </div>
        </div>

        {hint ? <p className="text-xs text-cream-100/45">{hint}</p> : null}

        <div>
          <label className="label" htmlFor="entry-notes">
            Notes (optional)
          </label>
          <textarea
            id="entry-notes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Closed via WhatsApp follow-up"
            className="w-full resize-none"
          />
        </div>

        {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
        {success ? <InlineNotice tone="success">{success}</InlineNotice> : null}

        <button
          type="submit"
          className="btn-primary w-full sm:w-auto"
          disabled={saving || !campaignId}
        >
          {saving ? <LoadingSpinner size="sm" /> : <PlusCircle className="h-4 w-4" aria-hidden />}
          {saving ? 'Saving…' : 'Save entry'}
        </button>
      </form>
    </section>
  );
}
