/** Single source of truth for every route the browser calls.
 *  Keeps the client bundle from hardcoding path strings in a dozen places. */
export const API = {
  auth: {
    login: '/api/auth/login',
    verifyPin: '/api/auth/verify-pin',
    logout: '/api/auth/logout',
    me: '/api/auth/me',
  },
  clients: {
    list: '/api/clients',
    detail: (clientId: string) => `/api/clients/${clientId}`,
  },
  campaigns: {
    list: (clientId: string) => `/api/campaigns/${clientId}`,
    detail: (clientId: string, campaignId: string) => `/api/campaigns/${clientId}/${campaignId}`,
  },
  meta: {
    insights: (clientId: string) => `/api/meta/insights/${clientId}`,
    sync: '/api/meta/sync',
  },
  approvals: {
    list: '/api/approvals',
    decide: (actionId: string) => `/api/approvals/${actionId}`,
  },
  hermes: {
    chat: '/api/hermes/chat',
    settings: '/api/hermes/settings',
    memory: '/api/hermes/memory',
    execute: '/api/hermes/execute',
  },
  creatives: {
    upload: '/api/creatives/upload',
    list: (clientId: string) => `/api/creatives/${clientId}`,
    download: (creativeId: string) => `/api/creatives/download/${creativeId}`,
    review: (creativeId: string) => `/api/creatives/review/${creativeId}`,
  },
  manualEntry: {
    create: '/api/manual-entry',
    list: (clientId: string) => `/api/manual-entry/${clientId}`,
    review: (entryId: string) => `/api/manual-entry/review/${entryId}`,
  },
  reports: {
    pdf: '/api/reports/pdf',
    csv: '/api/reports/csv',
  },
  integrations: {
    generateKey: '/api/integrations/auth/generate-key',
    verifyKey: '/api/integrations/auth/verify',
    registerWebhook: '/api/integrations/webhooks/register',
    listWebhooks: '/api/integrations/webhooks/list',
    exportCampaigns: (clientId: string) => `/api/integrations/export/campaigns/${clientId}`,
    exportInsights: (clientId: string) => `/api/integrations/export/insights/${clientId}`,
    syncCrm: '/api/integrations/sync/crm',
    syncConversions: '/api/integrations/sync/conversions',
  },
  health: '/api/health',
} as const;

export const API_VERSION = '1.0.0';
