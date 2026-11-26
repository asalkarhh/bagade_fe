import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../api/client.ts';
import { createBillingApi } from './billingApi.ts';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('billingApi', () => {
  it('serializes preview, bill creation with Idempotency-Key, bill filters, print JSON/PDF, and customer CRUD', async () => {
    const requests: { url: string; method: string; headers: Headers; body?: unknown }[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const headers = new Headers(init?.headers);
      let body: unknown;
      if (typeof init?.body === 'string') {
        body = JSON.parse(init.body);
      }
      requests.push({ url, method, headers, body });

      if (url === '/api/v1/auth/csrf') {
        return jsonResponse({ csrfToken: 'csrf-bill' });
      }
      if (url === '/api/v1/customers' && method === 'POST') {
        return jsonResponse({ customerId: 'cust-1', name: 'Asha Devi', contact: '9876543210' }, 201);
      }
      if (url.startsWith('/api/v1/customers?')) {
        return jsonResponse({ items: [], page: 0, size: 10, total: 0 });
      }
      if (url === '/api/v1/bills/preview') {
        return jsonResponse({
          lines: [],
          subtotal: '1200.00',
          discountTotal: '50.00',
          total: '1150.00',
          canCheckout: true,
        });
      }
      if (url === '/api/v1/bills' && method === 'POST') {
        return jsonResponse(
          {
            billId: 'bill-1',
            billNumber: 'BILL-2026-0001',
            version: 1,
            issueDate: '2026-11-26',
            issuedAt: '2026-11-26T04:00:00Z',
            status: 'ISSUED',
            subtotal: '1200.00',
            discountTotal: '50.00',
            total: '1150.00',
            paid: '1150.00',
            balanceDue: '0.00',
            allocations: [],
          },
          201,
        );
      }
      if (url.startsWith('/api/v1/bills?')) {
        return jsonResponse({ items: [], page: 0, size: 25, total: 0 });
      }
      if (url.includes('/bills/bill-1/print?format=pdf')) {
        return new Response(new Blob(['%PDF-1.4\n'], { type: 'application/pdf' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="BILL-2026-0001-rev2.pdf"',
          },
        });
      }
      if (url.includes('/bills/bill-1/print?format=json')) {
        return jsonResponse({
          shopName: 'Bagade Sarees',
          receiptProfile: 'THERMAL_80MM',
          billId: 'bill-1',
          billNumber: 'BILL-2026-0001',
          status: 'ISSUED',
          revisionNumber: 2,
          issueDate: '2026-11-26',
          issuedAt: '2026-11-26T04:00:00Z',
          customerName: null,
          customerContact: null,
          lines: [],
          subtotal: '1200.00',
          discountTotal: '50.00',
          total: '1150.00',
          paid: '1150.00',
          balanceDue: '0.00',
          payments: [],
          corrections: [],
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    const api = createBillingApi(
      createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch }),
    );

    await api.createCustomer({ name: '  Asha Devi  ', contact: '   ' });
    const createCustReq = requests.find(
      (r) => r.url === '/api/v1/customers' && r.method === 'POST',
    );
    expect(createCustReq?.body).toEqual({ name: 'Asha Devi' });

    await api.previewBill([
      { skuId: 'sku-1', quantity: 2, batchId: null, discountAmount: ' ', unitPriceOverride: '' },
      {
        skuId: 'sku-2',
        quantity: 1,
        batchId: 'batch-9',
        discountAmount: '50.00',
        unitPriceOverride: '900.00',
      },
    ]);
    const previewReq = requests.find((r) => r.url === '/api/v1/bills/preview');
    expect(previewReq?.body).toEqual({
      lines: [
        { skuId: 'sku-1', quantity: 2 },
        {
          skuId: 'sku-2',
          quantity: 1,
          batchId: 'batch-9',
          discountAmount: '50.00',
          unitPriceOverride: '900.00',
        },
      ],
    });

    await api.createBill(
      {
        lines: [{ skuId: 'sku-1', quantity: 1 }],
        expectedTotal: '1150.00',
        payments: [{ mode: 'UPI', amount: '1150.00', reference: '  UTR9988  ' }],
      },
      'idem-bill-1',
    );
    const createBillReq = requests.find((r) => r.url === '/api/v1/bills' && r.method === 'POST');
    expect(createBillReq?.headers.get('Idempotency-Key')).toBe('idem-bill-1');
    expect(createBillReq?.headers.get('X-CSRF-Token')).toBe('csrf-bill');
    expect(createBillReq?.body).toEqual({
      lines: [{ skuId: 'sku-1', quantity: 1 }],
      expectedTotal: '1150.00',
      payments: [{ mode: 'UPI', amount: '1150.00', reference: 'UTR9988' }],
    });

    await api.listBills({
      billNumber: ' BILL-2026 ',
      from: '2026-11-01',
      to: '2026-11-26',
      customerId: 'cust-1',
      page: 1,
      size: 25,
    });
    const listBillsReq = requests.find((r) => r.url.startsWith('/api/v1/bills?'));
    expect(listBillsReq?.url).toBe(
      '/api/v1/bills?billNumber=BILL-2026&from=2026-11-01&to=2026-11-26&customerId=cust-1&page=1&size=25',
    );

    const printData = await api.getBillPrintData('bill-1', 2);
    expect(printData.revisionNumber).toBe(2);
    expect(
      requests.some((r) => r.url === '/api/v1/bills/bill-1/print?format=json&revision=2'),
    ).toBe(true);

    const pdf = await api.downloadBillPdf('bill-1', 2);
    expect(pdf.filename).toBe('BILL-2026-0001-rev2.pdf');
    expect(
      requests.some((r) => r.url === '/api/v1/bills/bill-1/print?format=pdf&revision=2'),
    ).toBe(true);
  });

  it('sends FE06 revision, return, exchange, cancellation, and credit payment payloads with Idempotency-Key and CSRF', async () => {
    const requests: { url: string; method: string; headers: Headers; body: unknown }[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const headers = new Headers(init?.headers);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      if (url === '/api/v1/auth/csrf') {
        return jsonResponse({ csrfToken: 'csrf-fe06' });
      }
      requests.push({ url, method, headers, body });

      if (url === '/api/v1/bills/bill-1/revisions') {
        return jsonResponse({
          billId: 'bill-1',
          revision: 2,
          version: 1,
          total: '8500.00',
          adjustmentAmount: '-500.00',
          balanceDue: '0.00',
        });
      }
      if (url === '/api/v1/bills/bill-1/returns') {
        return jsonResponse(
          {
            returnId: 'ret-1',
            billId: 'bill-1',
            version: 2,
            balanceDue: '0.00',
            stockEffects: [],
          },
          201,
        );
      }
      if (url === '/api/v1/bills/bill-1/exchanges') {
        return jsonResponse(
          {
            exchangeId: 'exch-1',
            billId: 'bill-1',
            version: 3,
            priceDifference: '150.00',
            balanceDue: '0.00',
            stockEffects: [],
          },
          201,
        );
      }
      if (url === '/api/v1/bills/bill-1/cancellations') {
        return jsonResponse({
          billId: 'bill-1',
          version: 4,
          status: 'CANCELLED',
          balanceDue: '0.00',
        });
      }
      if (url === '/api/v1/bills/bill-1/payments') {
        return jsonResponse(
          {
            paymentId: 'pay-9',
            billId: 'bill-1',
            version: 5,
            balanceDue: '200.00',
          },
          201,
        );
      }
      throw new Error(`Unexpected ${method} ${url}`);
    });

    const api = createBillingApi(
      createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch }),
    );

    await api.reviseBill(
      'bill-1',
      {
        expectedVersion: 0,
        reason: '  Agreed price discount  ',
        lines: [
          {
            lineId: 'll-1',
            skuId: 'sku-1',
            quantity: 2,
            unitPriceOverride: '4250.00',
            discountAmount: '',
          },
        ],
        expectedTotal: '8500.00',
        settlement: [
          { direction: 'REFUND', mode: 'CASH', amount: '500.00', reference: '  CASH-REF  ' },
        ],
      },
      'idem-rev-1',
    );
    expect(requests[0]).toMatchObject({
      url: '/api/v1/bills/bill-1/revisions',
      body: {
        expectedVersion: 0,
        reason: 'Agreed price discount',
        lines: [{ lineId: 'll-1', skuId: 'sku-1', quantity: 2, unitPriceOverride: '4250.00' }],
        expectedTotal: '8500.00',
        settlement: [
          { direction: 'REFUND', mode: 'CASH', amount: '500.00', reference: 'CASH-REF' },
        ],
      },
    });
    expect(requests[0].headers.get('Idempotency-Key')).toBe('idem-rev-1');

    await api.returnItems(
      'bill-1',
      {
        expectedVersion: 1,
        reason: 'Damaged piece',
        returnedLines: [{ lineId: 'll-1', quantity: 1, disposition: 'NON_SELLABLE' }],
        settlement: [],
      },
      'idem-ret-1',
    );
    expect(requests[1].headers.get('Idempotency-Key')).toBe('idem-ret-1');
    expect(requests[1].body).toEqual({
      expectedVersion: 1,
      reason: 'Damaged piece',
      returnedLines: [{ lineId: 'll-1', quantity: 1, disposition: 'NON_SELLABLE' }],
      settlement: [],
    });

    await api.exchangeItems(
      'bill-1',
      {
        expectedVersion: 2,
        reason: 'Size 32 to 34',
        returnedLines: [{ lineId: 'll-32', quantity: 1, disposition: 'SELLABLE' }],
        replacementLines: [{ skuId: 'sku-34', quantity: 1, batchId: 'b-34' }],
        settlement: [{ direction: 'PAYMENT', mode: 'UPI', amount: '150.00', reference: 'U1' }],
      },
      'idem-exch-1',
    );
    expect(requests[2].headers.get('Idempotency-Key')).toBe('idem-exch-1');
    expect(requests[2].body).toEqual({
      expectedVersion: 2,
      reason: 'Size 32 to 34',
      returnedLines: [{ lineId: 'll-32', quantity: 1, disposition: 'SELLABLE' }],
      replacementLines: [{ skuId: 'sku-34', quantity: 1, batchId: 'b-34' }],
      settlement: [{ direction: 'PAYMENT', mode: 'UPI', amount: '150.00', reference: 'U1' }],
    });

    await api.cancelBill(
      'bill-1',
      {
        expectedVersion: 3,
        reason: 'Cancelled order',
        settlement: [{ direction: 'REFUND', mode: 'CASH', amount: '180.00' }],
      },
      'idem-cxl-1',
    );
    expect(requests[3].headers.get('Idempotency-Key')).toBe('idem-cxl-1');

    await api.collectPayment(
      'bill-1',
      { expectedVersion: 4, mode: 'UPI', amount: '300.00', reference: '   ' },
      'idem-pay-1',
    );
    expect(requests[4].headers.get('Idempotency-Key')).toBe('idem-pay-1');
    expect(requests[4].body).toEqual({
      expectedVersion: 4,
      mode: 'UPI',
      amount: '300.00',
    });
  });
});
