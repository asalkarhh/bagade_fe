import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../api/client.ts';
import { createPlanningApi } from './planningApi.ts';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('planningApi', () => {
  it('sends pageSize query param on GET /purchase-planning and CSRF on PUT /purchase-targets/{skuId}', async () => {
    let planningUrl = '';
    const targetBodies: Array<{ body: Record<string, unknown>; headers: Headers }> = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/v1/auth/csrf') {
        return jsonResponse({ csrfToken: 'csrf-plan' });
      }
      if (url.startsWith('/api/v1/purchase-planning?')) {
        planningUrl = url;
        return jsonResponse({
          recentSalesFrom: '2026-10-28',
          recentSalesTo: '2026-11-26',
          planningPeriod: 'Diwali',
          items: [],
          page: 0,
          size: 10,
          total: 0,
        });
      }
      if (url === '/api/v1/purchase-targets/sku-1' && init?.method === 'PUT') {
        const parsed = JSON.parse(String(init.body)) as Record<string, unknown>;
        targetBodies.push({
          body: parsed,
          headers: new Headers(init.headers),
        });
        return jsonResponse({
          skuId: 'sku-1',
          targetQuantity: parsed.targetQuantity,
          planningPeriod: parsed.planningPeriod ?? null,
        });
      }
      throw new Error(`Unexpected request ${init?.method ?? 'GET'} ${url}`);
    });

    const api = createPlanningApi(
      createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch }),
    );

    await api.getPurchasePlanning({
      categoryId: 'cat-1',
      size: 'M',
      minPrice: '400.00',
      maxPrice: '1500.00',
      vendorId: 'v-1',
      planningPeriod: 'Diwali',
      page: 1,
      pageSize: 10,
    });

    expect(planningUrl).toBe(
      '/api/v1/purchase-planning?categoryId=cat-1&size=M&minPrice=400.00&maxPrice=1500.00&vendorId=v-1&planningPeriod=Diwali&page=1&pageSize=10',
    );

    await api.upsertPurchaseTarget('sku-1', { targetQuantity: 0, planningPeriod: null });
    await api.upsertPurchaseTarget('sku-1', { targetQuantity: 50, planningPeriod: ' Diwali ' });

    expect(targetBodies[0]!.headers.get('X-CSRF-Token')).toBe('csrf-plan');
    expect(targetBodies[0]!.body).toEqual({ targetQuantity: 0 });
    expect('planningPeriod' in targetBodies[0]!.body).toBe(false);
    expect(targetBodies[1]!.body).toEqual({ targetQuantity: 50, planningPeriod: 'Diwali' });
  });
});
