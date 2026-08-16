'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BoldstepMark } from '@/components/common/Navbar';
import { InlineNotice } from '@/components/common/States';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { describeAuthError, useAuth } from '@/hooks/useAuth';
import { DEMO_PIN_HINTS } from '@/constants/demo';

const LENGTH = 6;

/**
 * Client access: the link identifies the account, a 6-digit PIN authenticates.
 * Six separate inputs so it behaves like a normal OTP field on mobile.
 */
export default function LinkPinAuth({
  linkId,
  mockMode,
}: {
  linkId: string;
  mockMode: boolean;
}) {
  const router = useRouter();
  const { loginClient } = useAuth();

  const [digits, setDigits] = useState<string[]>(Array(LENGTH).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const pin = digits.join('');

  const submit = async (value: string) => {
    if (value.length !== LENGTH || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await loginClient(linkId, value);
      router.push(`/dashboard/client/${linkId}`);
      router.refresh();
    } catch (err) {
      setError(describeAuthError(err));
      setDigits(Array(LENGTH).fill(''));
      inputs.current[0]?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  const setDigit = (index: number, raw: string) => {
    const value = raw.replace(/\D/g, '');
    if (!value) {
      setDigits((prev) => prev.map((d, i) => (i === index ? '' : d)));
      return;
    }

    setDigits((prev) => {
      const next = [...prev];
      // Handle a pasted or autofilled block, not just a single keystroke.
      for (let offset = 0; offset < value.length && index + offset < LENGTH; offset += 1) {
        next[index + offset] = value[offset];
      }
      const filled = next.join('');
      if (filled.length === LENGTH && !filled.includes('')) {
        void submit(filled);
      }
      return next;
    });

    const nextIndex = Math.min(index + value.length, LENGTH - 1);
    inputs.current[nextIndex]?.focus();
  };

  const onKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowLeft' && index > 0) inputs.current[index - 1]?.focus();
    if (event.key === 'ArrowRight' && index < LENGTH - 1) inputs.current[index + 1]?.focus();
  };

  const demoPin = DEMO_PIN_HINTS[linkId];

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <BoldstepMark className="mb-8 justify-center" />

        <div className="card p-6 sm:p-8">
          <h1 className="text-xl font-semibold text-cream-100">Enter your access code</h1>
          <p className="mt-1.5 text-sm text-cream-100/55">
            6-digit code for your Boldstep reporting dashboard.
          </p>

          <form
            className="mt-6"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(pin);
            }}
          >
            <div className="flex justify-between gap-2" role="group" aria-label="6-digit access code">
              {digits.map((digit, index) => (
                <input
                  key={index}
                  ref={(element) => {
                    inputs.current[index] = element;
                  }}
                  type="text"
                  inputMode="numeric"
                  autoComplete={index === 0 ? 'one-time-code' : 'off'}
                  maxLength={LENGTH}
                  value={digit}
                  disabled={submitting}
                  aria-label={`Digit ${index + 1}`}
                  onChange={(event) => setDigit(index, event.target.value)}
                  onKeyDown={(event) => onKeyDown(index, event)}
                  onFocus={(event) => event.target.select()}
                  className="h-14 w-full min-w-0 text-center font-mono text-xl"
                />
              ))}
            </div>

            {error ? (
              <InlineNotice tone="danger" className="mt-4">
                {error}
              </InlineNotice>
            ) : null}

            <button
              type="submit"
              className="btn-primary mt-5 w-full"
              disabled={submitting || pin.length !== LENGTH}
            >
              {submitting ? <LoadingSpinner size="sm" /> : null}
              {submitting ? 'Verifying…' : 'View my dashboard'}
            </button>
          </form>

          {mockMode && demoPin ? (
            <div className="mt-6 rounded-lg border border-surface-border bg-navy-950/50 p-3.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-cream-100/45">
                Mock mode — demo code
              </p>
              <p className="mt-2 font-mono text-lg tracking-[0.3em] text-cream-100/85">{demoPin}</p>
            </div>
          ) : null}

          <p className="mt-6 text-center text-xs text-cream-100/40">
            Lost your code? Contact your account manager.
          </p>
        </div>
      </div>
    </div>
  );
}
