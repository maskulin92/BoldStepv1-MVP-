'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { BoldstepMark } from '@/components/common/Navbar';
import { InlineNotice } from '@/components/common/States';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { describeAuthError, useAuth } from '@/hooks/useAuth';

export default function OwnerLogin({ mockMode }: { mockMode: boolean }) {
  const router = useRouter();
  const { loginOwner } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await loginOwner(email.trim(), password);
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <BoldstepMark className="mb-8 justify-center" />

        <div className="card p-6 sm:p-8">
          <h1 className="text-xl font-semibold text-cream-100">Owner sign in</h1>
          <p className="mt-1.5 text-sm text-cream-100/55">
            Full control: client monitoring, approvals and Hermes.
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cream-100/35"
                  aria-hidden
                />
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="fadhil@boldstep.my"
                  className="w-full pl-9"
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cream-100/35"
                  aria-hidden
                />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-cream-100/40 hover:text-cream-100/80"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden />
                  )}
                </button>
              </div>
            </div>

            {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? <LoadingSpinner size="sm" /> : null}
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {mockMode ? (
            <div className="mt-6 rounded-lg border border-surface-border bg-navy-950/50 p-3.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-cream-100/45">
                Mock mode — demo credentials
              </p>
              <p className="mt-2 font-mono text-sm text-cream-100/80">fadhil@boldstep.my</p>
              <p className="font-mono text-sm text-cream-100/80">boldstep123</p>
              <p className="mt-2 text-xs text-cream-100/45">
                Available only because Firebase credentials are not configured. Set
                OWNER_PASSWORD_HASH in .env.local to use your own.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
