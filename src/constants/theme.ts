/** Boldstep brand tokens. Mirrors tailwind.config.ts — used where Tailwind
 *  classes can't reach (Recharts props, generated PDFs, inline SVG). */
export const THEME = {
  colors: {
    brandBlue: '#1e3a8a',
    brandCream: '#f5f3f0',
    surface: '#0b1533',
    surfaceRaised: '#132352',
    surfaceOverlay: '#182e6d',
    border: 'rgba(245, 243, 240, 0.12)',
    text: '#f5f3f0',
    textMuted: 'rgba(245, 243, 240, 0.62)',
    accent: '#f0b429',
    success: '#34d399',
    danger: '#f87171',
    warning: '#fbbf24',
    info: '#60a5fa',
  },
  chart: {
    spend: '#60a5fa',
    leads: '#34d399',
    cpl: '#f0b429',
    clicks: '#a78bfa',
    grid: 'rgba(245, 243, 240, 0.10)',
    axis: 'rgba(245, 243, 240, 0.55)',
  },
} as const;

export const CURRENCY = 'RM';

export const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-accent-success/15 text-accent-success border-accent-success/30',
  PAUSED: 'bg-accent-warning/15 text-accent-warning border-accent-warning/30',
  ARCHIVED: 'bg-cream-100/10 text-cream-100/60 border-cream-100/20',
  pending: 'bg-accent-warning/15 text-accent-warning border-accent-warning/30',
  approved: 'bg-accent-info/15 text-accent-info border-accent-info/30',
  executed: 'bg-accent-success/15 text-accent-success border-accent-success/30',
  rejected: 'bg-accent-danger/15 text-accent-danger border-accent-danger/30',
  failed: 'bg-accent-danger/15 text-accent-danger border-accent-danger/30',
};
