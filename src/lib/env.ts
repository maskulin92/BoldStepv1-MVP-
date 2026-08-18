import 'server-only';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Central environment access.
 *
 * Nothing else in the codebase reads `process.env` for a secret. Each service
 * exposes an `isConfigured` flag; when it is false the corresponding library
 * falls back to mock behaviour so the app is fully usable before any
 * credential exists (see SECTION 10 of the brief).
 */

const isPlaceholder = (value: string | undefined): boolean => {
  if (!value) return true;
  const v = value.trim();
  if (v === '') return true;
  return (
    v.startsWith('YOUR_') ||
    v.startsWith('act_XXXX') ||
    v === 'placeholder' ||
    v === 'sk-ant-YOUR_KEY' ||
    v.includes('MIIEv...')
  );
};

const read = (key: string): string | undefined => {
  const value = process.env[key];
  return isPlaceholder(value) ? undefined : value?.trim();
};

export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Dev-only fallback so `npm run dev` works with an empty .env.local.
 *
 * The key is generated once and cached on disk under `.next/cache` (which is
 * git-ignored). Holding it only in memory is not enough: Next.js compiles each
 * route into its own module instance in dev, so an in-memory key differs
 * between the route that signs a token and the route that verifies it, and
 * every request would come back 401.
 */
let devJwtSecret: string | null = null;

const devSecretPath = (): string => join(process.cwd(), '.next', 'cache', 'boldstep-dev-secret');

const jwtSecretFallback = (): string => {
  if (IS_PRODUCTION) {
    throw new Error(
      'JWT_SECRET is required in production. Generate one with: npm run hash -- --secrets',
    );
  }
  if (devJwtSecret) return devJwtSecret;

  const path = devSecretPath();
  try {
    if (existsSync(path)) {
      const cached = readFileSync(path, 'utf8').trim();
      if (cached.length >= 32) {
        devJwtSecret = cached;
        return devJwtSecret;
      }
    }
    devJwtSecret = randomBytes(48).toString('base64url');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, devJwtSecret, { encoding: 'utf8' });
    console.warn(
      '[boldstep] JWT_SECRET is not set — generated a local development key at .next/cache/boldstep-dev-secret. Set JWT_SECRET in .env.local before deploying.',
    );
  } catch {
    // Read-only filesystem: fall back to an in-process key and accept that
    // sessions may not survive a recompile in dev.
    devJwtSecret = devJwtSecret ?? randomBytes(48).toString('base64url');
  }
  return devJwtSecret;
};

const firebaseAdminProjectId = read('FIREBASE_PROJECT_ID');
const firebaseAdminClientEmail = read('FIREBASE_CLIENT_EMAIL');
const firebaseAdminPrivateKey = read('FIREBASE_PRIVATE_KEY');

let devEncryptionKey: string | null = null;

const devEncryptionKeyPath = (): string =>
  join(process.cwd(), '.next', 'cache', 'boldstep-dev-encryption-key');

const devEncryptionKeyFallback = (): string => {
  if (devEncryptionKey) return devEncryptionKey;

  const path = devEncryptionKeyPath();
  try {
    if (existsSync(path)) {
      const cached = readFileSync(path, 'utf8').trim();
      if (cached.length >= 32) {
        devEncryptionKey = cached;
        return devEncryptionKey;
      }
    }
    devEncryptionKey = randomBytes(32).toString('base64url');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, devEncryptionKey, { encoding: 'utf8' });
    console.warn(
      '[boldstep] ENCRYPTION_KEY is not set — generated a local development key at .next/cache/boldstep-dev-encryption-key. Set ENCRYPTION_KEY in .env.local before deploying.',
    );
  } catch {
    devEncryptionKey = devEncryptionKey ?? randomBytes(32).toString('base64url');
  }
  return devEncryptionKey;
};

