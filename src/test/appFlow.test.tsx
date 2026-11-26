import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App.tsx';
import { createApiClient, type ApiClient } from '../api/client.ts';
import { SessionProvider } from '../auth/SessionContext.tsx';
import type { AuthSession } from '../auth/types.ts';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface MockServerState {
  session: AuthSession | null;
  csrfCounter: number;
  currentCsrf: string | null;
  failNextLogout: boolean;
}

function createTestHarness(initialState?: Partial<MockServerState>) {
  const state: MockServerState = {
    session: null,
    csrfCounter: 0,
    currentCsrf: null,
    failNextLogout: false,
    ...initialState,
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);

    if (url === '/api/v1/auth/csrf' && method === 'GET') {
      state.csrfCounter += 1;
      state.currentCsrf = `csrf-${state.csrfCounter}`;
      return jsonResponse({ csrfToken: state.currentCsrf });
    }

    if (url === '/api/v1/auth/session' && method === 'GET') {
      if (!state.session) {
        return jsonResponse(
          { code: 'AUTH_REQUIRED', message: 'Authentication required', requestId: 'req-1' },
          401,
        );
      }
      return jsonResponse(state.session);
    }

    if (url === '/api/v1/auth/session' && method === 'POST') {
      if (!state.currentCsrf || headers.get('X-CSRF-Token') !== state.currentCsrf) {
        return jsonResponse(
          { code: 'CSRF_ERROR', message: 'Invalid or missing CSRF token', requestId: 'req-csrf' },
          403,
        );
      }
      const parsed = JSON.parse(String(init?.body ?? '{}')) as {
        username?: string;
        password?: string;
      };
      if (parsed.username === 'owner1' && parsed.password === 'OwnerPass123!') {
        state.session = { userId: 'owner-uuid', name: 'Shop Owner', role: 'OWNER' };
        state.csrfCounter += 1;
        state.currentCsrf = `csrf-${state.csrfCounter}`;
        return jsonResponse(state.session);
      }
      if (parsed.username === 'worker1' && parsed.password === 'WorkerPass123!') {
        state.session = { userId: 'worker-uuid', name: 'Counter Staff', role: 'WORKER' };
        state.csrfCounter += 1;
        state.currentCsrf = `csrf-${state.csrfCounter}`;
        return jsonResponse(state.session);
      }
      return jsonResponse(
        { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password', requestId: 'req-auth' },
        401,
      );
    }

    if (url === '/api/v1/auth/session' && method === 'DELETE') {
      if (state.failNextLogout) {
        state.failNextLogout = false;
        throw new TypeError('Network down');
      }
      if (!state.currentCsrf || headers.get('X-CSRF-Token') !== state.currentCsrf) {
        return jsonResponse(
          { code: 'CSRF_ERROR', message: 'Invalid or missing CSRF token', requestId: 'req-csrf' },
          403,
        );
      }
      state.session = null;
      state.currentCsrf = null;
      return new Response(null, { status: 204 });
    }

    if (url.startsWith('/api/v1/categories') || url.startsWith('/api/v1/inventory')) {
      return jsonResponse({ items: [], page: 0, size: 25, total: 0 });
    }

    if (url.startsWith('/api/v1/reports/sales')) {
      return jsonResponse({
        from: '2026-11-01',
        to: '2026-11-26',
        categoryId: null,
        skuId: null,
        minPrice: null,
        maxPrice: null,
        netUnitsSold: 0,
        netSales: '0.00',
        cogs: '0.00',
        grossProfit: '0.00',
        costComplete: true,
        nonSellableReturnUnits: 0,
        nonSellableReturnCost: '0.00',
        nonSellableReturnSalesValue: '0.00',
        operatingExpenses: '0.00',
        estimatedProfit: '0.00',
        items: [],
        page: 0,
        size: 25,
        total: 0,
      });
    }

    throw new Error(`Unhandled request: ${method} ${url}`);
  });

  const client = createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch });
  return { state, fetchMock, client };
}

function renderAppAt(initialPath: string, client: ApiClient) {
  return render(
    <SessionProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AppRoutes />
      </MemoryRouter>
    </SessionProvider>,
  );
}

