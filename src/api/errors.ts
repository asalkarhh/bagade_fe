export interface ApiFieldError {
  field: string;
  message: string;
}

export interface ApiErrorPayload {
  code?: string;
  message?: string;
  requestId?: string;
  fieldErrors?: ApiFieldError[];
  selectableBatches?: unknown[];
  currentTotals?: unknown;
  changedSkus?: unknown[];
}

export type ApiErrorKind =
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'csrf'
  | 'validation'
  | 'conflict'
  | 'not_found'
  | 'server'
  | 'http';

export interface ApiClientErrorOptions {
  kind: ApiErrorKind;
  status: number | null;
  code: string;
  message: string;
  requestId?: string | null;
  fieldErrors?: ApiFieldError[];
  retryable?: boolean;
  details?: ApiErrorPayload | null;
  cause?: unknown;
}

export class ApiClientError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string;
  readonly requestId: string | null;
  readonly fieldErrors: ApiFieldError[];
  readonly retryable: boolean;
  readonly details: ApiErrorPayload | null;

  constructor(options: ApiClientErrorOptions) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ApiClientError';
    this.kind = options.kind;
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId ?? null;
    this.fieldErrors = options.fieldErrors ?? [];
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? null;
  }
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

export function parseApiErrorPayload(rawText: string): ApiErrorPayload | null {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const fieldErrors = Array.isArray(record.fieldErrors)
      ? record.fieldErrors
          .filter(
            (item): item is Record<string, unknown> =>
              Boolean(item) && typeof item === 'object' && !Array.isArray(item),
          )
          .map((item) => ({
            field: typeof item.field === 'string' ? item.field : '',
            message: typeof item.message === 'string' ? item.message : 'Invalid value',
          }))
          .filter((item) => item.field.length > 0 || item.message.length > 0)
      : undefined;

    return {
      code: typeof record.code === 'string' ? record.code : undefined,
      message: typeof record.message === 'string' ? record.message : undefined,
      requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
      fieldErrors,
      selectableBatches: Array.isArray(record.selectableBatches)
        ? record.selectableBatches
        : undefined,
      currentTotals: record.currentTotals,
      changedSkus: Array.isArray(record.changedSkus) ? record.changedSkus : undefined,
    };
  } catch {
    return null;
  }
}

const BACKEND_UNAVAILABLE_MESSAGE =
  'Unable to reach the server. Check that the backend is running and try again.';

export function createNetworkApiError(cause?: unknown): ApiClientError {
  return new ApiClientError({
    kind: 'network',
    status: null,
    code: 'NETWORK_ERROR',
    message: BACKEND_UNAVAILABLE_MESSAGE,
    retryable: true,
    cause,
  });
}

export function normalizeHttpError(
  status: number,
  payload: ApiErrorPayload | null,
  headerRequestId: string | null,
): ApiClientError {
  const requestId = payload?.requestId ?? headerRequestId ?? null;
  const fieldErrors = payload?.fieldErrors ?? [];

  // Treat proxy gateway errors and proxy-generated 500s without backend JSON as backend unavailability.
  const isProxyUnavailable =
    status === 502 ||
    status === 503 ||
    status === 504 ||
    payload?.code === 'BACKEND_UNAVAILABLE' ||
    (status === 500 && payload === null);

  if (isProxyUnavailable) {
    return new ApiClientError({
      kind: 'network',
      status,
      code: payload?.code || 'BACKEND_UNAVAILABLE',
      message: BACKEND_UNAVAILABLE_MESSAGE,
      requestId,
      retryable: true,
      details: payload,
    });
  }

  if (status === 401) {
    const code = payload?.code || 'AUTH_REQUIRED';
    return new ApiClientError({
      kind: 'unauthorized',
      status,
      code,
      message:
        payload?.message ||
        (code === 'INVALID_CREDENTIALS'
          ? 'Invalid username or password'
          : 'Authentication required'),
      requestId,
      fieldErrors,
      details: payload,
    });
  }

  if (status === 403) {
    const isCsrf = payload?.code === 'CSRF_ERROR';
    return new ApiClientError({
      kind: isCsrf ? 'csrf' : 'forbidden',
      status,
      code: payload?.code || (isCsrf ? 'CSRF_ERROR' : 'ACCESS_DENIED'),
      message:
        payload?.message ||
        (isCsrf
          ? 'Security verification failed (CSRF token missing or expired). Please try again.'
          : 'Access denied: insufficient permissions'),
      requestId,
      fieldErrors,
      details: payload,
    });
  }

  if (status === 400) {
    return new ApiClientError({
      kind: 'validation',
      status,
      code: payload?.code || 'VALIDATION_ERROR',
      message: payload?.message || 'Please review the highlighted fields and try again.',
      requestId,
      fieldErrors,
      details: payload,
    });
  }

  if (status === 404) {
    return new ApiClientError({
      kind: 'not_found',
      status,
      code: payload?.code || 'RESOURCE_NOT_FOUND',
      message: payload?.message || 'The requested resource was not found.',
      requestId,
      fieldErrors,
      details: payload,
    });
  }

  if (status === 409) {
    return new ApiClientError({
      kind: 'conflict',
      status,
      code: payload?.code || 'CONFLICT',
      message: payload?.message || 'The request conflicted with the current state.',
      requestId,
      fieldErrors,
      details: payload,
    });
  }

  if (status >= 500) {
    return new ApiClientError({
      kind: 'server',
      status,
      code: payload?.code || 'INTERNAL_SERVER_ERROR',
      message: payload?.message || 'An unexpected server error occurred. Please try again.',
      requestId,
      fieldErrors,
      retryable: true,
      details: payload,
    });
  }

  return new ApiClientError({
    kind: 'http',
    status,
    code: payload?.code || `HTTP_${status}`,
    message: payload?.message || `Request failed with status ${status}.`,
    requestId,
    fieldErrors,
    details: payload,
  });
}
