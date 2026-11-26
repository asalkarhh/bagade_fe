import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App.tsx';
import { createApiClient } from '../api/client.ts';
import { ApiClientError } from '../api/errors.ts';
import { SessionProvider } from '../auth/SessionContext.tsx';
import type { CatalogApi } from '../catalog/catalogApi.ts';
import type { Category } from '../catalog/types.ts';
import type { InventoryApi } from './inventoryApi.ts';
import { clearSessionStockCounts } from './sessionStockCounts.ts';
import { StockCountDetailPage } from './StockCountDetailPage.tsx';
import { StockCountsLandingPage } from './StockCountsLandingPage.tsx';
import type {
  BarcodeLookupResult,
  PostStockCountResponse,
  SaveStockCountLineResponse,
  StockCountDetail,
} from './types.ts';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeMockInventoryApi(overrides: Partial<InventoryApi> = {}): InventoryApi {
  return {
    createStockReceipt: vi.fn(),
    getStockReceipt: vi.fn(),
    lookupBarcode: vi.fn(),
    registerBarcode: vi.fn(),
    generateBatchLabel: vi.fn(),
    getBatchLabel: vi.fn(),
    listInventory: vi.fn(async () => ({ items: [], page: 0, size: 25, total: 0 })),
    createStockCount: vi.fn(),
    getStockCount: vi.fn(),
    saveStockCountLine: vi.fn(),
    postStockCount: vi.fn(),
    ...overrides,
  };
}

function makeMockCatalogApi(overrides: Partial<CatalogApi> = {}): CatalogApi {
  return {
    listAllCategories: vi.fn(async () => []),
    createCategory: vi.fn(),
    createProduct: vi.fn(),
    createSku: vi.fn(),
    listSkus: vi.fn(async () => ({ items: [], page: 0, size: 25, total: 0 })),
    updateSku: vi.fn(),
    findLatestSkuById: vi.fn(async () => null),
    ...overrides,
  };
}

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

afterEach(() => {
  clearSessionStockCounts();
  vi.restoreAllMocks();
  if (originalMediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
  } else {
    delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
  }
});