describe('App authentication, routing, and role-based navigation', () => {
  it('shows a loading state before session resolves and prevents protected content from flashing', async () => {
    let resolveSessionFetch!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveSessionFetch = resolve;
        }),
    );
    const client = createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    renderAppAt('/billing', client);

    expect(screen.getByText('Checking your active session…')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Billing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();

    resolveSessionFetch(
      jsonResponse({ code: 'AUTH_REQUIRED', message: 'Authentication required', requestId: 'r1' }, 401),
    );

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('redirects signed-out users to login and returns to the requested permitted route after sign-in', async () => {
    const user = userEvent.setup();
    const { client } = createTestHarness();

    renderAppAt('/inventory', client);

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Username/), 'worker1');
    await user.type(screen.getByLabelText(/^Password/), 'WorkerPass123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Inventory' })).toBeInTheDocument();
    expect(screen.getByText('Counter Staff')).toBeInTheDocument();
    expect(screen.getByText('WORKER')).toBeInTheDocument();
  });

  it('hides owner navigation for WORKER, redirects WORKER away from unpermitted post-login route, and denies direct owner URLs', async () => {
    const user = userEvent.setup();
    const { client } = createTestHarness();

    // Signed-out worker tries to open /reports directly, then signs in as WORKER -> lands on /billing
    renderAppAt('/reports', client);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Username/), 'worker1');
    await user.type(screen.getByLabelText(/^Password/), 'WorkerPass123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Billing' })).toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(nav).toHaveTextContent('Billing');
    expect(nav).toHaveTextContent('Products');
    expect(nav).toHaveTextContent('Purchases');
    expect(nav).toHaveTextContent('Inventory');
    expect(nav).toHaveTextContent('Customers');
    expect(nav).toHaveTextContent('Expenses');
    expect(nav).not.toHaveTextContent('Reports');
    expect(nav).not.toHaveTextContent('What to Buy');
  });

  it('shows Access Denied when an authenticated WORKER opens an owner route directly', async () => {
    const { client } = createTestHarness({
      session: { userId: 'worker-uuid', name: 'Counter Staff', role: 'WORKER' },
    });

    renderAppAt('/what-to-buy', client);

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(screen.getByText(/What to Buy is restricted to accounts with the OWNER role/i)).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByText('Counter Staff')).toBeInTheDocument();
  });

  it('restores OWNER session on refresh, displays all 8 modules, supports retryable logout failure, and allows fresh login afterwards', async () => {
    const user = userEvent.setup();
    const { client } = createTestHarness({
      session: { userId: 'owner-uuid', name: 'Shop Owner', role: 'OWNER' },
      failNextLogout: true,
    });

    renderAppAt('/reports', client);

    expect(await screen.findByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(nav).toHaveTextContent('Reports');
    expect(nav).toHaveTextContent('What to Buy');

    // First logout fails due to simulated network issue -> keeps session and offers retry
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText(/Sign-out failed:/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();

    // Retry logout succeeds -> redirects to sign-in
    await user.click(screen.getByRole('button', { name: 'Retry sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();

    // Later login obtains a fresh CSRF token and succeeds
    await user.type(screen.getByLabelText(/Username/), 'owner1');
    await user.type(screen.getByLabelText(/^Password/), 'OwnerPass123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Billing' })).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('clears local session and returns to login if a protected operational call returns 401', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/auth/session') {
        return jsonResponse({ userId: 'owner-uuid', name: 'Shop Owner', role: 'OWNER' });
      }
      if (url.startsWith('/api/v1/categories') || url.startsWith('/api/v1/skus')) {
        return jsonResponse({ items: [], page: 0, size: 25, total: 0 });
      }
      if (url === '/api/v1/test/operational') {
        return jsonResponse(
          { code: 'AUTH_REQUIRED', message: 'Authentication required', requestId: 'req-exp' },
          401,
        );
      }
      return jsonResponse({});
    });

    const client = createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch });
    renderAppAt('/products', client);

    expect(await screen.findByRole('heading', { name: 'Products' })).toBeInTheDocument();

    await expect(client.get('/test/operational')).rejects.toMatchObject({ kind: 'unauthorized' });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    });
    expect(screen.getByText(/Your session expired/i)).toBeInTheDocument();
  });
});
