'use client';

import { Building2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/common/LoadingSpinner';
import type { PublicClient } from '@/types';

/** Client list in the owner sidebar (Section A). */
export default function ClientSelector({
  clients,
  selectedId,
  onSelect,
  onAdd,
  loading,
}: {
  clients: PublicClient[];
  selectedId: string | null;
  onSelect: (accountId: string) => void;
  onAdd?: () => void;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-11 w-full" />
        ))}
      </div>
    );
  }

  const addButton = onAdd ? (
    <button
      type="button"
      onClick={onAdd}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-cream-100/70 transition hover:bg-cream-100/10 hover:text-cream-100"
    >
      <Plus className="h-3.5 w-3.5" aria-hidden />
      Add
    </button>
  ) : null;

  if (clients.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="text-sm text-cream-100/45">No accounts yet.</p>
        {onAdd ? (
          <button type="button" className="btn-secondary mt-3" onClick={onAdd}>
            <Plus className="h-4 w-4" aria-hidden />
            Add your first account
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-cream-100/40">
          Accounts ({clients.length})
        </p>
        {addButton}
      </div>
      <ul className="space-y-1">
        {clients.map((client) => {
          const active = client.id === selectedId;
          return (
            <li key={client.id}>
              <button
                type="button"
                onClick={() => onSelect(client.id)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition',
                  active
                    ? 'bg-cream-100/15 text-cream-100'
                    : 'text-cream-100/65 hover:bg-cream-100/10 hover:text-cream-100',
                )}
              >
                <Building2 className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{client.name}</span>
                  <span className="block truncate text-xs text-cream-100/40">
                    {client.primary_goal}
                    {client.is_owner ? ' · own account' : ''}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
