'use client';

import Link from 'next/link';
import { LogOut, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';

export function BoldstepMark({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn('flex items-center gap-2.5', className)}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cream-100 text-sm font-bold text-navy-700">
        B
      </span>
      <span className="text-base font-semibold tracking-tight text-cream-100">Boldstep</span>
    </Link>
  );
}

interface NavbarProps {
  title: string;
  subtitle?: string;
  onLogout?: () => void;
  onToggleSidebar?: () => void;
  children?: React.ReactNode;
}

export default function Navbar({
  title,
  subtitle,
  onLogout,
  onToggleSidebar,
  children,
}: NavbarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-surface-border bg-navy-950/85 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        {onToggleSidebar ? (
          <button
            type="button"
            className="btn-ghost -ml-2 px-2 py-1.5 lg:hidden"
            onClick={onToggleSidebar}
            aria-label="Toggle navigation"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
        ) : null}

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-cream-100 sm:text-lg">{title}</h1>
          {subtitle ? (
            <p className="truncate text-xs text-cream-100/50 sm:text-sm">{subtitle}</p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {children}
          {onLogout ? (
            <button type="button" className="btn-ghost" onClick={onLogout}>
              <LogOut className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Log out</span>
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
