'use client';

import { useState } from 'react';
import { Check, Copy, Pencil, Trash2 } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { InlineNotice } from '@/components/common/States';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { API } from '@/constants/api-endpoints';
import { ApiClientError, apiDelete } from '@/lib/api-client';
import type { PublicClient } from '@/types';

/**
 * Header strip above Section A: shows the selected client's shareable link and
 * exposes Edit / Delete.
 */
export default function ClientManageBar({
  client,
  onEdit,
  onDeleted,
  extra,
}: {
  client: PublicClient;
  onEdit: () => void;
  onDeleted: (clientId: string) => void;
  /** Optional extra control (e.g. "New campaign") rendered with the actions. */
  extra?: React.ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const accessPath = `/auth/client/${client.link_id}`;

  const copyLink = async () => {
    const url = `${window.location.origin}${accessPath}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard needs a secure context; the link is visible to copy by hand.
      setError('Could not copy automatically — select the link and copy it manually.');
    }
  };

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      await apiDelete(`${API.clients.detail(client.id)}?confirm=${encodeURIComponent(client.name)}`);
      setConfirming(false);
      onDeleted(client.id);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not delete this client.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="card flex flex-wrap items-center gap-3 p-3 sm:p-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-cream-100">{client.name}</p>
          <div className="mt-0.5 flex items-center gap-2">
            <code className="truncate text-xs text-cream-100/45">{accessPath}</code>
            <button
              type="button"
              onClick={() => void copyLink()}
              className="shrink-0 rounded p-1 text-cream-100/40 transition hover:text-cream-100"
              aria-label="Copy client access link"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-accent-success" aria-hidden />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          {extra}
          <button type="button" className="btn-secondary" onClick={onEdit}>
            <Pencil className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Edit</span>
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={() => {
              setTyped('');
              setError(null);
              setConfirming(true);
            }}
            disabled={client.is_owner}
            title={client.is_owner ? 'The owner account cannot be deleted' : undefined}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Delete</span>
          </button>
        </div>
      </div>

      {error && !confirming ? (
        <InlineNotice tone="danger" className="mt-2">
          {error}
        </InlineNotice>
      ) : null}

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Delete this client?"
        description={client.name}
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setConfirming(false)}
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => void remove()}
              disabled={deleting || typed !== client.name}
            >
              {deleting ? <LoadingSpinner size="sm" /> : null}
              Delete permanently
            </button>
          </>
        }
      >
        <InlineNotice tone="danger" className="mb-4">
          This cannot be undone. Every campaign, ad set, insight, approval, manual entry and
          uploaded creative for this client is deleted too.
        </InlineNotice>

        <label className="label" htmlFor="confirm-name">
          Type <span className="font-semibold text-cream-100">{client.name}</span> to confirm
        </label>
        <input
          id="confirm-name"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          className="w-full"
          autoComplete="off"
        />

        {error ? (
          <InlineNotice tone="danger" className="mt-4">
            {error}
          </InlineNotice>
        ) : null}
      </Modal>
    </>
  );
}
