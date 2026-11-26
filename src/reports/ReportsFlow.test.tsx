import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App.tsx';
import { createApiClient } from '../api/client.ts';
import { ApiClientError } from '../api/errors.ts';
import { SessionProvider } from '../auth/SessionContext.tsx';
import type { BillingApi } from '../billing/billingApi.ts';
import type { CatalogApi } from '../catalog/catalogApi.ts';
import type { PurchasingApi } from '../purchasing/purchasingApi.ts';
import { CollectionsReportPage } from './CollectionsReportPage.tsx';
import { ReportsLayout } from './ReportsLayout.tsx';
import type { ReportsApi } from './reportsApi.ts';
import { SalesReportPage } from './SalesReportPage.tsx';
import { StockAgeingReportPage } from './StockAgeingReportPage.tsx';
import { StockAuditReportPage } from './StockAuditReportPage.tsx';
import type {
  CollectionsReport,
  SalesReport,
  StockAgeingReport,
  StockAuditReport,
  VendorReport,
} from './types.ts';
import { VendorReportPage } from './VendorReportPage.tsx';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeMockReportsApi(overrides: Partial<ReportsApi> = {}): ReportsApi {
  return {
    getSalesReport: vi.fn(),
    getVendorReport: vi.fn(),
    getStockAgeingReport: vi.fn(),
    getCollectionsReport: vi.fn(),
    getStockAuditReport: vi.fn(),
    ...overrides,
  };
}

function makeMockCatalogApi(overrides: Partial<CatalogApi> = {}): CatalogApi {
  return {
    listAllCategories: vi.fn(async () => [{ categoryId: 'cat-1', name: 'Sarees', parentId: null }]),
    createCategory: vi.fn(),
    createProduct: vi.fn(),
    createSku: vi.fn(),
    listSkus: vi.fn(async () => ({ items: [], page: 0, size: 25, total: 0 })),
    updateSku: vi.fn(),
    findLatestSkuById: vi.fn(async () => null),
    ...overrides,
  };
}

function makeMockPurchasingApi(overrides: Partial<PurchasingApi> = {}): PurchasingApi {
  return {
    listVendors: vi.fn(async () => ({ items: [], page: 0, size: 25, total: 0 })),
    listAllVendors: vi.fn(async () => []),
    createVendor: vi.fn(),
    listPurchaseOrders: vi.fn(async () => ({ items: [], page: 0, size: 25, total: 0 })),
    getPurchaseOrder: vi.fn(),
    createPurchaseOrder: vi.fn(),
    cancelPurchaseOrderRemainder: vi.fn(),
    ...overrides,
  };
}

