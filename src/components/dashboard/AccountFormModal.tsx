'use client';

import { useEffect, useState } from 'react';
import { Dice5, KeyRound } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { InlineNotice } from '@/components/common/States';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { API } from '@/constants/api-endpoints';
import { PRIMARY_GOALS } from '@/constants/form-options';
import { ApiClientError, apiPost, apiPut } from '@/lib/api-client';
import { slugify } from '@/lib/utils';
import type { PrimaryGoal, PublicClient } from '@/types';

/**
 * Add / edit a client account.
 *
 * On create the PIN is required; on edit it is optional and only rotates the
 * existing one when filled in — so saving a name change never silently
 * invalidates the link the client is already using.
 */
export default function AccountFormModal({
  open,
  onClose,
  onSaved,
  client,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (client: PublicClient) => void;
  /** Omit to create; pass a client to edit it. */
  client?: PublicClient | null;
}) {
  const isEdit = Boolean(client);

  const [name, setName] = useState('');
  const [linkIdValue, setLinkIdValue] = useState('');
  const [linkTouched, setLinkTouched] = useState(false);
  const [pin, setPin] = useState('');
  const [goal, setGoal] = useState<PrimaryGoal>('leads');
  const [adAccountId, setAdAccountId] = useState('');
  const [metaToken, setMetaToken] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Reload the form whenever the dialog opens for a different client.
  useEffect(() => {
    if (!open) return;
    setName(client?.name ?? '');
    setLinkIdValue(client?.link_id ?? '');
    setLinkTouched(Boolean(client));
    setPin('');
    setGoal(client?.primary_goal ?? 'leads');
    setAdAccountId(client?.ad_account_id ?? '');
    setMetaToken('');
    setError(null);
    setFieldErrors({});
  }, [open, client]);

  // Suggest a link from the name until the field is edited by hand.
  const onNameChange = (value: string) => {
    setName(value);
    if (!linkTouched) setLinkIdValue(slugify(value));
  };

  const randomPin = () => {
    const digits = Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join('');
    setPin(digits);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});

    const payload: Record<string, unknown> = {
      name: name.trim(),
      link_id: linkIdValue.trim().toLowerCase(),
      primary_goal: goal,
      ...(adAccountId.trim() ? { ad_account_id: adAccountId.trim() } : {}),
      ...(metaToken.trim() ? { meta_access_token: metaToken.trim() } : {}),
      ...(pin ? { pin } : {}),
    };

    try {
      if (isEdit && client) {
        const result = await apiPut<{ updatedClient: PublicClient }>(
          API.clients.detail(client.id),
          payload,
        );
        onSaved(result.updatedClient);
      } else {
        const result = await apiPost<{ client: PublicClient }>(API.clients.list, payload);
        onSaved(result.client);
      }
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
        setError('Could not save this client.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit account' : 'Add account'}
      description={
        isEdit
          ? 'Changes apply immediately. Leave the PIN blank to keep the current one.'
          : 'Creates a new account with its own access link and code.'
      }
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            form="client-form"
            className="btn-primary"
            disabled={saving || !name.trim() || !linkIdValue.trim() || (!isEdit && pin.length !== 6)}
          >
            {saving ? <LoadingSpinner size="sm" /> : null}
            {isEdit ? 'Save changes' : 'Create account'}
          </button>
        </>
      }
    >
      <form id="client-form" onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="client-name">
            Client name
          </label>
          <input
            id="client-name"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Nova Dental Clinic"
            className="w-full"
            required
            autoFocus
          />
          {fieldErrors.name ? (
            <p className="mt-1 text-xs text-accent-danger">{fieldErrors.name}</p>
          ) : null}
        </div>

        <div>
          <label className="label" htmlFor="client-link">
            Access link
          </label>
          <div className="flex items-center gap-0 overflow-hidden rounded-lg border border-surface-border bg-navy-950/60 focus-within:border-accent-info/60">
            <span className="shrink-0 pl-3 text-sm text-cream-100/40">/auth/client/</span>
            <input
              id="client-link"
              value={linkIdValue}
              onChange={(event) => {
                setLinkTouched(true);
                setLinkIdValue(event.target.value.toLowerCase());
              }}
              placeholder="nova-dental"
              className="min-w-0 flex-1 border-0 bg-transparent focus:ring-0"
              required
            />
          </div>
          <p className="mt-1 text-xs text-cream-100/40">
            Lowercase letters, numbers and hyphens. This is the URL you send to the client.
          </p>
          {fieldErrors.link_id ? (
            <p className="mt-1 text-xs text-accent-danger">{fieldErrors.link_id}</p>
          ) : null}
        </div>

        <div>
          <label className="label" htmlFor="client-pin">
            {isEdit ? 'New access code (optional)' : 'Access code (6 digits)'}
          </label>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <KeyRound
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cream-100/35"
                aria-hidden
              />
              <input
                id="client-pin"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder={isEdit ? 'Leave blank to keep current' : '123456'}
                className="w-full pl-9 font-mono tracking-[0.3em]"
                required={!isEdit}
              />
            </div>
            <button
              type="button"
              className="btn-secondary shrink-0"
              onClick={randomPin}
              title="Generate a random code"
            >
              <Dice5 className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Random</span>
            </button>
          </div>
          {isEdit ? (
            <p className="mt-1 text-xs text-cream-100/40">
              Setting a new code signs the client out of their existing session.
            </p>
          ) : (
            <p className="mt-1 text-xs text-cream-100/40">
              Write this down now — it is hashed on save and cannot be read back.
            </p>
          )}
          {fieldErrors.pin ? (
            <p className="mt-1 text-xs text-accent-danger">{fieldErrors.pin}</p>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="client-goal">
              Primary goal
            </label>
            <select
              id="client-goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value as PrimaryGoal)}
              className="w-full"
            >
              {PRIMARY_GOALS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="client-account">
              Meta ad account ID
            </label>
            <input
              id="client-account"
              value={adAccountId}
              onChange={(event) => setAdAccountId(event.target.value)}
              placeholder="act_123456789"
              className="w-full"
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="client-token">
            Meta access token (optional)
          </label>
          <input
            id="client-token"
            type="password"
            value={metaToken}
            onChange={(event) => setMetaToken(event.target.value)}
            placeholder={isEdit ? 'Leave blank to keep current' : 'Falls back to META_ACCESS_TOKEN'}
            className="w-full"
            autoComplete="off"
          />
          <p className="mt-1 text-xs text-cream-100/40">
            Encrypted before storage. Leave blank to use the account-wide token from .env.local.
          </p>
        </div>

        {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
      </form>
    </Modal>
  );
}
