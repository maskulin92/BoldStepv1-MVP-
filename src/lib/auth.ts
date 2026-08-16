import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from './env';
import type { Permission, Role, SessionPayload } from '@/types/auth';

const ISSUER = 'boldstep';
const AUDIENCE = 'boldstep-dashboard';

const secretKey = (): Uint8Array => new TextEncoder().encode(env.jwt.secret);

/* ------------------------------------------------------------------- JWT */

export async function signSession(
  payload: Omit<SessionPayload, 'iat' | 'exp'>,
  ttl: string,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(payload.sub)
    .setExpirationTime(ttl)
    .sign(secretKey());
}

export function signOwnerSession(userId: string, email: string, permissions: Permission[]) {
  return signSession({ sub: userId, role: 'owner', email, permissions }, env.jwt.ownerTtl);
}

export function signClientSession(clientId: string, name: string) {
  return signSession(
    // `write` here means "propose data", never "publish it" — every client
    // submission still routes through the owner review queue before it can
    // touch metrics or the visible library.
    { sub: clientId, role: 'client', client_id: clientId, email: name, permissions: ['read', 'write'] },
    env.jwt.clientTtl,
  );
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') return null;
    return {
      sub: payload.sub,
      role: payload.role as Role,
      client_id: typeof payload.client_id === 'string' ? payload.client_id : undefined,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      permissions: Array.isArray(payload.permissions) ? (payload.permissions as Permission[]) : [],
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------- PIN */

/** SHA-256 of the PIN, per the schema in the brief (`access_pin_hash`). */
export function hashPin(pin: string): string {
  return createHash('sha256').update(pin.trim()).digest('hex');
}

export function verifyPin(pin: string, expectedHash: string): boolean {
  return safeCompare(hashPin(pin), expectedHash);
}

export function isValidPinFormat(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{6}$/.test(pin.trim());
}

/* -------------------------------------------------------------- passwords */

/**
 * scrypt with a per-password salt, stored as `scrypt$N$salt$hash`.
 * Chosen over bcrypt so the project has zero native build steps on Windows.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$16384$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const [, , salt, expected] = parts;
  try {
    const derived = scryptSync(password, salt, 64).toString('hex');
    return safeCompare(derived, expected);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------- API keys */

export const API_KEY_PREFIX = 'boldstep_sk_';

export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const raw = randomBytes(24).toString('hex');
  const plaintext = `${API_KEY_PREFIX}${raw}`;
  return {
    plaintext,
    hash: hashApiKey(plaintext),
    // Enough to identify the key in a list without revealing it.
    prefix: `${API_KEY_PREFIX}${raw.slice(0, 6)}`,
  };
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key.trim()).digest('hex');
}

/* --------------------------------------------------- token encryption */

/**
 * AES-256-GCM for Meta access tokens at rest (`access_token_encrypted`).
 * Output: `v1:<iv>:<authTag>:<ciphertext>`, all base64url.
 */
const derivedKey = (): Buffer => scryptSync(env.encryption.key, 'boldstep-token-v1', 32);

export function encryptToken(plaintext: string): string {
  if (!plaintext) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derivedKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

export function decryptToken(payload: string): string | null {
  if (!payload) return null;
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      derivedKey(),
      Buffer.from(parts[1], 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- helpers */

export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
