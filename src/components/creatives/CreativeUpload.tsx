'use client';

import { useRef, useState } from 'react';
import { CloudUpload, X } from 'lucide-react';
import { API } from '@/constants/api-endpoints';
import { ApiClientError, apiUpload } from '@/lib/api-client';
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from '@/constants/form-options';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { InlineNotice } from '@/components/common/States';
import { cn, formatBytes } from '@/lib/utils';
import type { Campaign } from '@/types';

export default function CreativeUpload({
  clientId,
  campaigns,
  onUploaded,
}: {
  clientId: string;
  campaigns: Campaign[];
  onUploaded?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? '');
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const accept = ALLOWED_UPLOAD_TYPES.join(',');

  const pick = (candidate: File | null | undefined) => {
    setError(null);
    setSuccess(null);
    if (!candidate) return;

    if (candidate.size > MAX_UPLOAD_BYTES) {
      setError(`That file is ${formatBytes(candidate.size)} — the limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`);
      return;
    }
    if (!ALLOWED_UPLOAD_TYPES.includes(candidate.type as (typeof ALLOWED_UPLOAD_TYPES)[number])) {
      setError(`"${candidate.type || 'unknown type'}" is not an accepted creative format.`);
      return;
    }
    setFile(candidate);
  };

  const upload = async () => {
    if (!file || !campaignId) return;
    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('client_id', clientId);
      form.append('campaign_id', campaignId);

      await apiUpload(API.creatives.upload, form);

      setSuccess(`${file.name} uploaded. The download link is valid for 7 days.`);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      onUploaded?.();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="card p-4 sm:p-5">
      <h2 className="mb-4 text-sm font-semibold text-cream-100">Upload creative</h2>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          pick(event.dataTransfer.files?.[0]);
        }}
        className={cn(
          'rounded-xl border-2 border-dashed p-6 text-center transition',
          dragging ? 'border-accent-info bg-accent-info/5' : 'border-surface-border',
        )}
      >
        <CloudUpload className="mx-auto h-7 w-7 text-cream-100/35" aria-hidden />
        <p className="mt-2 text-sm text-cream-100/75">
          Drag a file here, or{' '}
          <button
            type="button"
            className="font-medium text-accent-info underline-offset-2 hover:underline"
            onClick={() => inputRef.current?.click()}
          >
            browse
          </button>
        </p>
        <p className="mt-1 text-xs text-cream-100/40">
          JPG, PNG, WebP, GIF, MP4, MOV or WebM · up to {formatBytes(MAX_UPLOAD_BYTES)}
        </p>

        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(event) => pick(event.target.files?.[0])}
        />
      </div>

      {file ? (
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-surface-border bg-navy-950/40 px-3 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-cream-100">{file.name}</span>
            <span className="block text-xs text-cream-100/45">{formatBytes(file.size)}</span>
          </span>
          <button
            type="button"
            className="btn-ghost px-2 py-1"
            onClick={() => {
              setFile(null);
              if (inputRef.current) inputRef.current.value = '';
            }}
            aria-label="Remove selected file"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}

      <div className="mt-4">
        <label className="label" htmlFor="creative-campaign">
          Campaign
        </label>
        <select
          id="creative-campaign"
          value={campaignId}
          onChange={(event) => setCampaignId(event.target.value)}
          className="w-full"
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

      {error ? (
        <InlineNotice tone="danger" className="mt-3">
          {error}
        </InlineNotice>
      ) : null}
      {success ? (
        <InlineNotice tone="success" className="mt-3">
          {success}
        </InlineNotice>
      ) : null}

      <button
        type="button"
        className="btn-primary mt-4 w-full sm:w-auto"
        onClick={() => void upload()}
        disabled={!file || !campaignId || uploading}
      >
        {uploading ? <LoadingSpinner size="sm" /> : <CloudUpload className="h-4 w-4" aria-hidden />}
        {uploading ? 'Uploading…' : 'Upload creative'}
      </button>
    </section>
  );
}