export const env = {
  appUrl: read('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3000',

  jwt: {
    get secret(): string {
      return read('JWT_SECRET') ?? jwtSecretFallback();
    },
    ownerTtl: '7d',
    clientTtl: '30d',
  },

  encryption: {
    /**
     * Independent from JWT_SECRET by design: this key encrypts Meta access
     * tokens at rest, and reusing the session-signing key would let anyone
     * holding it both forge sessions and decrypt stored tokens. In dev an
     * ephemeral key is generated (tokens encrypted earlier become unreadable
     * after a restart — acceptable locally); production refuses to start
     * without a real value.
     */
    get key(): string {
      const explicit = read('ENCRYPTION_KEY');
      if (explicit) return explicit;
      if (IS_PRODUCTION) {
        throw new Error(
          'ENCRYPTION_KEY is required in production and must be a separate secret from JWT_SECRET. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
        );
      }
      return devEncryptionKeyFallback();
    },
  },

  firebaseAdmin: {
    projectId: firebaseAdminProjectId,
    clientEmail: firebaseAdminClientEmail,
    // The JSON download stores newlines as literal "\n" — unescape them.
    privateKey: firebaseAdminPrivateKey?.replace(/\\n/g, '\n'),
    storageBucket:
      read('FIREBASE_STORAGE_BUCKET') ?? read('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'),
    isConfigured: Boolean(
      firebaseAdminProjectId && firebaseAdminClientEmail && firebaseAdminPrivateKey,
    ),
  },

  meta: {
    /**
     * Meta tokens are NOT read from the environment anymore — they live
     * encrypted per-account in Firestore, set via the dashboard. Only the
     * shared ad account id (not a secret) may be set here as a default.
     */
    adAccountId: read('META_AD_ACCOUNT_ID'),
    apiVersion: read('META_API_VERSION') ?? 'v21.0',
    /** Facebook Page id for ad creative object_story_spec. */
    pageId: read('META_PAGE_ID'),
    get appUrl(): string {
      return read('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3000';
    },
    get isConfigured(): boolean {
      const id = read('META_AD_ACCOUNT_ID');
      return Boolean(id && id !== 'act_XXXXXXXXX' && id !== 'YOUR_AD_ACCOUNT_ID');
    },
  },

  glm: {
    apiKey: read('GLM_API_KEY'),
    // Z.ai's API endpoint is /api/paas/v4 — NOT an OpenAI-style /v1.
    baseUrl: read('GLM_API_BASE') ?? 'https://api.z.ai/api/paas/v4',
    // glm-5.3 is Coding-Plan-only for now; glm-5.2 is the flagship available
    // through the public API. Set GLM_MODEL=glm-5.3 once its API ships.
    model: read('GLM_MODEL') ?? 'glm-5.2',
    get isConfigured(): boolean {
      return Boolean(read('GLM_API_KEY'));
    },
  },

  claude: {
    apiKey: read('CLAUDE_API_KEY'),
    model: read('CLAUDE_MODEL') ?? 'claude-haiku-4-5-20251001',
    get isConfigured(): boolean {
      return Boolean(read('CLAUDE_API_KEY'));
    },
  },

  telegram: {
    botToken: read('TELEGRAM_BOT_TOKEN'),
    chatId: read('TELEGRAM_CHAT_ID'),
    get isConfigured(): boolean {
      return Boolean(read('TELEGRAM_BOT_TOKEN') && read('TELEGRAM_CHAT_ID'));
    },
  },

  owner: {
    email: read('OWNER_EMAIL') ?? 'fadhil@boldstep.my',
    passwordHash: read('OWNER_PASSWORD_HASH'),
  },

  hermes: {
    apiKey: read('HERMES_API_KEY'),
  },
} as const;

/**
 * Mock mode: on whenever Firestore is unreachable.
 *
 * Hard-disabled in production unless BOLDSTEP_ALLOW_MOCK=true is set
 * explicitly — a deployed app must never silently serve fabricated numbers.
 */
export const MOCK_MODE: boolean = (() => {
  if (env.firebaseAdmin.isConfigured) return false;
  if (!IS_PRODUCTION) return true;
  return process.env.BOLDSTEP_ALLOW_MOCK === 'true';
})();

/** Throws at request time (not build time) if a prod deploy is misconfigured. */
export function assertRuntimeConfig(): void {
  if (!IS_PRODUCTION) return;
  if (!env.firebaseAdmin.isConfigured && process.env.BOLDSTEP_ALLOW_MOCK !== 'true') {
    throw new Error(
      'Firebase Admin credentials are missing in production. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY, or set BOLDSTEP_ALLOW_MOCK=true to knowingly run a demo build.',
    );
  }
}

export function configReport() {
  return {
    mock_mode: MOCK_MODE,
    environment: process.env.NODE_ENV ?? 'development',
    services: {
      firestore: env.firebaseAdmin.isConfigured,
      storage: Boolean(env.firebaseAdmin.isConfigured && env.firebaseAdmin.storageBucket),
      meta_ads: env.meta.isConfigured,
      glm: env.glm.isConfigured,
      claude: env.claude.isConfigured,
      telegram: env.telegram.isConfigured,
    },
  };
}
