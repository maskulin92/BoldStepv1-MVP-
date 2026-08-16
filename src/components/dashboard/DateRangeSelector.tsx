'use client';

import { DATE_PRESETS, type DatePresetValue } from '@/constants/form-options';
import { cn } from '@/lib/utils';

export default function DateRangeSelector({
  value,
  onChange,
  className,
}: {
  value: DatePresetValue;
  onChange: (preset: DatePresetValue, days: number) => void;
  className?: string;
}) {
  return (
    <div
      className={cn('flex rounded-lg border border-surface-border p-0.5', className)}
      role="group"
      aria-label="Date range"
    >
      {DATE_PRESETS.map((preset) => (
        <button
          key={preset.value}
          type="button"
          aria-pressed={value === preset.value}
          onClick={() => onChange(preset.value, preset.days)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition sm:px-3',
            value === preset.value
              ? 'bg-cream-100 text-navy-900'
              : 'text-cream-100/55 hover:text-cream-100',
          )}
        >
          {preset.value.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
