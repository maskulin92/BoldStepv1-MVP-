/**
 * Standardized API envelope — every route in `/app/api` returns one of these.
 * See docs/API.md for the contract.
 */

export interface ApiMeta {
  timestamp: string;
  request_id: string;
  version: string;
}

export interface Pagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: ApiMeta;
}

export interface ApiListSuccess<T> {
  success: true;
  data: T[];
  pagination: Pagination;
  meta: ApiMeta;
}

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
  meta: Omit<ApiMeta, 'version'> & { version: string };
}

export type ApiResponseBody<T> = ApiSuccess<T> | ApiListSuccess<T> | ApiFailure;

export const API_ERROR_CODES = {
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  INVALID_PIN: 401,
  TOKEN_EXPIRED: 401,
  INVALID_API_KEY: 401,
  FORBIDDEN: 403,
  INSUFFICIENT_PERMISSIONS: 403,
  NOT_FOUND: 404,
  INVALID_CLIENT_ID: 404,
  INVALID_CAMPAIGN_ID: 404,
  ACTION_NOT_FOUND: 404,
  CREATIVE_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  VALIDATION_ERROR: 422,
  ACTION_ALREADY_RESOLVED: 409,
  RATE_LIMIT_EXCEEDED: 429,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FILE_TYPE: 415,
  UPSTREAM_ERROR: 502,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
  NOT_CONFIGURED: 501,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_CODES;
