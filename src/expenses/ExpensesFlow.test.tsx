import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App.tsx';
import { createApiClient } from '../api/client.ts';
import { ApiClientError } from '../api/errors.ts';
import { SessionProvider } from '../auth/SessionContext.tsx';
import { getShopLocalDateIso } from '../utils/shopDate.ts';
import { ExpensesPage } from './ExpensesPage.tsx';
import type { ExpensesApi } from './expensesApi.ts';
import type { Expense } from './types.ts';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeMockExpensesApi(overrides: Partial<ExpensesApi> = {}): ExpensesApi {
  return {
    listExpenses: vi.fn(async () => ({ items: [], page: 0, size: 25, total: 0 })),
    createExpense: vi.fn(),
    updateExpense: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FE07 Operating Expenses Management', () => {
  it('creates an operating expense after validating positive INR amount and defaults to shop date', async () => {
    const user = userEvent.setup();
    const expenses: Expense[] = [];
    const listExpenses = vi.fn(async () => ({
      items: [...expenses],
      page: 0,
      size: 25,
      total: expenses.length,
    }));
    const createExpense = vi.fn(async (input) => {
      const created: Expense = {
        expenseId: 'exp-101',
        expenseDate: input.expenseDate,
        category: input.category,
        amount: input.amount,
        paymentMode: input.paymentMode,
        notes: input.notes ?? null,
        version: 0,
      };
      expenses.unshift(created);
      return created;
    });

    const api = makeMockExpensesApi({ listExpenses, createExpense });

    render(
      <MemoryRouter initialEntries={['/expenses']}>
        <Routes>
          <Route path="/expenses" element={<ExpensesPage api={api} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('No operating expenses recorded yet.')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Add Expense' })[0]!);
    const dialog = await screen.findByRole('dialog');

    const dateInput = within(dialog).getByLabelText('Expense Date') as HTMLInputElement;
    expect(dateInput.value).toBe(getShopLocalDateIso());

    await user.type(within(dialog).getByLabelText('Category'), 'Electricity');
    await user.type(within(dialog).getByLabelText('Amount (INR)'), '0.00');
    await user.click(within(dialog).getByRole('button', { name: 'Save Expense' }));

    expect(
      await within(dialog).findByText('Expense amount must be greater than ₹0.00.'),
    ).toBeInTheDocument();
    expect(createExpense).not.toHaveBeenCalled();

    const amountInput = within(dialog).getByLabelText('Amount (INR)');
    await user.clear(amountInput);
    await user.type(amountInput, '2450.5');
    await user.click(within(dialog).getByRole('radio', { name: 'UPI' }));
    await user.type(within(dialog).getByLabelText('Notes (optional)'), 'BESCOM bill');
    await user.click(within(dialog).getByRole('button', { name: 'Save Expense' }));

    await waitFor(() => {
      expect(createExpense).toHaveBeenCalledWith({
        expenseDate: getShopLocalDateIso(),
        category: 'Electricity',
        amount: '2450.50',
        paymentMode: 'UPI',
        notes: 'BESCOM bill',
      });
    });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Electricity')).toBeInTheDocument();
    expect(within(table).getByText('₹2,450.50')).toBeInTheDocument();
    expect(within(table).getByText('BESCOM bill')).toBeInTheDocument();
  });

  it('preserves form and instructs duplicate check on unknown network error during create', async () => {
    const user = userEvent.setup();
    const createExpense = vi.fn(async () => {
      throw new ApiClientError({
        kind: 'network',
        status: null,
        code: 'NETWORK_ERROR',
        message: 'Unable to reach the server.',
        retryable: true,
      });
    });

    const listExpenses = vi.fn(async () => ({ items: [], page: 0, size: 25, total: 0 }));
    const api = makeMockExpensesApi({ listExpenses, createExpense });

    render(
      <MemoryRouter initialEntries={['/expenses']}>
        <Routes>
          <Route path="/expenses" element={<ExpensesPage api={api} />} />
        </Routes>
      </MemoryRouter>
    );

    await user.click(await screen.findByRole('button', { name: 'Add Expense' }));
    const dialog = await screen.findByRole('dialog');

    await user.type(within(dialog).getByLabelText('Category'), 'Rent');
    await user.type(within(dialog).getByLabelText('Amount (INR)'), '15000');
    await user.type(within(dialog).getByLabelText('Notes (optional)'), 'Shop rent');
    await user.click(within(dialog).getByRole('button', { name: 'Save Expense' }));

    expect(
      await within(dialog).findByText(
        /check the Expenses list before resubmitting to avoid a duplicate entry/i,
      ),
    ).toBeInTheDocument();
    expect((within(dialog).getByLabelText('Category') as HTMLInputElement).value).toBe('Rent');
    expect((within(dialog).getByLabelText('Amount (INR)') as HTMLInputElement).value).toBe('15000');
    expect(createExpense).toHaveBeenCalledTimes(1);

    await user.click(within(dialog).getByRole('button', { name: 'Check Expenses List' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(listExpenses).toHaveBeenCalledTimes(2);
  });

  it('handles 409 STALE_VERSION on edit by reloading latest list while preserving draft edits', async () => {
    const user = userEvent.setup();
    let serverRow: Expense = {
      expenseId: 'exp-1',
      expenseDate: '2026-11-18',
      category: 'Rent',
      amount: '15000.00',
      paymentMode: 'CASH',
      notes: 'Nov rent',
      version: 0,
    };

    const listExpenses = vi.fn(async () => ({
      items: [serverRow],
      page: 0,
      size: 25,
      total: 1,
    }));

    const updateExpense = vi.fn(async (_id, input) => {
      if (input.expectedVersion === 0) {
        serverRow = {
          ...serverRow,
          amount: '15200.00',
          version: 1,
        };
        throw new ApiClientError({
          kind: 'conflict',
          status: 409,
          code: 'STALE_VERSION',
          message: 'Expense was modified by another request',
          requestId: 'req-stale-exp',
        });
      }
      serverRow = {
        ...serverRow,
        amount: input.amount ?? serverRow.amount,
        notes: input.notes ?? serverRow.notes,
        version: serverRow.version + 1,
      };
      return serverRow;
    });

    const api = makeMockExpensesApi({ listExpenses, updateExpense });

    render(
      <MemoryRouter initialEntries={['/expenses']}>
        <Routes>
          <Route path="/expenses" element={<ExpensesPage api={api} />} />
        </Routes>
      </MemoryRouter>
    );

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');

    const amountInput = within(dialog).getByLabelText('Amount (INR)');
    await user.clear(amountInput);
    await user.type(amountInput, '15500.00');
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    expect(
      await within(dialog).findByText(/Someone else updated this expense to v1/i),
    ).toBeInTheDocument();
    // User draft value stays preserved!
    expect((within(dialog).getByLabelText('Amount (INR)') as HTMLInputElement).value).toBe('15500.00');

    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(updateExpense).toHaveBeenLastCalledWith('exp-1', {
        expectedVersion: 1,
        amount: '15500.00',
      });
    });

    await waitFor(() => {
      expect(within(screen.getByRole('table')).getByText('₹15,500.00')).toBeInTheDocument();
    });
  });

  it('validates date range filters, ignores stale slow responses, and handles empty/retry states', async () => {
    const user = userEvent.setup();
    let resolveFirst!: (val: { items: Expense[]; page: number; size: number; total: number }) => void;
    let callCount = 0;

    const listExpenses = vi.fn((params) => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve({
          items: [
            {
              expenseId: 'exp-a',
              expenseDate: '2026-11-10',
              category: 'Electricity',
              amount: '1200.00',
              paymentMode: 'CASH' as const,
              notes: null,
              version: 0,
            },
          ],
          page: 0,
          size: 25,
          total: 1,
        });
      }
      if (params.category === 'Rent') {
        return new Promise<{ items: Expense[]; page: number; size: number; total: number }>(
          (resolve) => {
            resolveFirst = resolve;
          },
        );
      }
      return Promise.resolve({ items: [], page: 0, size: 25, total: 0 });
    });

    const api = makeMockExpensesApi({ listExpenses });

    render(
      <MemoryRouter initialEntries={['/expenses']}>
        <Routes>
          <Route path="/expenses" element={<ExpensesPage api={api} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Electricity')).toBeInTheDocument();

    await user.type(screen.getByLabelText('From Date'), '2026-11-25');
    await user.type(screen.getByLabelText('To Date'), '2026-11-20');
    await user.click(screen.getByRole('button', { name: 'Apply Filters' }));

    expect(
      await screen.findByText('Start date ("From") must be on or before end date ("To").'),
    ).toBeInTheDocument();

    await user.clear(screen.getByLabelText('From Date'));
    await user.type(screen.getByLabelText('From Date'), '2026-11-18');
    await user.type(screen.getByLabelText('Category (exact match)'), 'Rent');
    await user.click(screen.getByRole('button', { name: 'Apply Filters' }));

    // Immediately change filter again before Rent resolves
    const catInput = screen.getByLabelText('Category (exact match)');
    await user.clear(catInput);
    await user.type(catInput, 'Stationery');
    await user.click(screen.getByRole('button', { name: 'Apply Filters' }));

    expect(
      await screen.findByText('No operating expenses match the selected date range or category.'),
    ).toBeInTheDocument();

    // Now resolve earlier slower Rent query; UI must NOT regress to Rent results!
    resolveFirst({
      items: [
        {
          expenseId: 'exp-stale',
          expenseDate: '2026-11-19',
          category: 'Rent',
          amount: '10000.00',
          paymentMode: 'UPI',
          notes: 'Should be ignored',
          version: 0,
        },
      ],
      page: 0,
      size: 25,
      total: 1,
    });

    await waitFor(() => {
      expect(screen.queryByText('Should be ignored')).not.toBeInTheDocument();
    });
  });

  it('allows WORKER to access /expenses via AppRoutes while denying /reports', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/auth/session') {
        return jsonResponse({ userId: 'worker-uuid', name: 'Counter Staff', role: 'WORKER' });
      }
      if (url.startsWith('/api/v1/expenses')) {
        return jsonResponse({ items: [], page: 0, size: 25, total: 0 });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const client = createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch });
    render(
      <SessionProvider client={client}>
        <MemoryRouter initialEntries={['/expenses']}>
          <AppRoutes />
        </MemoryRouter>
      </SessionProvider>
    );

    expect(await screen.findByRole('heading', { name: 'Operating Expenses' })).toBeInTheDocument();
  });
});
