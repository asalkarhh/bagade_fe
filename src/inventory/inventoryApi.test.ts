import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../api/client.ts';
import { createInventoryApi } from './inventoryApi.ts';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('inventoryApi', () => {
  it('omits poId, poLineId, and blank printedMrp on direct receipts while sending Idempotency-Key and CSRF', async () => {
    let capturedHeaders: Headers | null = null;
    let capturedDirectBody: Record<string, unknown> | null = null;
    let capturedPoBody: Record<string, unknown> | null = null;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/v1/auth/csrf') {
        return jsonResponse({ csrfToken: 'csrf-inv' });
      }
      if (url === '/api/v1/stock-receipts' && init?.method === 'POST') {
        capturedHeaders = new Headers(init.headers);
        const parsed = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (!parsed.poId) {
          capturedDirectBody = parsed;
        } else {
          capturedPoBody = parsed;
        }
        return jsonResponse(
          {
            receiptId: 'rcp-1',
            receiptNumber: 'RCP-000001',
            vendorId: 'v-1',
            vendorName: 'Vendor One',
            poId: parsed.poId ?? null,
            poNumber: parsed.poId ? 'PO-0001' : null,
            poStatus: parsed.poId ? 'PARTIALLY_RECEIVED' : null,
            poTotalOpenQuantity: parsed.poId ? 4 : null,
            poVersion: parsed.poId ? 1 : null,
            vendorInvoiceRef: parsed.vendorInvoiceRef ?? null,
            receivedDate: parsed.receivedDate,
            postedAt: '2026-11-25T12:00:00Z',
            lines: [],
          },
          201,
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const api = createInventoryApi(
      createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch }),
    );

    await api.createStockReceipt(
      {
        vendorId: 'v-1',
        receivedDate: '2026-11-25',
        vendorInvoiceRef: '   ',
        lines: [
          {
            skuId: 'sku-1',
            quantity: 5,
            unitCost: '450.00',
            printedMrp: '',
            generateInternalTag: true,
          },
        ],
      },
      'idem-direct-1',
    );

    expect(capturedHeaders!.get('Idempotency-Key')).toBe('idem-direct-1');
    expect(capturedHeaders!.get('X-CSRF-Token')).toBe('csrf-inv');
    expect(capturedDirectBody).toEqual({
      vendorId: 'v-1',
      receivedDate: '2026-11-25',
      lines: [
        {
          skuId: 'sku-1',
          quantity: 5,
          unitCost: '450.00',
          generateInternalTag: true,
        },
      ],
    });
    expect('poId' in capturedDirectBody!).toBe(false);
    expect('vendorInvoiceRef' in capturedDirectBody!).toBe(false);
    expect('printedMrp' in (capturedDirectBody!.lines as Record<string, unknown>[])[0]!).toBe(false);

    await api.createStockReceipt(
      {
        vendorId: 'v-1',
        receivedDate: '2026-11-25',
        poId: 'po-1',
        vendorInvoiceRef: 'INV-99',
        lines: [
          {
            skuId: 'sku-2',
            poLineId: 'pol-2',
            quantity: 8,
            unitCost: '1200.00',
            printedMrp: '1999.00',
            generateInternalTag: false,
          },
        ],
      },
      'idem-po-1',
    );

    expect(capturedHeaders!.get('Idempotency-Key')).toBe('idem-po-1');
    expect(capturedPoBody).toEqual({
      vendorId: 'v-1',
      receivedDate: '2026-11-25',
      poId: 'po-1',
      vendorInvoiceRef: 'INV-99',
      lines: [
        {
          skuId: 'sku-2',
          poLineId: 'pol-2',
          quantity: 8,
          unitCost: '1200.00',
          printedMrp: '1999.00',
          generateInternalTag: false,
        },
      ],
    });
  });

  it('preserves leading zeros on barcode lookup and registration and queries inventory/labels cleanly', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/v1/auth/csrf') {
        return jsonResponse({ csrfToken: 'csrf-inv' });
      }
      if (url === '/api/v1/barcodes/lookup?code=00890123456') {
        return jsonResponse({
          code: '00890123456',
          mappingType: 'BRAND',
          skuId: 'sku-1',
          name: 'Cotton Vest',
          size: '32',
          defaultSellingPrice: '220.00',
          sellableQuantity: 4,
          batchId: null,
          printedMrp: null,
          batchSellableQuantity: null,
          requiresBatchSelection: false,
          eligibleBatches: [],
        });
      }
      if (url === '/api/v1/barcodes' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({
          code: '00890123456',
          skuId: 'sku-1',
        });
        return jsonResponse(
          {
            barcodeMappingId: 'bm-1',
            code: '00890123456',
            sourceType: 'BRAND',
            skuId: 'sku-1',
            batchId: null,
          },
          201,
        );
      }
      if (url === '/api/v1/stock-batches/batch-1/label' && init?.method === 'POST') {
        return jsonResponse({
          batchId: 'batch-1',
          code: 'BGD00000001',
          shopName: 'Bagade Clothing',
          productName: 'Silk Saree',
          size: null,
          displayPrice: '4500.00',
          barcode: 'BGD00000001',
          textCode: 'BGD00000001',
        });
      }
      if (url.startsWith('/api/v1/inventory?')) {
        return jsonResponse({ items: [], page: 0, size: 25, total: 0 });
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
    });

    const api = createInventoryApi(
      createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch }),
    );

    const looked = await api.lookupBarcode(' 00890123456 ');
    expect(looked.code).toBe('00890123456');

    const registered = await api.registerBarcode({ code: '00890123456', skuId: 'sku-1' });
    expect(registered.code).toBe('00890123456');

    const label = await api.generateBatchLabel('batch-1');
    expect(label.barcode).toBe('BGD00000001');

    await api.listInventory({ q: 'saree', categoryId: 'cat-1', skuId: 'sku-1', page: 0, size: 25 });
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe(
      '/api/v1/inventory?skuId=sku-1&categoryId=cat-1&q=saree&page=0&size=25',
    );
  });
});
