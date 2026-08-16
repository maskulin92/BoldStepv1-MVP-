import { AlertCircle, Inbox, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Shared empty state — every list and table uses this rather than blank space. */
export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-3 rounded-full bg-cream-100/5 p-3 text-cream-100/40">
        {icon ?? <Inbox className="h-6 w-6" aria-hidden />}
      </div>
      <p className="text-sm font-medium text-cream-100/85">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-cream-100/50">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** Shared error state with a retry affordance. */
export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <AlertCircle className="mb-3 h-6 w-6 text-accent-danger" aria-hidden />
      <p className="text-sm font-medium text-cream-100/90">Could not load this</p>
      <p className="mt-1.5 max-w-md text-sm text-cream-100/55">{message}</p>
      {onRetry ? (
        <button type="button" className="btn-secondary mt-4" onClick={onRetry}>
          <RotateCcw className="h-4 w-4" aria-hidden />
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function InlineNotice({
  tone = 'info',
  children,
  className,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  children: React.ReactNode;
  className?: string;
}) {
  const tones: Record<string, string> = {
    info: 'border-accent-info/30 bg-accent-info/10 text-accent-info',
    success: 'border-accent-success/30 bg-accent-success/10 text-accent-success',
    warning: 'border-accent-warning/30 bg-accent-warning/10 text-accent-warning',
    danger: 'border-accent-danger/30 bg-accent-danger/10 text-accent-danger',
  };
  return (
    <div className={cn('rounded-lg border px-3.5 py-2.5 text-sm', tones[tone], className)}>
      {children}
    </div>
  );
}
