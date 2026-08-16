import type { Metadata, Viewport } from 'next';
import './globals.css';
import ErrorBoundary from '@/components/common/ErrorBoundary';

export const metadata: Metadata = {
  title: {
    default: 'Boldstep',
    template: '%s · Boldstep',
  },
  description: 'AI-powered multi-client Meta Ads management system.',
  applicationName: 'Boldstep',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#1e3a8a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}
