import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client.ts';
import { isApiClientError } from './errors.ts';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

describe('createApiClient', () => {
  it('fetches CSRF token before mutating requests, deduplicates concurrent CSRF fetches, and supports custom headers', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/v1/auth/csrf') {
        return jsonResponse({ csrfToken: 'csrf-123' });
      }
      if (url === '/api/v1/bills' && init?.method === 'POST') {
        const headers = new Headers(init.headers);
        expect(headers.get('X-CSRF-Token')).toBe('csrf-123');
        expect(headers.get('Idempotency-Key')).toBe('idem-abc');
        expect(headers.get('Content-Type')).toBe('application/json');
        expect(init.credentials).toBe('same-origin');
        return jsonResponse({ billId: 'b-1' }, 201);
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const client = createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    const [t1, t2] = await Promise.all([client.ensureCsrfToken(), client.ensureCsrfToken()]);
    expect(t1).toBe('csrf-123');
    expect(t2).toBe('csrf-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const created = await client.post<{ billId: string }>(
      '/bills',
      { amount: 500 },
      { headers: { 'Idempotency-Key': 'idem-abc' } },
    );
    expect(created.billId).toBe('b-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('handles 204 empty responses cleanly without parsing JSON', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/auth/csrf') {
        return jsonResponse({ csrfToken: 'csrf-logout' });
      }
      return new Response(null, { status: 204 });
    });

    const client = createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch });
    await expect(client.delete('/auth/session')).resolves.toBeUndefined();
  });

  it('decodes backend error payload with code, message, requestId, and fieldErrors', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/v1/auth/csrf') {
        return jsonResponse({ csrfToken: 'csrf-val' });
      }
      return jsonResponse(
        {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          requestId: 'req-42',
          fieldErrors: [{ field: 'username', message: 'Username is required' }],
        },
        400,
      );
    });

    const client = createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch });
    let captured: unknown;
    try {
      await client.post('/auth/session', { username: '', password: '' }, { handleUnauthorized: false });
    } catch (error) {
      captured = error;
    }

    expect(isApiClientError(captured)).toBe(true);
    if (isApiClientError(captured)) {
      expect(captured.kind).toBe('validation');
      expect(captured.code).toBe('VALIDATION_ERROR');
      expect(captured.requestId).toBe('req-42');
      expect(captured.fieldErrors).toEqual([
        { field: 'username', message: 'Username is required' },
      ]);
    }
  });

  it('treats network failures, 503 proxy unavailable, and non-JSON 500s as retryable network errors without replaying writes', async () => {
    let postCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/v1/auth/csrf') {
        return jsonResponse({ csrfToken: 'csrf-1' });
      }
      if (init?.method === 'POST') {
        postCalls += 1;
        return new Response('', { status: 500 });
      }
      throw new TypeError('Failed to fetch');
    });

    const client = createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    await expect(client.get('/inventory')).rejects.toMatchObject({
      kind: 'network',
      retryable: true,
    });

    await expect(client.post('/bills', { lines: [] })).rejects.toMatchObject({
      kind: 'network',
      retryable: true,
    });
    expect(postCalls).toBe(1);
  });

  it('triggers unauthorized handler on protected 401 and preserves session on 403', async () => {
    const onUnauthorized = vi.fn();
    let mode: '401' | '403_access' | '403_csrf' = '401';

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/v1/auth/csrf') {
        return jsonResponse({ csrfToken: 'csrf-token' });
      }
      if (mode === '401') {
        return jsonResponse(
          { code: 'AUTH_REQUIRED', message: 'Authentication required', requestId: 'req-401' },
          401,
        );
      }
      if (mode === '403_access') {
        return jsonResponse(
          {
            code: 'ACCESS_DENIED',
            message: 'Access denied: insufficient permissions',
            requestId: 'req-403',
          },
          403,
        );
      }
      return jsonResponse(
        {
          code: 'CSRF_ERROR',
          message: 'Invalid or missing CSRF token',
          requestId: 'req-csrf',
        },
        403,
      );
    });

    const client = createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch });
    client.setUnauthorizedHandler(onUnauthorized);

    await client.ensureCsrfToken();
    expect(client.hasCsrfToken()).toBe(true);

    mode = '403_access';
    await expect(client.get('/reports/sales')).rejects.toMatchObject({
      kind: 'forbidden',
      code: 'ACCESS_DENIED',
    });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(client.hasCsrfToken()).toBe(true);

    mode = '403_csrf';
    await expect(client.post('/expenses', {})).rejects.toMatchObject({
      kind: 'csrf',
      code: 'CSRF_ERROR',
    });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(client.hasCsrfToken()).toBe(false);

    mode = '401';
    await client.ensureCsrfToken();
    await expect(client.get('/inventory')).rejects.toMatchObject({
      kind: 'unauthorized',
      code: 'AUTH_REQUIRED',
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(client.hasCsrfToken()).toBe(false);
  });
});
