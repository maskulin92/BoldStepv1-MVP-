'use client';

import type { ApiFailure, ApiListSuccess, ApiSuccess, Pagination } from '@/types/api';

/**
 * Browser-side fetch wrapper.
 *
 * Every screen goes through the REST API rather than talking to Firestore
 * directly — that is what "API-first" buys: the dashboard is just the first
 * consumer of the same endpoints an integration would call.
 */

const TOKEN_KEY = 'boldstep_token';
const ROLE_KEY = 'boldstep_role';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string, role: 'owner' | 'client'): void {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(ROLE_KEY, role);
}

export function getStoredRole(): 'owner' | 'client' | null {
  if (typeof window === 'undefined') return null;
  const role = window.localStorage.getItem(ROLE_KEY);
  return role === 'owner' || role === 'client' ? role : null;
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(ROLE_KEY);
}

/** Thrown by `apiFetch` so callers can show `error.code` / `error.message`. */
export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

interface FetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Skip JSON encoding — used by the multipart upload path. */
  raw?: boolean;
}

async function request<T>(path: string, options: FetchOptions = {}): Promise<Response> {
  const { body, raw, headers, ...rest } = options;
  const token = getToken();

  const finalHeaders = new Headers(headers);
  if (token) finalHeaders.set('Authorization', `Bearer ${token}`);
  if (body !== undefined && !raw) finalHeaders.set('Content-Type', 'application/json');

  return fetch(path, {
    ...rest,
    headers: finalHeaders,
    credentials: 'include',
    body: raw ? (body as BodyInit) : body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function unwrap<T>(response: Response): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError(
      'INTERNAL_ERROR',
      `The server returned a non-JSON response (HTTP ${response.status}).`,
      response.status,
    );
  }

  const envelope = payload as ApiSuccess<T> | ApiFailure;
  if (!envelope || typeof envelope !== 'object' || !('success' in envelope)) {
    throw new ApiClientError('INTERNAL_ERROR', 'Unexpected response shape.', response.status);
  }

  if (!envelope.success) {
    const failure = envelope as ApiFailure;
    throw new ApiClientError(
      failure.error.code,
      failure.error.message,
      response.status,
      failure.error.details,
    );
  }

  return (envelope as ApiSuccess<T>).data;
}

export async function apiGet<T>(path: string): Promise<T> {
  return unwrap<T>(await request(path, { method: 'GET', cache: 'no-store' }));
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return unwrap<T>(await request(path, { method: 'POST', body }));
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return unwrap<T>(await request(path, { method: 'PUT', body }));
}

export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  // Let the browser set the multipart boundary itself.
  return unwrap<T>(await request(path, { method: 'POST', body: form, raw: true }));
}

/** For list endpoints, which carry `pagination` alongside `data`. */
export async function apiList<T>(path: string): Promise<{ items: T[]; pagination: Pagination }> {
  const response = await request(path, { method: 'GET', cache: 'no-store' });
  const payload = (await response.json()) as ApiListSuccess<T> | ApiFailure;

  if (!payload.success) {
    throw new ApiClientError(
      payload.error.code,
      payload.error.message,
      response.status,
      payload.error.details,
    );
  }
  return { items: payload.data, pagination: payload.pagination };
}

/** Triggers a browser download for an authenticated endpoint. */
export async function downloadFile(path: string, fileName: string): Promise<void> {
  const response = await request(path, { method: 'GET' });
  if (!response.ok) {
    let message = `Download failed (HTTP ${response.status}).`;
    try {
      const payload = (await response.json()) as ApiFailure;
      if (payload?.error?.message) message = payload.error.message;
    } catch {
      /* keep the generic message */
    }
    throw new ApiClientError('INTERNAL_ERROR', message, response.status);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
