import ErrorBoundary from '@/components/common/ErrorBoundary';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
