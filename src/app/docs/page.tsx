import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { BoldstepMark } from '@/components/common/Navbar';
import { API } from '@/constants/api-endpoints';

export const metadata: Metadata = { title: 'API' };

const GROUPS: { title: string; note: string; rows: [string, string, string][] }[] = [
  {
    title: 'Auth',
    note: 'Public. Returns a JWT plus an httpOnly session cookie.',
    rows: [
      ['POST', API.auth.login, 'Owner login with email + password'],
      ['POST', API.auth.verifyPin, 'Client login with link id + 6-digit PIN'],
      ['POST', API.auth.logout, 'Clear the session cookie'],
      ['GET', API.auth.me, 'Resolve the current token to an identity'],
    ],
  },
  {
    title: 'Clients & campaigns',
    note: 'Bearer JWT. Client sessions are scoped to their own account.',
    rows: [
      ['GET', API.clients.list, 'List accessible clients'],
      ['GET', '/api/clients/{accountId}', 'Client record, recent campaigns, settings'],
      ['PUT', '/api/clients/{accountId}', 'Update a client (owner only)'],
      ['GET', '/api/campaigns/{accountId}', 'Campaigns with per-campaign totals'],
      ['GET', '/api/campaigns/{accountId}/{campaignId}', 'Ad sets, 7d/30d insights, open actions'],
    ],
  },
  {
    title: 'Insights & sync',
    note: 'The daily Meta pull runs from Hermes on a cron; these read and write what it stores.',
    rows: [
      ['GET', '/api/meta/insights/{accountId}', 'Daily insights, trend and summary'],
      ['POST', API.meta.sync, 'Pull from Meta and store (owner or Hermes key)'],
    ],
  },
  {
    title: 'Approvals',
    note: 'Owner only. Approving executes against Meta immediately.',
    rows: [
      ['GET', API.approvals.list, 'List actions by status'],
      ['POST', API.approvals.list, 'File a new suggestion (Hermes)'],
      ['POST', '/api/approvals/{actionId}', 'Approve, reject or modify'],
    ],
  },
  {
    title: 'Hermes',
    note: 'Owner only.',
    rows: [
      ['POST', API.hermes.chat, 'Ask about a client, with 14 days of context'],
      ['GET/PUT', API.hermes.settings, 'Frequency, auto-execute, channel'],
      ['GET', API.hermes.memory, 'Learned patterns and decision history'],
      ['POST', API.hermes.execute, 'Auto-execute (refused unless enabled)'],
    ],
  },
  {
    title: 'Creatives, entries, reports',
    rows: [
      ['POST', API.creatives.upload, 'Upload a creative (multipart)'],
      ['GET', '/api/creatives/{accountId}', 'Creative library'],
      ['GET', '/api/creatives/download/{creativeId}', 'Signed download, re-signed on expiry'],
      ['POST', API.manualEntry.create, 'Record offline conversion data'],
      ['GET', '/api/manual-entry/{accountId}', 'Manual entry history'],
      ['POST', API.reports.pdf, 'Generate a PDF report'],
      ['POST', API.reports.csv, 'Generate a CSV export'],
    ],
    note: 'Bearer JWT.',
  },
  {
    title: 'Integrations',
    note: 'Auth: Bearer boldstep_sk_… — 100 requests/minute per key.',
    rows: [
      ['POST', API.integrations.generateKey, 'Mint an API key (shown once)'],
      ['GET', API.integrations.verifyKey, 'Verify a key'],
      ['POST', API.integrations.registerWebhook, 'Register a webhook endpoint'],
      ['GET', API.integrations.listWebhooks, 'List registered webhooks'],
      ['GET', '/api/integrations/export/campaigns/{accountId}', 'Export campaigns (json|csv)'],
      ['GET', '/api/integrations/export/insights/{accountId}', 'Export insights (json|csv)'],
      ['POST', API.integrations.syncCrm, 'Ingest CRM records'],
      ['POST', API.integrations.syncConversions, 'Ingest offline conversions'],
    ],
  },
];

const METHOD_COLOURS: Record<string, string> = {
  GET: 'text-accent-success',
  POST: 'text-accent-info',
  PUT: 'text-accent-warning',
  'GET/PUT': 'text-accent-warning',
};

export default function DocsPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <BoldstepMark />

      <Link href="/" className="btn-ghost mt-8 -ml-3">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back
      </Link>

      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-cream-100">API reference</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cream-100/60">
        Every endpoint returns the same envelope:{' '}
        <code className="text-cream-100/85">{'{ success, data, meta }'}</code> on success,{' '}
        <code className="text-cream-100/85">{'{ success, error: { code, message }, meta }'}</code>{' '}
        on failure, and list endpoints add{' '}
        <code className="text-cream-100/85">pagination</code>. Full request and response examples
        live in <code className="text-cream-100/85">docs/API.md</code> in the repository.
      </p>

      <div className="mt-8 space-y-6">
        {GROUPS.map((group) => (
          <section key={group.title} className="card p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-cream-100">{group.title}</h2>
            {group.note ? <p className="mt-1 text-xs text-cream-100/45">{group.note}</p> : null}

            <ul className="mt-4 space-y-2">
              {group.rows.map(([method, path, description]) => (
                <li
                  key={`${method}-${path}-${description}`}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-surface-border pb-2 last:border-0 last:pb-0"
                >
                  <span
                    className={`w-16 shrink-0 font-mono text-xs font-semibold ${METHOD_COLOURS[method] ?? 'text-cream-100/60'}`}
                  >
                    {method}
                  </span>
                  <code className="font-mono text-xs text-cream-100/85">{path}</code>
                  <span className="text-xs text-cream-100/45">{description}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-8 text-xs text-cream-100/35">
        Health check: <code>GET {API.health}</code> reports which services are live vs mocked.
      </p>
    </main>
  );
}
