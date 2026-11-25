import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../api/client.ts';
import { createPurchasingApi } from './purchasingApi.ts';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('purchasingApi', () => {
  it('filters vendors by Active, Inactive, All and trims vendor creation input', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/v1/auth/csrf') {
        return jsonResponse({ csrfToken: 'csrf-1' });
      }
      if (url.startsWith('/api/v1/vendors?')) {
        return jsonResponse({
          items: [
            {
              vendorId: 'v-1',
              name: 'Kanchipuram Looms',
              contact: '9876543210',
              active: true,
            },
          ],
          page: 0,
          size: 25,
          total: 1,
        });
      }
      if (url === '/api/v1/vendors' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({
          name: 'Surat Mills',
          contact: null,
        });
        return jsonResponse(
          {
            vendorId: 'v-2',
            name: 'Surat Mills',
            contact: null,
            active: true,
          },
          201,
        );
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
    });

    const api = createPurchasingApi(createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch }));

    await api.listVendors({ q: '  Silk ', status: 'ACTIVE', page: 0, size: 25 });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      '/api/v1/vendors?q=Silk&active=true&page=0&size=25',
    );

    await api.listVendors({ status: 'INACTIVE', page: 1, size: 10 });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      '/api/v1/vendors?active=false&page=1&size=10',
    );

    await api.listVendors({ status: 'ALL', page: 0, size: 50 });
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe('/api/v1/vendors?page=0&size=50');

    const created = await api.createVendor({ name: '  Surat Mills  ', contact: '   ' });
    expect(created.vendorId).toBe('v-2');
    expect(created.contact).toBeNull();
  });

  it('paginates across all vendor pages in listAllVendors', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('page=0')) {
        return jsonResponse({
          items: [
            { vendorId: 'v-1', name: 'Alpha', contact: null, active: true },
            { vendorId: 'v-2', name: 'Beta', contact: null, active: false },
          ],
          page: 0,
          size: 2,
          total: 3,
        });
      }
      if (url.includes('page=1')) {
        return jsonResponse({
          items: [{ vendorId: 'v-3', name: 'Gamma', contact: '999', active: true }],
          page: 1,
          size: 2,
          total: 3,
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const api = createPurchasingApi(createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch }));
    const vendors = await api.listAllVendors();

    expect(vendors.map((v) => v.vendorId)).toEqual(['v-1', 'v-2', 'v-3']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('preserves null vs 0.00 agreedUnitCost on createPurchaseOrder and sends Idempotency-Key on cancel', async () => {
    const capturedHeaders: Record<string, Record<string, string>> = {};

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/v1/auth/csrf') {
        return jsonResponse({ csrfToken: 'csrf-po' });
      }
      if (url === '/api/v1/purchase-orders' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({
          vendorId: 'v-1',
          orderDate: '2026-11-25',
          lines: [
            { skuId: 'sku-1', orderedQuantity: 12, agreedUnitCost: null },
            { skuId: 'sku-2', orderedQuantity: 4, agreedUnitCost: '0.00' },
          ],
        });
        return jsonResponse(
          {
            poId: 'po-1',
            poNumber: 'PO-0001',
            vendorId: 'v-1',
            vendorName: 'Alpha',
            orderDate: '2026-11-25',
            status: 'OPEN',
            totalOpenQuantity: 16,
            version: 0,
            lines: [],
          },
          201,
        );
      }
      if (url === '/api/v1/purchase-orders/po-1/cancel-remainder' && init?.method === 'POST') {
        const headers = new Headers(init.headers);
        capturedHeaders[String(capturedHeaders ? Object.keys(capturedHeaders).length : 0)] = {
          idempotencyKey: headers.get('Idempotency-Key') ?? '',
          csrf: headers.get('X-CSRF-Token') ?? '',
          body: String(init.body),
        };
        return jsonResponse({
          poId: 'po-1',
          poNumber: 'PO-0001',
          vendorId: 'v-1',
          vendorName: 'Alpha',
          orderDate: '2026-11-25',
          status: 'CANCELLED',
          totalOpenQuantity: 0,
          version: 1,
          lines: [],
        });
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
    });

    const api = createPurchasingApi(createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch }));

    await api.createPurchaseOrder({
      vendorId: 'v-1',
      orderDate: '2026-11-25',
      lines: [
        { skuId: 'sku-1', orderedQuantity: 12, agreedUnitCost: null },
        { skuId: 'sku-2', orderedQuantity: 4, agreedUnitCost: '0.00' },
      ],
    });

    await api.cancelPurchaseOrderRemainder(
      'po-1',
      { expectedVersion: 0, reason: '  Supplier short  ' },
      'idem-all-1',
    );
    expect(JSON.parse(capturedHeaders['0'].body)).toEqual({
      expectedVersion: 0,
      reason: 'Supplier short',
    });
    expect(capturedHeaders['0'].idempotencyKey).toBe('idem-all-1');
    expect(capturedHeaders['0'].csrf).toBe('csrf-po');

    await api.cancelPurchaseOrderRemainder(
      'po-1',
      { expectedVersion: 1, reason: 'Line cancelled', poLineIds: ['line-2'] },
      'idem-part-1',
    );
    expect(JSON.parse(capturedHeaders['1'].body)).toEqual({
      expectedVersion: 1,
      reason: 'Line cancelled',
      poLineIds: ['line-2'],
    });
    expect(capturedHeaders['1'].idempotencyKey).toBe('idem-part-1');
  });
});
