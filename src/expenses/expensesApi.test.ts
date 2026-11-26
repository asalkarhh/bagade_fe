import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../api/client.ts';
import { createExpensesApi } from './expensesApi.ts';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('expensesApi', () => {
  it('lists, creates, and updates operating expenses with CSRF tokens and cleared notes support', async () => {
    let createBody: Record<string, unknown> | null = null;
    let createHeaders: Headers | null = null;
    let patchBody: Record<string, unknown> | null = null;
    let listedUrl = '';

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/v1/auth/csrf') {
        return jsonResponse({ csrfToken: 'csrf-exp' });
      }
      if (url.startsWith('/api/v1/expenses?') && (!init?.method || init.method === 'GET')) {
        listedUrl = url;
        return jsonResponse({ items: [], page: 0, size: 25, total: 0 });
      }
      if (url === '/api/v1/expenses' && init?.method === 'POST') {
        createHeaders = new Headers(init.headers);
        createBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse(
          {
            expenseId: 'exp-1',
            expenseDate: createBody.expenseDate,
            category: createBody.category,
            amount: createBody.amount,
            paymentMode: createBody.paymentMode,
            notes: createBody.notes ?? null,
            version: 0,
          },
          201,
        );
      }
      if (url === '/api/v1/expenses/exp-1' && init?.method === 'PATCH') {
        patchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse({
          expenseId: 'exp-1',
          expenseDate: '2026-11-26',
          category: 'Rent',
          amount: '15500.00',
          paymentMode: 'UPI',
          notes: patchBody.notes ? String(patchBody.notes) : null,
          version: 1,
        });
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
    });

    const api = createExpensesApi(
      createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch }),
    );

    await api.listExpenses({
      from: '2026-11-01',
      to: '2026-11-30',
      category: 'Rent',
      page: 1,
      size: 10,
    });
    expect(listedUrl).toBe('/api/v1/expenses?from=2026-11-01&to=2026-11-30&category=Rent&page=1&size=10');

    await api.createExpense({
      expenseDate: '2026-11-26',
      category: ' Electricity ',
      amount: '2450.50',
      paymentMode: 'CASH',
      notes: '   ',
    });

    expect(createHeaders!.get('X-CSRF-Token')).toBe('csrf-exp');
    expect(createBody).toEqual({
      expenseDate: '2026-11-26',
      category: 'Electricity',
      amount: '2450.50',
      paymentMode: 'CASH',
    });
    expect('notes' in createBody!).toBe(false);

    await api.updateExpense('exp-1', {
      expectedVersion: 0,
      amount: '15500.00',
      notes: '',
    });

    expect(patchBody).toEqual({
      expectedVersion: 0,
      amount: '15500.00',
      notes: '',
    });
  });
});
