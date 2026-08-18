'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/common/Modal';
import { InlineNotice } from '@/components/common/States';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import CreativeSelect from '@/components/creatives/CreativeSelect';
import { API } from '@/constants/api-endpoints';
import { CAMPAIGN_OBJECTIVES } from '@/constants/form-options';
import { ApiClientError, apiPost } from '@/lib/api-client';
import type { Campaign, CampaignObjective } from '@/types';

interface CreateResult {
  campaign: Campaign;
  launch: { ok: boolean; mode: 'live' | 'mock'; message: string; creative_attached: boolean };
  success_note?: string;
}

/**
 * New-campaign dialog: name, objective, daily budget and an optional approved
 * creative. Launching calls Meta (mock-mode without credentials) and stores
 * the campaign with the creative attached.
 */
export default function CampaignFormModal({
  open,
  onClose,
  onSaved,
  accountId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (result: CreateResult) => void;
  accountId: string | null;
}) {
  const [name, setName] = useState('');
  const [objective, setObjective] = useState<CampaignObjective>('LEAD_GENERATION');
  const [budget, setBudget] = useState('');
  const [creativeId, setCreativeId] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setName('');
    setObjective('LEAD_GENERATION');
    setBudget('');
    setCreativeId('');
    setError(null);
    setFieldErrors({});
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accountId) return;
    setSaving(true);
    setError(null);
    setFieldErrors({});

    const numeric = Number(budget);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setError('Enter a daily budget greater than zero.');
      setSaving(false);
      return;
    }

    try {
      const result = await apiPost<CreateResult>(API.campaigns.list(accountId), {
        name: name.trim(),
        objective,
        budget_daily: numeric,
        ...(creativeId ? { creative_id: creativeId } : {}),
      });
      onSaved(result);
      onClose();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
        if (err.details) {
          setFieldErrors(
            Object.fromEntries(
              Object.entries(err.details).map(([key, value]) => [key, String(value)]),
            ),
          );
        }
      } else {
        setError('Could not create this campaign.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New campaign"
      description="Creates the campaign on Meta (PAUSED) with an optional approved creative."
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            form="campaign-form"
            className="btn-primary"
            disabled={saving || name.trim().length < 2 || !budget}
          >
            {saving ? <LoadingSpinner size="sm" /> : null}
            Create campaign
          </button>
        </>
      }
    >
      <form id="campaign-form" onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="campaign-name">
            Campaign name
          </label>
          <input
            id="campaign-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Braces Promo Q4"
            className="w-full"
            required
            minLength={2}
            autoFocus
          />
          {fieldErrors.name ? (
            <p className="mt-1 text-xs text-accent-danger">{fieldErrors.name}</p>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="campaign-objective">
              Objective
            </label>
            <select
              id="campaign-objective"
              value={objective}
              onChange={(event) => setObjective(event.target.value as CampaignObjective)}
              className="w-full"
            >
              {CAMPAIGN_OBJECTIVES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="campaign-budget">
              Daily budget (RM)
            </label>
            <input
              id="campaign-budget"
              inputMode="decimal"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              placeholder="150"
              className="w-full"
              required
            />
            {fieldErrors.budget_daily ? (
              <p className="mt-1 text-xs text-accent-danger">{fieldErrors.budget_daily}</p>
            ) : null}
          </div>
        </div>

        {accountId ? (
          <CreativeSelect accountId={accountId} value={creativeId} onChange={setCreativeId} />
        ) : null}
        {fieldErrors.creative_id ? (
          <p className="text-xs text-accent-danger">{fieldErrors.creative_id}</p>
        ) : null}

        {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
      </form>
    </Modal>
  );
}