describe('FE07 Physical Stock Counts', () => {
  it('starts a category stock count, keeps size variants separate, enforces blank vs 0, and requires reason before posting', async () => {
    const user = userEvent.setup();
    const categories: Category[] = [
      { categoryId: 'cat-parent', name: 'Sarees', parentId: null },
      { categoryId: 'cat-silk', name: 'Silk Sarees', parentId: 'cat-parent' },
    ];

    let serverDetail: StockCountDetail = {
      countId: 'count-cat-1',
      scope: 'CATEGORY',
      categoryId: 'cat-silk',
      status: 'DRAFT',
      version: 0,
      createdAt: '2026-11-26T05:00:00Z',
      postedAt: null,
      postedBy: null,
      lines: [
        {
          skuId: 'sku-m',
          skuCode: 'KRT-BLK-M',
          productName: 'Cotton Kurti',
          size: 'M',
          countedQuantity: null,
          expectedQuantity: null,
          currentQuantity: 5,
          observedStockVersion: null,
          currentStockVersion: 1,
          reason: null,
        },
        {
          skuId: 'sku-l',
          skuCode: 'KRT-BLK-L',
          productName: 'Cotton Kurti',
          size: 'L',
          countedQuantity: null,
          expectedQuantity: null,
          currentQuantity: 2,
          observedStockVersion: null,
          currentStockVersion: 1,
          reason: null,
        },
      ],
    };

    const createStockCount = vi.fn(async () => ({
      countId: serverDetail.countId,
      scope: serverDetail.scope,
      categoryId: serverDetail.categoryId,
      status: serverDetail.status,
      version: 0,
      scopedSkus: serverDetail.lines.map((l) => ({
        skuId: l.skuId,
        skuCode: l.skuCode,
        productName: l.productName,
        size: l.size,
      })),
    }));

    const getStockCount = vi.fn(async () => ({
      ...serverDetail,
      lines: serverDetail.lines.map((l) => ({ ...l })),
    }));

    const saveStockCountLine = vi.fn(
      async (_countId, skuId, input): Promise<SaveStockCountLineResponse> => {
        serverDetail = {
          ...serverDetail,
          version: serverDetail.version + 1,
          lines: serverDetail.lines.map((l) =>
            l.skuId === skuId
              ? {
                  ...l,
                  countedQuantity: input.countedQuantity,
                  expectedQuantity: input.countedQuantity === null ? null : l.currentQuantity,
                  observedStockVersion:
                    input.countedQuantity === null ? null : l.currentStockVersion,
                  reason: input.reason ?? null,
                }
              : l,
          ),
        };
        const updatedLine = serverDetail.lines.find((l) => l.skuId === skuId)!;
        return {
          countId: serverDetail.countId,
          countVersion: serverDetail.version,
          line: updatedLine,
        };
      },
    );

    const postStockCount = vi.fn(
      async (): Promise<PostStockCountResponse> => ({
        countId: serverDetail.countId,
        status: 'POSTED',
        version: serverDetail.version + 1,
        postedAt: '2026-11-26T05:15:00Z',
        adjustments: [
          {
            skuId: 'sku-m',
            skuCode: 'KRT-BLK-M',
            productName: 'Cotton Kurti',
            size: 'M',
            expectedQuantity: 5,
            countedQuantity: 5,
            quantityDelta: 0,
            reason: null,
            allocationBasis: null,
            batchIds: [],
          },
          {
            skuId: 'sku-l',
            skuCode: 'KRT-BLK-L',
            productName: 'Cotton Kurti',
            size: 'L',
            expectedQuantity: 2,
            countedQuantity: 0,
            quantityDelta: -2,
            reason: 'Moved to clearance rack',
            allocationBasis: 'FIFO_SHORTAGE',
            batchIds: ['b-1'],
          },
        ],
      }),
    );

    const api = makeMockInventoryApi({
      createStockCount,
      getStockCount,
      saveStockCountLine,
      postStockCount,
    });
    const catalog = makeMockCatalogApi({
      listAllCategories: vi.fn(async () => categories),
    });

    render(
      <MemoryRouter initialEntries={['/inventory/stock-counts']}>
        <Routes>
          <Route
            path="/inventory/stock-counts"
            element={<StockCountsLandingPage api={api} catalog={catalog} />}
          />
          <Route
            path="/inventory/stock-counts/:countId"
            element={<StockCountDetailPage api={api} catalog={catalog} />}
          />
        </Routes>
      </MemoryRouter>
    );

    await user.click(await screen.findByLabelText(/Specific Category/i));
    await user.selectOptions(screen.getByLabelText('Category'), 'cat-silk');
    await user.click(screen.getByRole('button', { name: 'Start Stock Count' }));

    expect(
      await screen.findByRole('heading', { name: /Physical Stock Count — Sarees → Silk Sarees/i }),
    ).toBeInTheDocument();

    // Size variants M and L appear on separate rows; blank remains pending so Review & Post is disabled.
    const qtyM = screen.getByLabelText('Counted quantity for Cotton Kurti M (KRT-BLK-M)');
    const qtyL = screen.getByLabelText('Counted quantity for Cotton Kurti L (KRT-BLK-L)');
    const reviewBtn = screen.getByRole('button', { name: /Review & Post Stock Count/i });
    expect(reviewBtn).toBeDisabled();

    // Reject negative input without firing API request
    await user.type(qtyM, '-1');
    expect(
      await screen.findByText('Enter a whole number 0 or greater, or leave blank while pending.'),
    ).toBeInTheDocument();

    // Save M = 5 (exact match) and L = 0 (explicit zero != blank!)
    await user.clear(qtyM);
    await user.type(qtyM, '5');
    fireEvent.blur(qtyM);

    await user.type(qtyL, '0');
    fireEvent.blur(qtyL);

    await waitFor(() => {
      expect(saveStockCountLine).toHaveBeenCalledTimes(2);
    });
    expect(saveStockCountLine).toHaveBeenNthCalledWith(1, 'count-cat-1', 'sku-m', {
      expectedVersion: 0,
      countedQuantity: 5,
      observedStockVersion: 1,
      reason: null,
    });
    expect(saveStockCountLine).toHaveBeenNthCalledWith(2, 'count-cat-1', 'sku-l', {
      expectedVersion: 1,
      countedQuantity: 0,
      observedStockVersion: 1,
      reason: null,
    });

    // Discrepancy on size L requires reason before posting is allowed
    expect(reviewBtn).toBeDisabled();
    expect(screen.getByText(/Reason required before posting\./i)).toBeInTheDocument();

    const reasonL = screen.getByLabelText('Discrepancy reason for Cotton Kurti L (KRT-BLK-L)');
    await user.type(reasonL, 'Moved to clearance rack');
    fireEvent.blur(reasonL);

    await waitFor(() => {
      expect(saveStockCountLine).toHaveBeenCalledTimes(3);
    });
    await waitFor(() => {
      expect(reviewBtn).toBeEnabled();
    });

    await user.click(reviewBtn);
    await user.click(screen.getByRole('button', { name: /Confirm & Post Stock Count/i }));

    await waitFor(() => {
      expect(postStockCount).toHaveBeenCalledWith(
        'count-cat-1',
        { expectedVersion: 3 },
        expect.any(String),
      );
    });

    expect(await screen.findByRole('heading', { name: 'Posted Stock Count Summary' })).toBeInTheDocument();
    expect(screen.getByText(/FIFO shortage — Moved to clearance rack/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirm & Post Stock Count/i })).not.toBeInTheDocument();
  });

  it('supports barcode & internal batch scanning, camera denial fallback, unknown/out-of-scope rejection, and queues sequential scans cleanly', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          throw new DOMException('Denied', 'NotAllowedError');
        }),
      },
    });

    let serverDetail: StockCountDetail = {
      countId: 'count-scan-1',
      scope: 'CATEGORY',
      categoryId: 'cat-silk',
      status: 'DRAFT',
      version: 0,
      createdAt: '2026-11-26T05:00:00Z',
      postedAt: null,
      postedBy: null,
      lines: [
        {
          skuId: 'sku-in-scope',
          skuCode: 'SAR-SLK-01',
          productName: 'Banarasi Silk Saree',
          size: null,
          countedQuantity: null,
          expectedQuantity: null,
          currentQuantity: 2,
          observedStockVersion: null,
          currentStockVersion: 1,
          reason: null,
        },
      ],
    };

    const lookupBarcode = vi.fn(async (code: string): Promise<BarcodeLookupResult> => {
      if (code === 'BGD00000042') {
        return {
          code: 'BGD00000042',
          mappingType: 'INTERNAL',
          skuId: 'sku-in-scope',
          name: 'Banarasi Silk Saree',
          size: null,
          defaultSellingPrice: '4500.00',
          sellableQuantity: 2,
          batchId: 'batch-42',
          printedMrp: '5000.00',
          batchSellableQuantity: 2,
          requiresBatchSelection: false,
          eligibleBatches: [],
        };
      }
      if (code === '8901234567890') {
        return {
          code: '8901234567890',
          mappingType: 'BRAND',
          skuId: 'sku-outside-scope',
          name: 'Denim Jeans',
          size: '32',
          defaultSellingPrice: '1500.00',
          sellableQuantity: 5,
          batchId: null,
          printedMrp: null,
          batchSellableQuantity: null,
          requiresBatchSelection: false,
          eligibleBatches: [],
        };
      }
      throw new ApiClientError({
        kind: 'not_found',
        status: 404,
        code: 'BARCODE_NOT_FOUND',
        message: 'Barcode not found',
        requestId: 'req-404',
      });
    });

    const saveStockCountLine = vi.fn(async (_id, skuId, input) => {
      serverDetail = {
        ...serverDetail,
        version: serverDetail.version + 1,
        lines: serverDetail.lines.map((l) =>
          l.skuId === skuId
            ? {
                ...l,
                countedQuantity: input.countedQuantity,
                expectedQuantity: l.currentQuantity,
                observedStockVersion: l.currentStockVersion,
                reason: input.reason ?? null,
              }
            : l,
        ),
      };
      return {
        countId: serverDetail.countId,
        countVersion: serverDetail.version,
        line: serverDetail.lines[0]!,
      };
    });

    const postStockCount = vi.fn(async () => ({
      countId: serverDetail.countId,
      status: 'POSTED' as const,
      version: serverDetail.version + 1,
      postedAt: '2026-11-26T05:10:00Z',
      adjustments: [
        {
          skuId: 'sku-in-scope',
          skuCode: 'SAR-SLK-01',
          productName: 'Banarasi Silk Saree',
          size: null,
          expectedQuantity: 2,
          countedQuantity: 2,
          quantityDelta: 0,
          reason: null,
          allocationBasis: null,
          batchIds: [],
        },
      ],
    }));

    const api = makeMockInventoryApi({
      getStockCount: vi.fn(async () => serverDetail),
      lookupBarcode,
      saveStockCountLine,
      postStockCount,
    });

    render(
      <MemoryRouter initialEntries={['/inventory/stock-counts/count-scan-1']}>
        <Routes>
          <Route
            path="/inventory/stock-counts/:countId"
            element={<StockCountDetailPage api={api} catalog={makeMockCatalogApi()} />}
          />
        </Routes>
      </MemoryRouter>
    );

    const barcodeInput = await screen.findByLabelText(/Barcode \(supplier or internal\)/i);

    // Camera denial shows clear fallback message and preserves manual/USB input
    await user.click(screen.getByRole('button', { name: /Scan with camera/i }));
    expect(
      await screen.findByText(/Camera permission was denied\./i),
    ).toBeInTheDocument();

    // Unknown barcode -> BARCODE_NOT_FOUND
    await user.type(barcodeInput, 'UNKNOWN99{enter}');
    expect(await screen.findByText(/No SKU is linked to barcode "UNKNOWN99"/i)).toBeInTheDocument();
    expect(saveStockCountLine).not.toHaveBeenCalled();

    // Out-of-scope barcode -> rejected safely without changing line
    await user.clear(barcodeInput);
    await user.type(barcodeInput, '8901234567890{enter}');
    expect(
      await screen.findByText(/outside the scope of this stock count/i),
    ).toBeInTheDocument();
    expect(saveStockCountLine).not.toHaveBeenCalled();

    // Scan internal tag twice -> increments 1 then 2 cleanly, serialized expectedVersion 0 then 1
    await user.clear(barcodeInput);
    await user.type(barcodeInput, 'BGD00000042{enter}');
    expect(await screen.findByText(/Internal batch tag matched/i)).toBeInTheDocument();

    await user.type(barcodeInput, 'BGD00000042{enter}');
    await waitFor(() => {
      expect(saveStockCountLine).toHaveBeenCalledTimes(2);
    });
    expect(saveStockCountLine).toHaveBeenNthCalledWith(1, 'count-scan-1', 'sku-in-scope', {
      expectedVersion: 0,
      countedQuantity: 1,
      observedStockVersion: 1,
      reason: null,
    });
    expect(saveStockCountLine).toHaveBeenNthCalledWith(2, 'count-scan-1', 'sku-in-scope', {
      expectedVersion: 1,
      countedQuantity: 2,
      observedStockVersion: 1,
      reason: null,
    });

    // Exact match -> posts & shows "No adjustment needed."
    await user.click(screen.getByRole('button', { name: /Review & Post Stock Count/i }));
    await user.click(screen.getByRole('button', { name: /Confirm & Post Stock Count/i }));

    expect(await screen.findByText(/No adjustment needed\./i)).toBeInTheDocument();
  });

  it('handles 409 STOCK_CHANGED partial recount without losing unaffected lines and retries network post with same Idempotency-Key', async () => {
    const user = userEvent.setup();
    let serverDetail: StockCountDetail = {
      countId: 'count-conflict',
      scope: 'SHOP',
      categoryId: null,
      status: 'DRAFT',
      version: 2,
      createdAt: '2026-11-26T05:00:00Z',
      postedAt: null,
      postedBy: null,
      lines: [
        {
          skuId: 'sku-x',
          skuCode: 'ITM-X',
          productName: 'Item X',
          size: null,
          countedQuantity: 5,
          expectedQuantity: 5,
          currentQuantity: 5,
          observedStockVersion: 1,
          currentStockVersion: 1,
          reason: null,
        },
        {
          skuId: 'sku-y',
          skuCode: 'ITM-Y',
          productName: 'Item Y',
          size: null,
          countedQuantity: 2,
          expectedQuantity: 4,
          currentQuantity: 4,
          observedStockVersion: 1,
          currentStockVersion: 1,
          reason: '2 damaged missing',
        },
      ],
    };

    const getStockCount = vi.fn(async () => ({
      ...serverDetail,
      lines: serverDetail.lines.map((l) => ({ ...l })),
    }));

    const saveStockCountLine = vi.fn(async (_id, skuId, input) => {
      serverDetail = {
        ...serverDetail,
        version: serverDetail.version + 1,
        lines: serverDetail.lines.map((l) =>
          l.skuId === skuId
            ? {
                ...l,
                countedQuantity: input.countedQuantity,
                expectedQuantity: l.currentQuantity,
                observedStockVersion: l.currentStockVersion,
                reason: input.reason ?? null,
              }
            : l,
        ),
      };
      return {
        countId: serverDetail.countId,
        countVersion: serverDetail.version,
        line: serverDetail.lines.find((l) => l.skuId === skuId)!,
      };
    });

    const postKeys: string[] = [];
    let postCall = 0;
    const postStockCount = vi.fn(async (_id, input, key) => {
      postCall += 1;
      postKeys.push(key);
      if (postCall === 1) {
        // Simulate sale on SKU X between counting and posting!
        serverDetail = {
          ...serverDetail,
          lines: serverDetail.lines.map((l) =>
            l.skuId === 'sku-x' ? { ...l, currentQuantity: 4, currentStockVersion: 2 } : l,
          ),
        };
        throw new ApiClientError({
          kind: 'conflict',
          status: 409,
          code: 'STOCK_CHANGED',
          message: 'Stock changed after physical count for ITM-X',
          details: {
            changedSkus: [
              {
                skuId: 'sku-x',
                skuCode: 'ITM-X',
                observedStockVersion: 1,
                currentStockVersion: 2,
                currentSellableQuantity: 4,
              },
            ],
          },
        });
      }
      if (postCall === 2) {
        throw new ApiClientError({
          kind: 'network',
          status: null,
          code: 'NETWORK_ERROR',
          message: 'Temporary connection drop',
          retryable: true,
        });
      }
      return {
        countId: 'count-conflict',
        status: 'POSTED' as const,
        version: input.expectedVersion + 1,
        postedAt: '2026-11-26T05:30:00Z',
        adjustments: [],
      };
    });

    const api = makeMockInventoryApi({
      getStockCount,
      saveStockCountLine,
      postStockCount,
    });

    render(
      <MemoryRouter initialEntries={['/inventory/stock-counts/count-conflict']}>
        <Routes>
          <Route
            path="/inventory/stock-counts/:countId"
            element={<StockCountDetailPage api={api} catalog={makeMockCatalogApi()} />}
          />
        </Routes>
      </MemoryRouter>
    );

    await user.click(await screen.findByRole('button', { name: /Review & Post Stock Count/i }));
    await user.click(screen.getByRole('button', { name: /Confirm & Post Stock Count/i }));

    expect(
      await screen.findByText(/Stock changed after counting on ITM-X \(now 4 sellable\)/i),
    ).toBeInTheDocument();

    // Unaffected SKU Y remains saved at 2 with reason preserved!
    expect(
      (screen.getByLabelText(/Counted quantity for Item Y/i) as HTMLInputElement).value,
    ).toBe('2');

    // Recount SKU X to 4 and save recount (must send observedStockVersion = 2)
    const qtyX = screen.getByLabelText(/Counted quantity for Item X/i);
    await user.clear(qtyX);
    await user.type(qtyX, '4');
    await user.click(screen.getByRole('button', { name: 'Save Recount' }));

    await waitFor(() => {
      expect(saveStockCountLine).toHaveBeenCalledWith('count-conflict', 'sku-x', {
        expectedVersion: 2,
        countedQuantity: 4,
        observedStockVersion: 2,
        reason: null,
      });
    });

    // Post again -> fails with retryable network error, then Retry Post Safely uses SAME Idempotency-Key (different from postCall 1 key!)
    await user.click(screen.getByRole('button', { name: /Review & Post Stock Count/i }));
    await user.click(screen.getByRole('button', { name: /Confirm & Post Stock Count/i }));

    await user.click(await screen.findByRole('button', { name: 'Retry Post Safely' }));

    expect(await screen.findByRole('heading', { name: 'Posted Stock Count Summary' })).toBeInTheDocument();
    expect(postKeys).toHaveLength(3);
    expect(postKeys[1]).not.toBe(postKeys[0]);
    expect(postKeys[2]).toBe(postKeys[1]);
  });

  it('handles 409 STALE_VERSION when saving a line by reloading server values and preserving local unsaved edits', async () => {
    const user = userEvent.setup();
    let detailOnServer: StockCountDetail = {
      countId: 'count-stale',
      scope: 'SHOP',
      categoryId: null,
      status: 'DRAFT',
      version: 0,
      createdAt: '2026-11-26T05:00:00Z',
      postedAt: null,
      postedBy: null,
      lines: [
        {
          skuId: 'sku-1',
          skuCode: 'S-1',
          productName: 'Scarf',
          size: null,
          countedQuantity: null,
          expectedQuantity: null,
          currentQuantity: 3,
          observedStockVersion: null,
          currentStockVersion: 1,
          reason: null,
        },
      ],
    };

    const getStockCount = vi.fn(async () => detailOnServer);
    const saveStockCountLine = vi.fn(async () => {
      detailOnServer = {
        ...detailOnServer,
        version: 1,
        lines: [
          {
            ...detailOnServer.lines[0]!,
            countedQuantity: 3,
            expectedQuantity: 3,
            observedStockVersion: 1,
          },
        ],
      };
      throw new ApiClientError({
        kind: 'conflict',
        status: 409,
        code: 'STALE_VERSION',
        message: 'Stock count modified by another user',
        requestId: 'req-stale-sc',
      });
    });

    const api = makeMockInventoryApi({ getStockCount, saveStockCountLine });

    render(
      <MemoryRouter initialEntries={['/inventory/stock-counts/count-stale']}>
        <Routes>
          <Route
            path="/inventory/stock-counts/:countId"
            element={<StockCountDetailPage api={api} catalog={makeMockCatalogApi()} />}
          />
        </Routes>
      </MemoryRouter>
    );

    const qtyInput = await screen.findByLabelText(/Counted quantity for Scarf/i);
    await user.type(qtyInput, '2');
    await user.click(screen.getByRole('button', { name: 'Save Line' }));

    expect(
      await screen.findByText(/Latest server quantities were loaded while preserving your unsaved edits/i),
    ).toBeInTheDocument();
    expect((qtyInput as HTMLInputElement).value).toBe('2');
    expect(screen.getByText(/Server has 3/i)).toBeInTheDocument();
  });

  it('permits WORKER access to stock count routes via AppRoutes', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/auth/session') {
        return jsonResponse({ userId: 'worker-uuid', name: 'Counter Staff', role: 'WORKER' });
      }
      if (url.startsWith('/api/v1/categories')) {
        return jsonResponse({ items: [], page: 0, size: 100, total: 0 });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const client = createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch });
    render(
      <SessionProvider client={client}>
        <MemoryRouter initialEntries={['/inventory/stock-counts']}>
          <AppRoutes />
        </MemoryRouter>
      </SessionProvider>
    );

    expect(await screen.findByRole('heading', { name: 'Physical Stock Counts' })).toBeInTheDocument();
  });
});
