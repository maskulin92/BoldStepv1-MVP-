'use client';

import { useState } from 'react';
import { Brain, MessageSquare, Settings2, ShieldCheck } from 'lucide-react';
import HermesChat from './HermesChat';
import HermesSettings from './HermesSettings';
import MemoryViewer from './MemoryViewer';
import PendingApprovals from './PendingApprovals';
import { cn } from '@/lib/utils';
import type { PublicClient } from '@/types';

type Tab = 'chat' | 'approvals' | 'memory' | 'settings';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'chat', label: 'Chat', icon: <MessageSquare className="h-4 w-4" aria-hidden /> },
  { id: 'approvals', label: 'Approvals', icon: <ShieldCheck className="h-4 w-4" aria-hidden /> },
  { id: 'memory', label: 'Memory', icon: <Brain className="h-4 w-4" aria-hidden /> },
  { id: 'settings', label: 'Settings', icon: <Settings2 className="h-4 w-4" aria-hidden /> },
];

/** Section C of the owner dashboard. */
export default function HermesControlPanel({
  clients,
  defaultClientId,
  pendingCount,
}: {
  clients: PublicClient[];
  defaultClientId?: string | null;
  pendingCount: number;
}) {
  const [tab, setTab] = useState<Tab>('chat');

  return (
    <div className="space-y-4">
      <div
        className="flex flex-wrap gap-1 rounded-lg border border-surface-border p-1"
        role="tablist"
        aria-label="Hermes control panel"
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition',
              tab === item.id
                ? 'bg-cream-100 text-navy-900'
                : 'text-cream-100/60 hover:bg-cream-100/10 hover:text-cream-100',
            )}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.id === 'approvals' && pendingCount > 0 ? (
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs font-semibold',
                  tab === item.id
                    ? 'bg-navy-900 text-cream-100'
                    : 'bg-accent-warning text-navy-950',
                )}
              >
                {pendingCount}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'chat' ? (
        <HermesChat clients={clients} defaultClientId={defaultClientId} />
      ) : tab === 'approvals' ? (
        <PendingApprovals title="All pending approvals" />
      ) : tab === 'memory' ? (
        <MemoryViewer />
      ) : (
        <HermesSettings />
      )}
    </div>
  );
}
