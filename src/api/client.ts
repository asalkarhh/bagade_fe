import {
  ApiClientError,
  createNetworkApiError,
  isAbortError,
  normalizeHttpError,
  parseApiErrorPayload,
} from './errors.ts';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryParamValue = string | number | boolean | undefined | null;

export interface ApiRequestOptions {
  method?: HttpMethod;
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
  query?: Record<string, QueryParamValue>;
  /** Set true only when an endpoint explicitly opts out of CSRF headers. */
  skipCsrf?: boolean;
  /** Handle 401 globally by clearing local session and returning to login. Defaults to true. */
  handleUnauthorized?: boolean;
}

export type UnauthorizedHandler = (error: ApiClientError) => void;

export interface CreateApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface CsrfResponse {
  csrfToken?: unknown;
}

const MUTATING_METHODS = new Set<HttpMethod>(['POST', 'PUT', 'PATCH', 'DELETE']);

function normalizeBaseUrl(rawBaseUrl: string | undefined): string {
  const trimmed = rawBaseUrl?.trim();
  if (!trimmed) {
    return '/api/v1';
  }
  return trimmed.replace(/\/+$/, '') || '/api/v1';
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, QueryParamValue>,
): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const fullPath =
    normalizedPath === baseUrl || normalizedPath.startsWith(`${baseUrl}/`)
      ? normalizedPath
      : `${baseUrl}${normalizedPath}`;

  if (!query) {
    return fullPath;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
  const queryString = params.toString();
  return queryString ? `${fullPath}?${queryString}` : fullPath;
}

function isRawBody(body: unknown): body is BodyInit {
  return (
    typeof body === 'string' ||
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  );
}

export interface ApiClient {
  request<T>(path: string, options?: ApiRequestOptions): Promise<T>;
  get<T>(path: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>): Promise<T>;
  post<T>(
    path: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, 'method' | 'body'>,
  ): Promise<T>;
  put<T>(
    path: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, 'method' | 'body'>,
  ): Promise<T>;
  patch<T>(
    path: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, 'method' | 'body'>,
  ): Promise<T>;
  delete<T = void>(
    path: string,
    options?: Omit<ApiRequestOptions, 'method'>,
  ): Promise<T>;
  ensureCsrfToken(signal?: AbortSignal): Promise<string>;
  refreshCsrfToken(signal?: AbortSignal): Promise<string>;
  clearCsrfToken(): void;
  hasCsrfToken(): boolean;
  setUnauthorizedHandler(handler: UnauthorizedHandler | null): () => void;
}