function makeMockBillingApi(overrides: Partial<BillingApi> = {}): BillingApi {
  return {
    listCustomers: vi.fn(async () => ({ items: [], page: 0, size: 10, total: 0 })),
    createCustomer: vi.fn(),
    previewBill: vi.fn(),
    createBill: vi.fn(),
    listBills: vi.fn(async () => ({ items: [], page: 0, size: 25, total: 0 })),
    getBill: vi.fn(),
    getBillPrintData: vi.fn(),
    downloadBillPdf: vi.fn(),
    reviseBill: vi.fn(),
    returnItems: vi.fn(),
    exchangeItems: vi.fn(),
    cancelBill: vi.fn(),
    collectPayment: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FE08 Owner Reports', () => {
  it('shows whole-shop sales/expenses/estimated profit, omits expenses when category-filtered, shows incomplete margin vs zero, and validates ranges before loading', async () => {
    const user = userEvent.setup();
    const wholeShopReport: SalesReport = {
      from: '2026-11-01',
      to: '2026-11-26',
      categoryId: null,
      skuId: null,
      minPrice: null,
      maxPrice: null,
      netUnitsSold: 4,
      netSales: '5000.00',
      cogs: '3000.00',
      grossProfit: '2000.00',
      costComplete: true,
      nonSellableReturnUnits: 1,
      nonSellableReturnCost: '400.00',
      nonSellableReturnSalesValue: '700.00',
      operatingExpenses: '1500.00',
      estimatedProfit: '500.00',
      items: [
        {
          skuId: 'sku-1',
          skuCode: 'SAR-1',
          productName: 'Silk Saree',
          size: null,
          netUnitsSold: 4,
          netSales: '5000.00',
          cogs: '3000.00',
          grossProfit: '2000.00',
          costComplete: true,
          nonSellableReturnUnits: 1,
          nonSellableReturnCost: '400.00',
          nonSellableReturnSalesValue: '700.00',
        },
      ],
      page: 0,
      size: 25,
      total: 1,
    };

    const filteredIncompleteReport: SalesReport = {
      ...wholeShopReport,
      categoryId: 'cat-1',
      netUnitsSold: 2,
      netSales: '800.00',
      cogs: null,
      grossProfit: null,
      costComplete: false,
      operatingExpenses: null,
      estimatedProfit: null,
      items: [
        {
          skuId: 'sku-surplus',
          skuCode: 'DUP-SUR',
          productName: 'Surplus Dupatta',
          size: null,
          netUnitsSold: 2,
          netSales: '800.00',
          cogs: null,
          grossProfit: null,
          costComplete: false,
          nonSellableReturnUnits: 0,
          nonSellableReturnCost: '0.00',
          nonSellableReturnSalesValue: '0.00',
        },
      ],
    };

    const getSalesReport = vi.fn(async (params) =>
      params.categoryId ? filteredIncompleteReport : wholeShopReport,
    );

    const api = makeMockReportsApi({ getSalesReport });

    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route path="/reports" element={<ReportsLayout />}>
            <Route index element={<SalesReportPage api={api} catalog={makeMockCatalogApi()} />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Operating Expenses')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('₹5,000.00')).toBeInTheDocument();
    expect(screen.getByText('₹1,500.00')).toBeInTheDocument();
    expect(screen.getByText('Estimated Profit')).toBeInTheDocument();
    expect(screen.getByText('₹500.00')).toBeInTheDocument();

    // Reject invalid price range client-side before hitting API
    await user.type(screen.getByLabelText('Min Selling Price (INR)'), '2000');
    await user.type(screen.getByLabelText('Max Selling Price (INR)'), '1000');
    await user.click(screen.getByRole('button', { name: 'Apply Filters' }));

    expect(
      await screen.findByText('Minimum selling price must not exceed maximum selling price.'),
    ).toBeInTheDocument();
    expect(getSalesReport).toHaveBeenCalledTimes(1);

    // Clear prices and filter by Sarees -> expenses omitted and incomplete margin shown
    await user.clear(screen.getByLabelText('Min Selling Price (INR)'));
    await user.clear(screen.getByLabelText('Max Selling Price (INR)'));
    await user.selectOptions(screen.getByLabelText('Category'), 'cat-1');
    await user.click(screen.getByRole('button', { name: 'Apply Filters' }));

    expect(await screen.findByText(/Margin is incomplete:/i)).toBeInTheDocument();
    expect(screen.queryByText('Estimated Profit')).not.toBeInTheDocument();
    expect(screen.getByText(/Whole-shop operating expenses are not subtracted/i)).toBeInTheDocument();
  });

  it('distinguishes FIFO, Direct Batch, and Unknown Attribution audit surplus in Vendor Report', async () => {
    const vendorReport: VendorReport = {
      from: '2026-11-01',
      to: '2026-11-20',
      snapshotDate: '2026-11-26',
      vendorId: null,
      categoryId: null,
      totalReceivedUnits: 10,
      totalDirectBatchSoldUnits: 1,
      totalFifoSoldUnits: 2,
      totalNetSoldUnits: 3,
      totalRemainingSellableUnits: 6,
      totalSellThroughPercentage: '30.00',
      totalGrossMargin: null,
      costComplete: false,
      weightedDaysFromReceiptToSale: '7.50',
      items: [
        {
          vendorId: 'v-1',
          vendorName: 'Alpha Weaves',
          batchSource: 'VENDOR',
          receivedUnits: 4,
          directBatchSoldUnits: 0,
          fifoSoldUnits: 1,
          netSoldUnits: 1,
          remainingSellableUnits: 2,
          sellThroughPercentage: '25.00',
          grossMargin: '300.00',
          costComplete: true,
          weightedDaysFromReceiptToSale: '9.00',
        },
        {
          vendorId: 'v-2',
          vendorName: 'Beta Looms',
          batchSource: 'VENDOR',
          receivedUnits: 4,
          directBatchSoldUnits: 1,
          fifoSoldUnits: 0,
          netSoldUnits: 1,
          remainingSellableUnits: 3,
          sellThroughPercentage: '25.00',
          grossMargin: '280.00',
          costComplete: true,
          weightedDaysFromReceiptToSale: '5.00',
        },
        {
          vendorId: null,
          vendorName: 'Unknown Vendor (Audit Surplus)',
          batchSource: 'AUDIT_SURPLUS',
          receivedUnits: 2,
          directBatchSoldUnits: 0,
          fifoSoldUnits: 1,
          netSoldUnits: 1,
          remainingSellableUnits: 1,
          sellThroughPercentage: '50.00',
          grossMargin: null,
          costComplete: false,
          weightedDaysFromReceiptToSale: '1.00',
        },
      ],
      page: 0,
      size: 25,
      total: 3,
    };

    const api = makeMockReportsApi({
      getVendorReport: vi.fn(async () => vendorReport),
    });

    render(
      <MemoryRouter initialEntries={['/reports/vendors']}>
        <VendorReportPage
          api={api}
          catalog={makeMockCatalogApi()}
          purchasing={makeMockPurchasingApi()}
        />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Snapshot Date:/i)).toBeInTheDocument();
    expect(screen.getByText('Alpha Weaves')).toBeInTheDocument();
    expect(screen.getByText('Beta Looms')).toBeInTheDocument();
    expect(screen.getByText('Unknown Vendor (Audit Surplus)')).toBeInTheDocument();
    expect(screen.getByText('Unknown Attribution (Audit Surplus)')).toBeInTheDocument();
    expect(screen.getByText('Direct batch: 1 · FIFO: 2')).toBeInTheDocument();
    expect(screen.getByText('Unavailable (incomplete cost)')).toBeInTheDocument();
  });

  it('keeps unknown-date and unknown-cost batches visible in Stock Ageing Report', async () => {
    const ageingReport: StockAgeingReport = {
      asOfDate: '2026-11-26',
      totalSellableUnits: 5,
      totalStockValue: null,
      costComplete: false,
      unknownReceiptDateUnits: 2,
      unknownCostUnits: 2,
      items: [
        {
          batchId: 'batch-known',
          skuId: 'sku-1',
          skuCode: 'SAR-1',
          productName: 'Silk Saree',
          size: null,
          batchSource: 'RECEIPT',
          vendorId: 'v-1',
          vendorName: 'Heritage Mills',
          receiptDate: '2026-11-01',
          receiptDateKnown: true,
          daysOnHand: 25,
          sellableQuantity: 3,
          unitCost: '3000.00',
          costKnown: true,
          stockValue: '9000.00',
        },
        {
          batchId: 'batch-unknown',
          skuId: 'sku-2',
          skuCode: 'DUP-SUR',
          productName: 'Surplus Dupatta',
          size: null,
          batchSource: 'AUDIT_SURPLUS',
          vendorId: null,
          vendorName: 'Unknown Vendor (Audit Surplus)',
          receiptDate: null,
          receiptDateKnown: false,
          daysOnHand: null,
          sellableQuantity: 2,
          unitCost: null,
          costKnown: false,
          stockValue: null,
        },
      ],
      page: 0,
      size: 25,
      total: 2,
    };

    const api = makeMockReportsApi({
      getStockAgeingReport: vi.fn(async () => ageingReport),
    });

    render(
      <MemoryRouter initialEntries={['/reports/stock-ageing']}>
        <StockAgeingReportPage
          api={api}
          catalog={makeMockCatalogApi()}
          purchasing={makeMockPurchasingApi()}
        />
      </MemoryRouter>
    );

    expect(await screen.findByText('Silk Saree')).toBeInTheDocument();
    expect(screen.getByText('Surplus Dupatta')).toBeInTheDocument();
    expect(screen.getByText('25 d')).toBeInTheDocument();
    expect(screen.getByText('₹9,000.00')).toBeInTheDocument();
    expect(screen.getByText('Unknown receipt date')).toBeInTheDocument();
    expect(screen.getByText('Age unavailable')).toBeInTheDocument();
    expect(screen.getByText('Unknown cost')).toBeInTheDocument();
    expect(screen.getByText('Value unavailable')).toBeInTheDocument();
  });

  it('shows end date beside outstanding credit in Collections and renders zero-adjustment audits plus empty state in Stock Audits', async () => {
    const user = userEvent.setup();
    const collectionsReport: CollectionsReport = {
      from: '2026-11-01',
      to: '2026-11-15',
      customerId: null,
      cashCollected: '4000.00',
      upiCollected: '900.00',
      totalCollections: '4900.00',
      cashRefunded: '0.00',
      upiRefunded: '400.00',
      totalRefunds: '400.00',
      netCollections: '4500.00',
      creditSales: '500.00',
      outstandingBalanceAsOfEnd: '500.00',
      items: [
        {
          customerId: 'c-1',
          customerName: 'Meera Joshi',
          customerContact: '9876500001',
          cashCollected: '1000.00',
          upiCollected: '400.00',
          totalCollections: '1400.00',
          totalRefunds: '400.00',
          netCollections: '1000.00',
          creditSales: '500.00',
          outstandingBalanceAsOfEnd: '500.00',
        },
      ],
      page: 0,
      size: 25,
      total: 1,
    };

    const auditsFirst: StockAuditReport = {
      from: '2026-11-01',
      to: '2026-11-26',
      totalPositiveAdjustment: 2,
      totalNegativeAdjustment: 1,
      netAdjustment: 1,
      items: [
        {
          stockCountId: 'sc-1',
          countLineId: 'scl-1',
          scope: 'SHOP',
          skuId: 'sku-1',
          skuCode: 'SAR-1',
          productName: 'Banarasi Saree',
          size: null,
          expectedQuantity: 5,
          countedQuantity: 5,
          adjustment: 0,
          reason: null,
          postedByUserId: 'u-w',
          postedByUsername: 'worker1',
          postedByDisplayName: 'Counter Staff',
          postedAt: '2026-11-25T10:00:00Z',
        },
      ],
      page: 0,
      size: 25,
      total: 1,
    };

    const auditsEmpty: StockAuditReport = {
      ...auditsFirst,
      totalPositiveAdjustment: 0,
      totalNegativeAdjustment: 0,
      netAdjustment: 0,
      items: [],
      total: 0,
    };

    let auditCalls = 0;
    const api = makeMockReportsApi({
      getCollectionsReport: vi.fn(async () => collectionsReport),
      getStockAuditReport: vi.fn(async () => {
        auditCalls += 1;
        return auditCalls === 1 ? auditsFirst : auditsEmpty;
      }),
    });

    const { unmount } = render(
      <MemoryRouter initialEntries={['/reports/collections']}>
        <CollectionsReportPage api={api} billing={makeMockBillingApi()} />
      </MemoryRouter>
    );

    expect(
      await screen.findByText('Outstanding Credit (as of 2026-11-15)'),
    ).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Meera Joshi')).toBeInTheDocument();
    unmount();

    render(
      <MemoryRouter initialEntries={['/reports/stock-audits']}>
        <StockAuditReportPage api={api} catalog={makeMockCatalogApi()} />
      </MemoryRouter>
    );

    expect(await screen.findByText('Banarasi Saree')).toBeInTheDocument();
    expect(screen.getByText('0 (Match)')).toBeInTheDocument();
    expect(screen.getByText(/Counter Staff/i)).toBeInTheDocument();

    // Filtering with empty result triggers empty state
    await user.selectOptions(screen.getByLabelText('Category'), 'cat-1');
    await user.click(screen.getByRole('button', { name: 'Apply Filters' }));

    expect(
      await screen.findByText(/No posted stock counts matched the selected/i),
    ).toBeInTheDocument();
  });

  it('denies WORKER access to /reports and /what-to-buy and keeps session intact if an API returns 403', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/auth/session') {
        return jsonResponse({ userId: 'worker-uuid', name: 'Counter Staff', role: 'WORKER' });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const client = createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    const { unmount } = render(
      <SessionProvider client={client}>
        <MemoryRouter initialEntries={['/reports/vendors']}>
          <AppRoutes />
        </MemoryRouter>
      </SessionProvider>
    );

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(nav).not.toHaveTextContent('Reports');
    expect(nav).not.toHaveTextContent('What to Buy');
    unmount();

    // Direct /reports call receives 403 -> shows error banner without clearing active session
    const ownerFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/auth/session') {
        return jsonResponse({ userId: 'owner-uuid', name: 'Shop Owner', role: 'OWNER' });
      }
      if (url.startsWith('/api/v1/categories')) {
        return jsonResponse({ items: [], page: 0, size: 100, total: 0 });
      }
      if (url.startsWith('/api/v1/reports/sales')) {
        return jsonResponse({ code: 'ACCESS_DENIED', message: 'Forbidden report', requestId: 'r-403' }, 403);
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(ownerFetch as unknown as typeof fetch);
    const ownerClient = createApiClient({ fetchImpl: ownerFetch as unknown as typeof fetch });
    render(
      <SessionProvider client={ownerClient}>
        <MemoryRouter initialEntries={['/reports']}>
          <AppRoutes />
        </MemoryRouter>
      </SessionProvider>
    );

    expect(await screen.findByText('Forbidden report')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    });
  });

  it('prevents stale earlier responses from replacing newer report filters using AbortController/sequence check', async () => {
    let resolveSlow!: (val: SalesReport) => void;
    let call = 0;
    const baseReport: SalesReport = {
      from: '2026-11-01',
      to: '2026-11-26',
      categoryId: null,
      skuId: null,
      minPrice: null,
      maxPrice: null,
      netUnitsSold: 1,
      netSales: '100.00',
      cogs: '50.00',
      grossProfit: '50.00',
      costComplete: true,
      nonSellableReturnUnits: 0,
      nonSellableReturnCost: '0.00',
      nonSellableReturnSalesValue: '0.00',
      operatingExpenses: '0.00',
      estimatedProfit: '50.00',
      items: [],
      page: 0,
      size: 25,
      total: 0,
    };

    const getSalesReport = vi.fn((params) => {
      call += 1;
      if (call === 1) {
        return Promise.resolve({ ...baseReport, netSales: '999.00' });
      }
      if (params.categoryId === 'cat-1') {
        return new Promise<SalesReport>((resolve) => {
          resolveSlow = resolve;
        });
      }
      return Promise.resolve({ ...baseReport, netSales: '250.00', minPrice: '200.00' });
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/reports']}>
        <SalesReportPage
          api={makeMockReportsApi({ getSalesReport })}
          catalog={makeMockCatalogApi()}
        />
      </MemoryRouter>
    );

    expect(await screen.findByText('₹999.00')).toBeInTheDocument();

    // Start slow category query
    await user.selectOptions(screen.getByLabelText('Category'), 'cat-1');
    await user.click(screen.getByRole('button', { name: 'Apply Filters' }));

    // Immediately change filter to all categories + minPrice 200 -> fast result arrives
    await user.selectOptions(screen.getByLabelText('Category'), '');
    await user.type(screen.getByLabelText('Min Selling Price (INR)'), '200');
    await user.click(screen.getByRole('button', { name: 'Apply Filters' }));

    expect(await screen.findByText('₹250.00')).toBeInTheDocument();

    // Now resolve earlier slow call with distinctive amount -> must be ignored!
    resolveSlow({ ...baseReport, categoryId: 'cat-1', netSales: '7777.00' });
    await waitFor(() => {
      expect(screen.queryByText('₹7,777.00')).not.toBeInTheDocument();
    });
    expect(screen.getByText('₹250.00')).toBeInTheDocument();
  });

  it('rejects error thrown cleanly on network failure with retry capability in SalesReportPage', async () => {
    const user = userEvent.setup();
    let count = 0;
    const getSalesReport = vi.fn(async () => {
      count += 1;
      if (count === 1) {
        throw new ApiClientError({
          kind: 'network',
          status: null,
          code: 'NETWORK_ERROR',
          message: 'Network timeout loading sales report',
          retryable: true,
        });
      }
      return {
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
      };
    });

    render(
      <MemoryRouter initialEntries={['/reports']}>
        <SalesReportPage
          api={makeMockReportsApi({ getSalesReport })}
          catalog={makeMockCatalogApi()}
        />
      </MemoryRouter>
    );

    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('0 SKUs sold in period')).toBeInTheDocument();
  });
});
