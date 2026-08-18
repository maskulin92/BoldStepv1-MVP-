'use client';

import { Bot, Building2, LayoutDashboard, X } from 'lucide-react';
import { BoldstepMark } from './Navbar';
import { cn } from '@/lib/utils';

export type OwnerSection = 'clients' | 'own' | 'hermes';

const SECTIONS: { id: OwnerSection; label: string; hint: string; icon: React.ReactNode }[] = [
  {
    id: 'clients',
    label: 'Your Accounts',
    hint: 'Monitor every account',
    icon: <Building2 className="h-4 w-4" aria-hidden />,
  },
  {
    id: 'own',
    label: 'Main Account',
    hint: 'Boldstep house ads',
    icon: <LayoutDashboard className="h-4 w-4" aria-hidden />,
  },
  {
    id: 'hermes',
    label: 'Hermes Control',
    hint: 'Chat, memory, settings',
    icon: <Bot className="h-4 w-4" aria-hidden />,
  },
];

interface SidebarProps {
  section: OwnerSection;
  onSectionChange: (section: OwnerSection) => void;
  pendingCount: number;
  open: boolean;
  onClose: () => void;
  footer?: React.ReactNode;
  children?: React.ReactNode;
}

export default function Sidebar({
  section,
  onSectionChange,
  pendingCount,
  open,
  onClose,
  footer,
  children,
}: SidebarProps) {
  return (
    <>
      {/* Scrim — mobile only, where the sidebar overlays content. */}
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-navy-950/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          role="presentation"
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-surface-border bg-navy-950/95 transition-transform duration-200',
          'lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between border-b border-surface-border px-4 py-4">
          <BoldstepMark />
          <button
            type="button"
            className="btn-ghost px-2 py-1 lg:hidden"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <nav className="space-y-1 p-3" aria-label="Dashboard sections">
          {SECTIONS.map((item) => {
            const active = item.id === section;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSectionChange(item.id);
                  onClose();
                }}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition',
                  active
                    ? 'bg-cream-100 text-navy-900'
                    : 'text-cream-100/70 hover:bg-cream-100/10 hover:text-cream-100',
                )}
              >
                <span className={active ? 'text-navy-700' : 'text-cream-100/50'}>{item.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{item.label}</span>
                  <span
                    className={cn(
                      'block text-xs',
                      active ? 'text-navy-700/70' : 'text-cream-100/40',
                    )}
                  >
                    {item.hint}
                  </span>
                </span>
                {item.id === 'own' && pendingCount > 0 ? (
                  <span className="rounded-full bg-accent-warning px-2 py-0.5 text-xs font-semibold text-navy-950">
                    {pendingCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-surface-border">
          {children}
        </div>

        {footer ? <div className="border-t border-surface-border p-3">{footer}</div> : null}
      </aside>
    </>
  );
}
