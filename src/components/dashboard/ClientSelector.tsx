'use client';

import { Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/common/LoadingSpinner';
import type { PublicClient } from '@/types';

/** Client list in the owner sidebar (Section A). */
export default function ClientSelector({
  clients,
  selectedId,
  onSelect,
  loading,
}: {
  clients: PublicClient[];
  selectedId: string | null;
  onSelect: (clientId: string) => void;
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

  if (clients.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-cream-100/45">
        No clients yet. Add one to the `clients` collection in Firestore.
      </p>
    );
  }

  return (
    <div className="p-3">
      <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-cream-100/40">
        Clients ({clients.length})
      </p>
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
