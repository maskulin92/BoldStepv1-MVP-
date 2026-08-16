import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { API_ERROR_CODES, type ApiErrorCode, type Pagination } from '@/types/api';
import { API_VERSION } from '@/constants/api-endpoints';

/**
 * Every API route returns through these helpers so the envelope stays
 * identical for the dashboard, Hermes and third-party integrations.
 */

function meta() {
  return {
    timestamp: new Date().toISOString(),
    request_id: randomUUID(),
    version: API_VERSION,
  };
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ success: true, data, meta: meta() }, { status: 200, ...init });
}

export function created<T>(data: T): NextResponse {
  return NextResponse.json({ success: true, data, meta: meta() }, { status: 201 });
}

export function list<T>(data: T[], pagination: Pagination): NextResponse {
  return NextResponse.json({ success: true, data, pagination, meta: meta() }, { status: 200 });
}

export function fail(
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): NextResponse {
  const status = API_ERROR_CODES[code] ?? 500;
  return NextResponse.json(
    {
      success: false,
      error: { code, message, ...(details ? { details } : {}) },
      meta: meta(),
    },
    { status },
  );
}

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Wraps a route handler so an unexpected throw becomes a well-formed error
 * envelope instead of an HTML error page. Internal details are logged
 * server-side and never leaked to the caller in production.
 */
export function withErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ApiError) {
        return fail(error.code, error.message, error.details);
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[boldstep:api]', error);
      return fail(
        'INTERNAL_ERROR',
        process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : message,
      );
    }
  };
}

/** Parses a JSON body, turning malformed input into a 422 instead of a 500. */
export async function parseJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ApiError('VALIDATION_ERROR', 'Request body must be a JSON object.');
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('VALIDATION_ERROR', 'Request body is not valid JSON.');
  }
}
