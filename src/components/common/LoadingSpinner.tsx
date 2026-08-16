import { cn } from '@/lib/utils';

export function LoadingSpinner({
  className,
  size = 'md',
  label,
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}) {
  const dimension = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-8 w-8' : 'h-6 w-6';
  return (
    <span className={cn('inline-flex items-center gap-2', className)} role="status">
      <span
        className={cn(
          dimension,
          'animate-spin rounded-full border-2 border-cream-100/25 border-t-cream-100',
        )}
        aria-hidden
      />
      {label ? <span className="text-sm text-cream-100/60">{label}</span> : null}
      <span className="sr-only">{label ?? 'Loading'}</span>
    </span>
  );
}

/** Panel-sized loading state. */
export function LoadingPanel({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center py-16', className)}>
      <LoadingSpinner size="lg" label={label} />
    </div>
  );
}

/** Shimmer placeholder used while cards and tables resolve. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-cream-100/10', className)} />;
}

export default LoadingSpinner;
