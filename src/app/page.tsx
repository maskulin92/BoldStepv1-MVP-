import Link from 'next/link';
import { ArrowRight, Bot, LineChart, ShieldCheck } from 'lucide-react';
import { BoldstepMark } from '@/components/common/Navbar';
import { MOCK_MODE, configReport } from '@/lib/env';
import { DEMO_CLIENT_LINKS } from '@/constants/demo';

export const dynamic = 'force-dynamic';

const FEATURES = [
  {
    icon: <LineChart className="h-5 w-5" aria-hidden />,
    title: 'Multi-client reporting',
    body: 'Campaign, ad set and daily insight history for every account, in one place.',
  },
  {
    icon: <Bot className="h-5 w-5" aria-hidden />,
    title: 'Hermes analysis',
    body: 'GLM reviews performance on a schedule and files suggestions with its reasoning.',
  },
  {
    icon: <ShieldCheck className="h-5 w-5" aria-hidden />,
    title: 'Approval workflow',
    body: 'Nothing reaches a live ad account until you approve it. Every decision is logged.',
  },
];

export default function HomePage() {
  const report = configReport();

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-10 sm:px-6">
      <BoldstepMark />

      <div className="flex flex-1 flex-col justify-center py-12">
        <p className="text-sm font-medium uppercase tracking-widest text-cream-100/40">
          Meta Ads management
        </p>
        <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight text-cream-100 sm:text-5xl">
          One system for every client&apos;s ads.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-cream-100/60">
          Boldstep pulls Meta Ads data for each client, has Hermes analyse it, and puts every
          proposed change in front of you before it runs.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/auth/owner" className="btn-primary">
            Owner sign in
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link href="/docs" className="btn-secondary">
            API documentation
          </Link>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="card p-5">
              <span className="text-cream-100/45">{feature.icon}</span>
              <h2 className="mt-3 text-sm font-semibold text-cream-100">{feature.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-cream-100/55">{feature.body}</p>
            </div>
          ))}
        </div>

        {MOCK_MODE ? (
          <div className="card mt-10 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-accent-warning">
              Mock mode
            </p>
            <p className="mt-2 text-sm text-cream-100/65">
              Firebase credentials are not configured, so the app is serving a generated dataset.
              Everything works — sign in, approve actions, upload creatives — and switches to real
              data the moment you fill in <code className="text-cream-100/85">.env.local</code>.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {DEMO_CLIENT_LINKS.map((client) => (
                <Link
                  key={client.link_id}
                  href={`/auth/client/${client.link_id}`}
                  className="btn-secondary text-xs"
                >
                  {client.name}
                </Link>
              ))}
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
              {Object.entries(report.services).map(([service, live]) => (
                <div key={service} className="flex items-center justify-between gap-2">
                  <dt className="text-cream-100/45">{service.replace(/_/g, ' ')}</dt>
                  <dd className={live ? 'text-accent-success' : 'text-cream-100/35'}>
                    {live ? 'live' : 'mock'}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </div>

      <footer className="border-t border-surface-border pt-6 text-xs text-cream-100/35">
        Boldstep · boldstep.my
      </footer>
    </main>
  );
}