export function createApiClient(config: CreateApiClientOptions = {}): ApiClient {
  const baseUrl = normalizeBaseUrl(config.baseUrl ?? import.meta.env.VITE_API_BASE_URL);
  const getFetch = (): typeof fetch => config.fetchImpl ?? globalThis.fetch.bind(globalThis);

  // Kept strictly in memory—never persisted to localStorage or sessionStorage.
  let csrfToken: string | null = null;
  let csrfRefreshPromise: Promise<string> | null = null;
  let unauthorizedHandler: UnauthorizedHandler | null = null;

  async function executeFetch(url: string, init: RequestInit): Promise<Response> {
    try {
      return await getFetch()(url, init);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      throw createNetworkApiError(error);
    }
  }

  async function refreshCsrfToken(signal?: AbortSignal): Promise<string> {
    if (csrfRefreshPromise) {
      return csrfRefreshPromise;
    }

    const requestPromise = (async () => {
      const response = await executeFetch(buildUrl(baseUrl, '/auth/csrf'), {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
        },
        signal,
      });

      const rawText = await response.text();
      if (!response.ok) {
        const payload = parseApiErrorPayload(rawText);
        const headerRequestId = response.headers.get('X-Request-Id');
        throw normalizeHttpError(response.status, payload, headerRequestId);
      }

      let parsed: CsrfResponse | null = null;
      try {
        parsed = rawText.trim() ? (JSON.parse(rawText) as CsrfResponse) : null;
      } catch (parseError) {
        throw new ApiClientError({
          kind: 'server',
          status: response.status,
          code: 'INVALID_RESPONSE',
          message: 'Received an unexpected CSRF response from the server.',
          retryable: true,
          cause: parseError,
        });
      }

      if (!parsed || typeof parsed.csrfToken !== 'string' || parsed.csrfToken.length === 0) {
        throw new ApiClientError({
          kind: 'server',
          status: response.status,
          code: 'INVALID_CSRF_PAYLOAD',
          message: 'Server response did not include a CSRF token.',
          retryable: true,
        });
      }

      csrfToken = parsed.csrfToken;
      return csrfToken;
    })();

    csrfRefreshPromise = requestPromise;
    try {
      return await requestPromise;
    } finally {
      if (csrfRefreshPromise === requestPromise) {
        csrfRefreshPromise = null;
      }
    }
  }

  async function ensureCsrfToken(signal?: AbortSignal): Promise<string> {
    if (csrfToken) {
      return csrfToken;
    }
    return refreshCsrfToken(signal);
  }

  function clearCsrfToken(): void {
    csrfToken = null;
  }

  function hasCsrfToken(): boolean {
    return csrfToken !== null;
  }

  function setUnauthorizedHandler(handler: UnauthorizedHandler | null): () => void {
    unauthorizedHandler = handler;
    return () => {
      if (unauthorizedHandler === handler) {
        unauthorizedHandler = null;
      }
    };
  }

  async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const method: HttpMethod = options.method ?? 'GET';
    const headers = new Headers(options.headers);
    const handleUnauthorized = options.handleUnauthorized ?? true;

    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json');
    }

    if (MUTATING_METHODS.has(method) && !options.skipCsrf && !headers.has('X-CSRF-Token')) {
      const token = await ensureCsrfToken(options.signal);
      headers.set('X-CSRF-Token', token);
    }

    let requestBody: BodyInit | undefined;
    if (options.body !== undefined && options.body !== null) {
      if (isRawBody(options.body)) {
        requestBody = options.body;
      } else {
        if (!headers.has('Content-Type')) {
          headers.set('Content-Type', 'application/json');
        }
        requestBody = JSON.stringify(options.body);
      }
    }

    const response = await executeFetch(buildUrl(baseUrl, path, options.query), {
      method,
      credentials: 'same-origin',
      headers,
      body: requestBody,
      signal: options.signal,
    });

    if (response.status === 204 || response.status === 205) {
      return undefined as T;
    }

    const rawText = await response.text();
    const headerRequestId = response.headers.get('X-Request-Id');

    if (!response.ok) {
      const payload = parseApiErrorPayload(rawText);
      const apiError = normalizeHttpError(response.status, payload, headerRequestId);

      if (apiError.kind === 'csrf') {
        clearCsrfToken();
      }

      if (response.status === 401 && handleUnauthorized) {
        clearCsrfToken();
        unauthorizedHandler?.(apiError);
      }

      throw apiError;
    }

    if (!rawText.trim()) {
      return undefined as T;
    }

    try {
      return JSON.parse(rawText) as T;
    } catch (parseError) {
      throw new ApiClientError({
        kind: 'server',
        status: response.status,
        code: 'INVALID_RESPONSE',
        message: 'Server returned malformed JSON.',
        requestId: headerRequestId,
        cause: parseError,
      });
    }
  }

  return {
    request,
    get: <T>(path: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>) =>
      request<T>(path, { ...options, method: 'GET' }),
    post: <T>(
      path: string,
      body?: unknown,
      options?: Omit<ApiRequestOptions, 'method' | 'body'>,
    ) => request<T>(path, { ...options, method: 'POST', body }),
    put: <T>(
      path: string,
      body?: unknown,
      options?: Omit<ApiRequestOptions, 'method' | 'body'>,
    ) => request<T>(path, { ...options, method: 'PUT', body }),
    patch: <T>(
      path: string,
      body?: unknown,
      options?: Omit<ApiRequestOptions, 'method' | 'body'>,
    ) => request<T>(path, { ...options, method: 'PATCH', body }),
    delete: <T = void>(path: string, options?: Omit<ApiRequestOptions, 'method'>) =>
      request<T>(path, { ...options, method: 'DELETE' }),
    ensureCsrfToken,
    refreshCsrfToken,
    clearCsrfToken,
    hasCsrfToken,
    setUnauthorizedHandler,
  };
}

export const apiClient = createApiClient();
