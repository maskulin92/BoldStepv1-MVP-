'use client';

import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes so a single broken widget doesn't blank the app.
 * Async/data errors are handled per-hook; this is the last line of defence.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[boldstep] render error:', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <div className="card w-full max-w-md p-6 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-accent-danger" aria-hidden />
          <h2 className="text-lg font-semibold text-cream-100">Something broke on this screen</h2>
          <p className="mt-2 text-sm text-cream-100/60">
            {this.state.error.message || 'An unexpected rendering error occurred.'}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <button type="button" className="btn-secondary" onClick={this.reset}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              Try again
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
