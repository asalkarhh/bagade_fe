import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../api/client.ts';
import { formatSignedInrDisplay } from '../utils/inrPrice.ts';
import { formatReportMoneyOrUnavailable } from './reportUtils.ts';
import { createReportsApi } from './reportsApi.ts';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('reportsApi and formatting helpers', () => {
  it('queries all five reporting endpoints with expected query parameters and preserves session on 403', async () => {
    const requestedUrls: string[] = [];
    const onUnauthorized = vi.fn();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);

      if (url.startsWith('/api/v1/reports/sales?')) {
        return jsonResponse({
          from: '2026-11-01',
          to: '2026-11-26',
          categoryId: 'cat-1',
          skuId: null,
          minPrice: '500.00',
          maxPrice: '5000.00',
          netUnitsSold: 0,
          netSales: '0.00',
          cogs: '0.00',
          grossProfit: '0.00',
          costComplete: true,
          nonSellableReturnUnits: 0,
          nonSellableReturnCost: '0.00',
          nonSellableReturnSalesValue: '0.00',
          operatingExpenses: null,
          estimatedProfit: null,
          items: [],
          page: 0,
          size: 25,
          total: 0,
        });
      }
      if (url.startsWith('/api/v1/reports/vendors?')) {
        return jsonResponse({
          from: '2026-11-01',
          to: '2026-11-26',
          snapshotDate: '2026-11-26',
          vendorId: 'v-1',
          categoryId: null,
          totalReceivedUnits: 0,
          totalDirectBatchSoldUnits: 0,
          totalFifoSoldUnits: 0,
          totalNetSoldUnits: 0,
          totalRemainingSellableUnits: 0,
          totalSellThroughPercentage: null,
          totalGrossMargin: '0.00',
          costComplete: true,
          weightedDaysFromReceiptToSale: null,
          items: [],
          page: 0,
          size: 25,
          total: 0,
        });
      }
      if (url.startsWith('/api/v1/reports/stock-ageing?')) {
        return jsonResponse({
          asOfDate: '2026-11-26',
          totalSellableUnits: 0,
          totalStockValue: '0.00',
          costComplete: true,
          unknownReceiptDateUnits: 0,
          unknownCostUnits: 0,
          items: [],
          page: 0,
          size: 10,
          total: 0,
        });
      }
      if (url.startsWith('/api/v1/reports/collections?')) {
        return jsonResponse({
          from: '2026-11-01',
          to: '2026-11-20',
          customerId: 'cust-1',
          cashCollected: '0.00',
          upiCollected: '0.00',
          totalCollections: '0.00',
          cashRefunded: '0.00',
          upiRefunded: '0.00',
          totalRefunds: '0.00',
          netCollections: '0.00',
          creditSales: '0.00',
          outstandingBalanceAsOfEnd: '500.00',
          items: [],
          page: 0,
          size: 25,
          total: 0,
        });
      }
      if (url.startsWith('/api/v1/reports/stock-audits?')) {
        return jsonResponse(
          { code: 'ACCESS_DENIED', message: 'Access denied', requestId: 'req-403' },
          403,
        );
      }

      throw new Error(`Unexpected URL ${url}`);
    });

    const client = createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch });
    client.setUnauthorizedHandler(onUnauthorized);
    const api = createReportsApi(client);

    await api.getSalesReport({
      from: '2026-11-01',
      to: '2026-11-26',
      categoryId: 'cat-1',
      minPrice: '500.00',
      maxPrice: '5000.00',
      page: 0,
      size: 25,
    });
    await api.getVendorReport({
      from: '2026-11-01',
      to: '2026-11-26',
      snapshotDate: '2026-11-26',
      vendorId: 'v-1',
      page: 0,
      size: 25,
    });
    await api.getStockAgeingReport({
      categoryId: 'cat-1',
      skuId: 'sku-1',
      vendorId: 'v-1',
      page: 1,
      size: 10,
    });
    await api.getCollectionsReport({
      from: '2026-11-01',
      to: '2026-11-20',
      customerId: 'cust-1',
      page: 0,
      size: 25,
    });

    await expect(
      api.getStockAuditReport({
        from: '2026-11-01',
        to: '2026-11-26',
        page: 0,
        size: 25,
      }),
    ).rejects.toMatchObject({ kind: 'forbidden', status: 403 });

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(requestedUrls).toEqual([
      '/api/v1/reports/sales?from=2026-11-01&to=2026-11-26&categoryId=cat-1&minPrice=500.00&maxPrice=5000.00&page=0&size=25',
      '/api/v1/reports/vendors?from=2026-11-01&to=2026-11-26&snapshotDate=2026-11-26&vendorId=v-1&page=0&size=25',
      '/api/v1/reports/stock-ageing?categoryId=cat-1&skuId=sku-1&vendorId=v-1&page=1&size=10',
      '/api/v1/reports/collections?from=2026-11-01&to=2026-11-20&customerId=cust-1&page=0&size=25',
      '/api/v1/reports/stock-audits?from=2026-11-01&to=2026-11-26&page=0&size=25',
    ]);
  });

  it('formats signed INR figures and preserves actual zero vs incomplete cost', () => {
    expect(formatSignedInrDisplay('-15000.00')).toBe('-₹15,000.00');
    expect(formatSignedInrDisplay('0.00')).toBe('₹0.00');
    expect(formatReportMoneyOrUnavailable('0.00', true)).toBe('₹0.00');
    expect(formatReportMoneyOrUnavailable(null, false)).toBe('Unavailable (cost incomplete)');
    expect(formatReportMoneyOrUnavailable('100.00', false)).toBe('Unavailable (cost incomplete)');
  });
});
