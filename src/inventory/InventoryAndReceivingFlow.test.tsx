import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App.tsx';
import { createApiClient } from '../api/client.ts';
import { ApiClientError } from '../api/errors.ts';
import { SessionProvider } from '../auth/SessionContext.tsx';
import type { CatalogApi } from '../catalog/catalogApi.ts';
import type { Category, SkuListItem } from '../catalog/types.ts';
import { PurchaseOrderDetailPage } from '../purchasing/PurchaseOrderDetailPage.tsx';
import { PurchasesLayout } from '../purchasing/PurchasesLayout.tsx';
import type { PurchasingApi } from '../purchasing/purchasingApi.ts';
import type { PurchaseOrderDetail, Vendor } from '../purchasing/types.ts';
import { getShopLocalDateIso } from '../utils/shopDate.ts';
import { BarcodeScannerPanel } from './components/BarcodeScannerPanel.tsx';
import { InventoryPage } from './InventoryPage.tsx';
import type { InventoryApi } from './inventoryApi.ts';
import { ReceiveStockPage } from './ReceiveStockPage.tsx';
import { clearSessionReceipts } from './sessionReceipts.ts';
import { StockReceiptDetailPage } from './StockReceiptDetailPage.tsx';
import type {
  BarcodeLookupResult,
  BatchLabel,
  InventoryItem,
  StockReceiptDetail,
} from './types.ts';

function makeMockInventoryApi(overrides: Partial<InventoryApi> = {}): InventoryApi {
  return {
    createStockReceipt: vi.fn(),
    getStockReceipt: vi.fn(),
    lookupBarcode: vi.fn(),
    registerBarcode: vi.fn(),
    generateBatchLabel: vi.fn(),
    getBatchLabel: vi.fn(),
    listInventory: vi.fn(async () => ({ items: [], page: 0, size: 25, total: 0 })),
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
const originalBarcodeDetector = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;

afterEach(() => {
  clearSessionReceipts();
  vi.restoreAllMocks();
  if (originalMediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
  } else {
    delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
  }
  if (originalBarcodeDetector === undefined) {
    delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
  } else {
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = originalBarcodeDetector;
  }
});

describe('FE04 Stock Receiving, Barcodes, Tag Printing, and Inventory', () => {
  it('receives 8 of 12 sarees from a PO with split-line check, idempotent retry, receipt detail, and tag generate/print/reprint', async () => {
    const user = userEvent.setup();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);

    let currentPo: PurchaseOrderDetail = {
      poId: 'po-1',
      poNumber: 'PO-0001',
      vendorId: 'v-1',
      vendorName: 'Kanchipuram Looms',
      orderDate: '2026-11-25',
      status: 'OPEN',
      totalOpenQuantity: 12,
      version: 0,
      lines: [
        {
          poLineId: 'pol-1',
          skuId: 'sku-saree',
          skuCode: 'SAR-SLK-100',
          productName: 'Silk Saree',
          size: null,
          orderedQuantity: 12,
          receivedQuantity: 0,
          cancelledQuantity: 0,
          openQuantity: 12,
          agreedUnitCost: '1500.00',
        },
      ],
    };

    const receiptBeforeTag: StockReceiptDetail = {
      receiptId: 'rcp-1',
      receiptNumber: 'RCP-000001',
      vendorId: 'v-1',
      vendorName: 'Kanchipuram Looms',
      poId: 'po-1',
      poNumber: 'PO-0001',
      poStatus: 'PARTIALLY_RECEIVED',
      poTotalOpenQuantity: 4,
      poVersion: 1,
      vendorInvoiceRef: 'INV-100',
      receivedDate: getShopLocalDateIso(),
      postedAt: '2026-11-25T12:00:00Z',
      lines: [
        {
          receiptLineId: 'rcpl-1',
          skuId: 'sku-saree',
          skuCode: 'SAR-SLK-100',
          productName: 'Silk Saree',
          size: null,
          poLineId: 'pol-1',
          poLineOpenQuantity: 4,
          batchId: 'batch-saree-1',
          quantity: 8,
          unitCost: '1500.00',
          printedMrp: null,
          internalBarcode: null,
        },
      ],
    };

    let receiptCreated = false;
    let labelGenerated = false;
    const receiptCalls: { key: string; body: unknown }[] = [];

    const createStockReceipt = vi.fn(async (input, key: string) => {
      receiptCalls.push({ key, body: input });
      if (receiptCalls.length === 1) {
        throw new ApiClientError({
          kind: 'network',
          status: 503,
          code: 'NETWORK_ERROR',
          message: 'Connection lost',
          retryable: true,
        });
      }
      receiptCreated = true;
      currentPo = {
        ...currentPo,
        status: 'PARTIALLY_RECEIVED',
        totalOpenQuantity: 4,
        version: 1,
        lines: [
          {
            ...currentPo.lines[0]!,
            receivedQuantity: 8,
            openQuantity: 4,
          },
        ],
      };
      return receiptBeforeTag;
    });

    const getStockReceipt = vi.fn(async () => ({
      ...receiptBeforeTag,
      lines: [
        {
          ...receiptBeforeTag.lines[0]!,
          internalBarcode: labelGenerated ? 'BGD00000001' : null,
        },
      ],
    }));

    const generatedLabel: BatchLabel = {
      batchId: 'batch-saree-1',
      code: 'BGD00000001',
      shopName: 'Bagade Clothing',
      productName: 'Silk Saree',
      size: null,
      displayPrice: '4500.00',
      barcode: 'BGD00000001',
      textCode: 'BGD00000001',
    };

    const generateBatchLabel = vi.fn(async () => {
      labelGenerated = true;
      return generatedLabel;
    });
    const getBatchLabel = vi.fn(async () => generatedLabel);

    const listInventory = vi.fn(async () => ({ items: [], page: 0, size: 25, total: 0 }));
    const listSkus = vi.fn(async () => ({
      items: [
        {
          skuId: 'sku-saree',
          productId: 'prod-1',
          productName: 'Silk Saree',
          size: null,
          skuCode: 'SAR-SLK-100',
          defaultSellingPrice: '4500.00',
          sellableQuantity: receiptCreated ? 8 : 0,
          active: true,
          version: 0,
        },
      ],
      page: 0,
      size: 25,
      total: 1,
    }));

    const inventory = makeMockInventoryApi({
      createStockReceipt,
      getStockReceipt,
      generateBatchLabel,
      getBatchLabel,
      listInventory,
    });
    const purchasing = makeMockPurchasingApi({
      getPurchaseOrder: vi.fn(async () => currentPo),
    });
    const catalog = makeMockCatalogApi({ listSkus });

    render(
      <MemoryRouter initialEntries={['/purchases/po-1']}>
        <Routes>
          <Route path="/purchases" element={<PurchasesLayout />}>
            <Route index element={<div>POs</div>} />
            <Route path=":poId" element={<PurchaseOrderDetailPage api={purchasing} />} />
            <Route
              path=":poId/receive"
              element={
                <ReceiveStockPage
                  inventory={inventory}
                  purchasing={purchasing}
                  catalog={catalog}
                />
              }
            />
          </Route>
          <Route
            path="/inventory/receipts/:receiptId"
            element={<StockReceiptDetailPage api={inventory} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'PO-0001' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Receive Stock' }));

    expect(await screen.findByRole('heading', { name: 'Receive Stock — PO-0001' })).toBeInTheDocument();
    expect(await screen.findByText('₹4,500.00')).toBeInTheDocument();

    // Split PO line and exceed open quantity (8 + 5 = 13 > 12) -> caught before submit
    const qty1 = document.getElementById('rcp-qty-1') as HTMLInputElement;
    await user.clear(qty1);
    await user.type(qty1, '8');

    await user.click(screen.getByRole('button', { name: '+ Split line' }));
    const qty2 = document.getElementById('rcp-qty-2') as HTMLInputElement;
    await user.clear(qty2);
    await user.type(qty2, '5');

    await user.click(screen.getByRole('button', { name: 'Post stock receipt' }));
    expect(
      await screen.findAllByText('Combined quantity (13) exceeds open quantity (12).'),
    ).toHaveLength(2);
    expect(createStockReceipt).not.toHaveBeenCalled();

    // Remove split line, set invoice ref, leave printedMrp blank
    await user.click(screen.getByRole('button', { name: 'Remove line 2' }));
    await user.type(screen.getByLabelText(/Vendor invoice ref/), 'INV-100');

    // First post fails with network error -> preserves payload + exact Idempotency-Key
    await user.click(screen.getByRole('button', { name: 'Post stock receipt' }));
    expect(await screen.findByText(/outcome is unknown/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry receipt submission' }));
    expect(receiptCalls).toHaveLength(2);
    expect(receiptCalls[1]!.key).toBe(receiptCalls[0]!.key);
    expect(receiptCalls[1]!.body).toEqual(receiptCalls[0]!.body);
    expect(receiptCalls[1]!.body).toEqual({
      vendorId: 'v-1',
      receivedDate: getShopLocalDateIso(),
      poId: 'po-1',
      vendorInvoiceRef: 'INV-100',
      lines: [
        {
          skuId: 'sku-saree',
          poLineId: 'pol-1',
          quantity: 8,
          unitCost: '1500.00',
          generateInternalTag: false,
        },
      ],
    });

    // Opens GET /api/v1/stock-receipts/rcp-1 and refreshes PO/catalog/inventory
    expect(await screen.findByRole('heading', { name: 'RCP-000001' })).toBeInTheDocument();
    expect(getStockReceipt).toHaveBeenCalledWith('rcp-1', expect.any(AbortSignal));
    expect(screen.getByText('/inventory/receipts/rcp-1')).toBeInTheDocument();
    expect(listSkus).toHaveBeenCalled();
    expect(listInventory).toHaveBeenCalled();

    // Generate Tag (POST /stock-batches/{id}/label), preview 50x30 mm & 8 default copies
    await user.click(screen.getByRole('button', { name: 'Generate Tag' }));
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText('Bagade Clothing')).toBeInTheDocument();
    expect(within(dialog).getByText('₹4,500.00')).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: 'Code 128 barcode for BGD00000001' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Copies/)).toHaveValue('8');
    expect(document.querySelectorAll('.tag-print-portal .product-tag')).toHaveLength(8);

    // Trigger browser print -> modal remains accessible if cancelled/closed
    await user.click(within(dialog).getByRole('button', { name: 'Print tags' }));
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(await within(dialog).findByText(/Print requested for 8 tag copies/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    // Reopening shows Reprint Tag and defaults copies to 1 via GET /stock-batches/{id}/label
    await user.click(screen.getByRole('button', { name: 'Reprint Tag' }));
    const reprintDialog = screen.getByRole('dialog');
    expect(await within(reprintDialog).findByText(/Inventory quantities remain unchanged/i)).toBeInTheDocument();
    expect(within(reprintDialog).getByLabelText(/Copies/)).toHaveValue('1');
    expect(getBatchLabel).toHaveBeenCalledWith('batch-saree-1', expect.any(AbortSignal));
  });

  it('refreshes PO balances cleanly while keeping draft intact on PO_QUANTITY_EXCEEDED', async () => {
    const user = userEvent.setup();
    let poVersion = 0;

    const purchasing = makeMockPurchasingApi({
      getPurchaseOrder: vi.fn(async () => ({
        poId: 'po-race',
        poNumber: 'PO-0077',
        vendorId: 'v-1',
        vendorName: 'Looms Co',
        orderDate: '2026-11-25',
        status: poVersion === 0 ? ('OPEN' as const) : ('PARTIALLY_RECEIVED' as const),
        totalOpenQuantity: poVersion === 0 ? 10 : 3,
        version: poVersion,
        lines: [
          {
            poLineId: 'pol-race',
            skuId: 'sku-1',
            skuCode: 'SAR-01',
            productName: 'Cotton Saree',
            size: null,
            orderedQuantity: 10,
            receivedQuantity: poVersion === 0 ? 0 : 7,
            cancelledQuantity: 0,
            openQuantity: poVersion === 0 ? 10 : 3,
            agreedUnitCost: '800.00',
          },
        ],
      })),
    });

    const inventory = makeMockInventoryApi({
      createStockReceipt: vi.fn(async () => {
        poVersion = 1;
        throw new ApiClientError({
          kind: 'conflict',
          status: 409,
          code: 'PO_QUANTITY_EXCEEDED',
          message: 'Requested quantity 10 exceeds open quantity 3',
          retryable: false,
        });
      }),
    });

    render(
      <MemoryRouter initialEntries={['/purchases/po-race/receive']}>
        <Routes>
          <Route
            path="/purchases/:poId/receive"
            element={
              <ReceiveStockPage
                inventory={inventory}
                purchasing={purchasing}
                catalog={makeMockCatalogApi()}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Receive Stock — PO-0077' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Post stock receipt' }));

    expect(
      await screen.findByText(/Purchase order balances were refreshed below/i),
    ).toBeInTheDocument();
    // Draft stays intact (10) while updated PO open balance shows 3
    expect(document.getElementById('rcp-qty-1')).toHaveValue('10');
    expect(screen.getByText(/PO open: 3/)).toBeInTheDocument();
  });

  it('supports direct receipt with USB Enter scan, leading zeros, BARCODE_CONFLICT existing mapping display, and FE02 product creation without losing draft', async () => {
    const user = userEvent.setup();

    const vendors: Vendor[] = [
      { vendorId: 'v-direct', name: 'Comfort Distributors', contact: '9988776655', active: true },
    ];
    const categories: Category[] = [{ categoryId: 'cat-1', name: 'Innerwear', parentId: null }];
    let skus: SkuListItem[] = [
      {
        skuId: 'sku-32',
        productId: 'prod-v',
        productName: 'Cotton Vest',
        size: '32',
        skuCode: 'VES-32',
        defaultSellingPrice: '220.00',
        sellableQuantity: 4,
        active: true,
        version: 0,
      },
    ];

    const conflictLookup: BarcodeLookupResult = {
      code: '00890123456',
      mappingType: 'BRAND',
      skuId: 'sku-32',
      name: 'Cotton Vest',
      size: '32',
      defaultSellingPrice: '220.00',
      sellableQuantity: 4,
      batchId: 'old-batch-must-not-be-reused',
      printedMrp: null,
      batchSellableQuantity: null,
      requiresBatchSelection: false,
      eligibleBatches: [],
    };

    let registeredCode = false;
    const lookupBarcode = vi.fn(async (code: string) => {
      if (code === '00890123456' && !registeredCode) {
        throw new ApiClientError({
          kind: 'not_found',
          status: 404,
          code: 'BARCODE_NOT_FOUND',
          message: 'Barcode not found',
        });
      }
      return conflictLookup;
    });

    const registerBarcode = vi.fn(async ({ skuId }: { code: string; skuId: string }) => {
      if (skuId === 'sku-32') {
        registeredCode = true;
        throw new ApiClientError({
          kind: 'conflict',
          status: 409,
          code: 'BARCODE_CONFLICT',
          message: 'Barcode is already mapped to another SKU',
        });
      }
      return {
        barcodeMappingId: 'bm-new',
        code: '00890123456',
        sourceType: 'BRAND' as const,
        skuId,
        batchId: null,
      };
    });

    const createStockReceipt = vi.fn(async (input) => ({
      receiptId: 'rcp-direct-1',
      receiptNumber: 'RCP-000002',
      vendorId: input.vendorId,
      vendorName: 'Comfort Distributors',
      poId: null,
      poNumber: null,
      poStatus: null,
      poTotalOpenQuantity: null,
      poVersion: null,
      vendorInvoiceRef: null,
      receivedDate: input.receivedDate,
      postedAt: '2026-11-25T13:00:00Z',
      lines: [],
    }));

    const inventory = makeMockInventoryApi({
      lookupBarcode,
      registerBarcode,
      createStockReceipt,
      getStockReceipt: vi.fn(async () => ({
        receiptId: 'rcp-direct-1',
        receiptNumber: 'RCP-000002',
        vendorId: 'v-direct',
        vendorName: 'Comfort Distributors',
        poId: null,
        poNumber: null,
        poStatus: null,
        poTotalOpenQuantity: null,
        poVersion: null,
        vendorInvoiceRef: null,
        receivedDate: getShopLocalDateIso(),
        postedAt: '2026-11-25T13:00:00Z',
        lines: [],
      })),
    });

    const purchasing = makeMockPurchasingApi({
      listVendors: vi.fn(async () => ({ items: vendors, page: 0, size: 25, total: 1 })),
    });

    const catalog = makeMockCatalogApi({
      listAllCategories: vi.fn(async () => categories),
      listSkus: vi.fn(async () => ({ items: skus, page: 0, size: 10, total: skus.length })),
      createProduct: vi.fn(async () => ({
        productId: 'prod-new',
        categoryId: 'cat-1',
        name: 'Thermal Top',
      })),
      createSku: vi.fn(async () => {
        const createdSku = {
          skuId: 'sku-new',
          skuCode: 'THM-L',
          size: 'L',
          defaultSellingPrice: '599.00',
          version: 0,
        };
        skus = [
          ...skus,
          { ...createdSku, productId: 'prod-new', productName: 'Thermal Top', sellableQuantity: 0, active: true },
        ];
        return createdSku;
      }),
    });

    render(
      <MemoryRouter initialEntries={['/purchases/receive']}>
        <Routes>
          <Route path="/purchases" element={<PurchasesLayout />}>
            <Route
              path="receive"
              element={
                <ReceiveStockPage
                  inventory={inventory}
                  purchasing={purchasing}
                  catalog={catalog}
                />
              }
            />
          </Route>
          <Route
            path="/inventory/receipts/:receiptId"
            element={<StockReceiptDetailPage api={inventory} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Direct Stock Receipt' })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: /^Vendor/ }), 'v-direct');

    // USB scanner types leading zeros and presses Enter -> must NOT submit outer receipt form!
    const barcodeBox = screen.getByLabelText('Barcode (supplier or internal)');
    await user.type(barcodeBox, '00890123456{Enter}');

    expect(createStockReceipt).not.toHaveBeenCalled();
    expect(lookupBarcode).toHaveBeenCalledWith('00890123456');

    // BARCODE_NOT_FOUND opens linking modal preserving leading zeros
    const linkDialog = await screen.findByRole('dialog');
    expect(within(linkDialog).getByText('00890123456')).toBeInTheDocument();

    const vestRow = (await within(linkDialog).findByRole('rowheader', { name: 'Cotton Vest' })).closest(
      'tr',
    );
    await user.click(within(vestRow!).getByRole('button', { name: 'Select' }));
    await user.click(within(linkDialog).getByRole('button', { name: 'Link barcode' }));

    // BARCODE_CONFLICT shows existing mapping details
    expect(
      await within(linkDialog).findByText(/Barcode is already mapped to another SKU/i),
    ).toBeInTheDocument();
    expect(
      within(linkDialog).getByText(/Existing mapping \(BRAND\):/i),
    ).toBeInTheDocument();

    // Worker creates new FE02 product/SKU & links to it while vendor selection stays intact
    await user.click(within(linkDialog).getByRole('button', { name: '+ Create new product / size' }));
    const productDialog = await screen.findByRole('dialog');
    await user.selectOptions(within(productDialog).getByLabelText(/Category/), 'cat-1');
    await user.type(within(productDialog).getByLabelText(/Product name/), 'Thermal Top');
    await user.click(within(productDialog).getByRole('button', { name: 'Save product & add SKU' }));

    await user.type(await within(productDialog).findByLabelText(/SKU code/), 'THM-L');
    await user.type(within(productDialog).getByLabelText(/Size \(optional\)/), 'L');
    await user.type(within(productDialog).getByLabelText(/Default selling price/), '599');
    await user.click(within(productDialog).getByRole('button', { name: 'Save SKU' }));
    await user.click(await within(productDialog).findByRole('button', { name: 'Done' }));

    const resumedLinkDialog = await screen.findByRole('dialog');
    expect(within(resumedLinkDialog).getByText('Selected SKU: Thermal Top')).toBeInTheDocument();
    await user.click(within(resumedLinkDialog).getByRole('button', { name: 'Link barcode' }));

    expect(await screen.findByText('Thermal Top')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /^Vendor/ })).toHaveValue('v-direct');

    // Fill unitCost & leave printedMrp blank; verify omitted poId, poLineId, printedMrp
    await user.type(document.getElementById('rcp-cost-1') as HTMLInputElement, '350');
    await user.click(screen.getByRole('button', { name: 'Post stock receipt' }));

    expect(createStockReceipt).toHaveBeenCalledWith(
      {
        vendorId: 'v-direct',
        receivedDate: getShopLocalDateIso(),
        lines: [
          {
            skuId: 'sku-new',
            quantity: 1,
            unitCost: '350.00',
            generateInternalTag: false,
          },
        ],
      },
      expect.any(String),
    );
    expect(await screen.findByRole('heading', { name: 'RCP-000002' })).toBeInTheDocument();
  });

  it('requests camera permission only on click, handles denial manually, consumes 1 scan result, and stops tracks on unmount', async () => {
    const user = userEvent.setup();
    const trackStop = vi.fn();
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'))
      .mockResolvedValue({
        getTracks: () => [{ stop: trackStop }],
      });

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    const detectMock = vi.fn(async () => [{ rawValue: '00007777' }]);
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = class {
      detect = detectMock;
    };

    const onLookupCode = vi.fn(async () => true);

    const { unmount } = render(
      <BarcodeScannerPanel
        isLookingUp={false}
        lookupError={null}
        onLookupCode={onLookupCode}
      />,
    );

    // Camera NOT requested until Scan button clicked
    expect(getUserMedia).not.toHaveBeenCalled();

    // First click denied -> manual fallback shown & manual barcode input focused
    await user.click(screen.getByRole('button', { name: 'Scan with camera' }));
    expect(
      await screen.findByText(/Camera permission was denied/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Barcode (supplier or internal)')).toHaveFocus();

    // Second click starts camera preview, detects ONCE, closes camera & stops tracks
    await user.click(screen.getByRole('button', { name: 'Scan with camera' }));
    const video = (await screen.findByLabelText(
      'Live camera preview for barcode scanning',
    )) as HTMLVideoElement;
    Object.defineProperty(video, 'readyState', { value: 4, configurable: true });

    await waitFor(() => {
      expect(onLookupCode).toHaveBeenCalledTimes(1);
    });
    expect(onLookupCode).toHaveBeenCalledWith('00007777');
    expect(trackStop).toHaveBeenCalled();

    // Ensure unmount cleanup stays safe
    unmount();
  });

  it('asks staff to choose PO line when multiple open PO lines share the same SKU', async () => {
    const user = userEvent.setup();

    const po: PurchaseOrderDetail = {
      poId: 'po-multi',
      poNumber: 'PO-0088',
      vendorId: 'v-1',
      vendorName: 'Looms Co',
      orderDate: '2026-11-25',
      status: 'OPEN',
      totalOpenQuantity: 10,
      version: 0,
      lines: [
        {
          poLineId: 'pol-1',
          skuId: 'sku-same',
          skuCode: 'SAR-MULTI',
          productName: 'Festival Saree',
          size: null,
          orderedQuantity: 6,
          receivedQuantity: 0,
          cancelledQuantity: 0,
          openQuantity: 6,
          agreedUnitCost: '1100.00',
        },
        {
          poLineId: 'pol-2',
          skuId: 'sku-same',
          skuCode: 'SAR-MULTI',
          productName: 'Festival Saree',
          size: null,
          orderedQuantity: 4,
          receivedQuantity: 0,
          cancelledQuantity: 0,
          openQuantity: 4,
          agreedUnitCost: '1250.00',
        },
      ],
    };

    const inventory = makeMockInventoryApi({
      lookupBarcode: vi.fn(async () => ({
        code: '00112233',
        mappingType: 'BRAND' as const,
        skuId: 'sku-same',
        name: 'Festival Saree',
        size: null,
        defaultSellingPrice: '2100.00',
        sellableQuantity: 0,
        batchId: null,
        printedMrp: null,
        batchSellableQuantity: null,
        requiresBatchSelection: false,
        eligibleBatches: [],
      })),
    });

    render(
      <MemoryRouter initialEntries={['/purchases/po-multi/receive']}>
        <Routes>
          <Route
            path="/purchases/:poId/receive"
            element={
              <ReceiveStockPage
                inventory={inventory}
                purchasing={makeMockPurchasingApi({ getPurchaseOrder: vi.fn(async () => po) })}
                catalog={makeMockCatalogApi()}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Receive Stock — PO-0088' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Barcode (supplier or internal)'), '00112233{Enter}');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/multiple open PO lines/i)).toBeInTheDocument();
    const selectButtons = within(dialog).getAllByRole('button', { name: 'Select PO line' });
    expect(selectButtons).toHaveLength(2);
    await user.click(selectButtons[1]!);

    expect(
      await screen.findByText(/Added selected PO line \(SAR-MULTI, open 4\) from barcode 00112233/i),
    ).toBeInTheDocument();
  });

  it('displays Inventory balances for WORKER, supports category/search filtering, retryable error, expandable batches, and tag reprinting', async () => {
    const user = userEvent.setup();
    let failInitial = true;

    const inventoryItems: InventoryItem[] = [
      {
        skuId: 'sku-1',
        skuCode: 'SAR-SLK-100',
        productName: 'Silk Saree',
        size: null,
        defaultSellingPrice: '4500.00',
        active: true,
        sellableQuantity: 8,
        nonSellableQuantity: 1,
        stockVersion: 2,
        batches: [
          {
            batchId: 'b-1',
            receivedDate: '2026-11-25',
            unitCost: '2200.00',
            printedMrp: null,
            sellableQuantity: 8,
            nonSellableQuantity: 1,
            internalBarcode: 'BGD00000001',
          },
        ],
      },
    ];

    const listInventory = vi.fn(async () => {
      if (failInitial) {
        failInitial = false;
        throw new ApiClientError({
          kind: 'network',
          status: 503,
          code: 'BACKEND_UNAVAILABLE',
          message: 'Inventory service unavailable',
          retryable: true,
        });
      }
      return { items: inventoryItems, page: 0, size: 25, total: 1 };
    });

    const api = makeMockInventoryApi({
      listInventory,
      getBatchLabel: vi.fn(async () => ({
        batchId: 'b-1',
        code: 'BGD00000001',
        shopName: 'Bagade Clothing',
        productName: 'Silk Saree',
        size: null,
        displayPrice: '4500.00',
        barcode: 'BGD00000001',
        textCode: 'BGD00000001',
      })),
    });

    const catalog = makeMockCatalogApi({
      listAllCategories: vi.fn(async () => [
        { categoryId: 'cat-sarees', name: 'Sarees', parentId: null },
        { categoryId: 'cat-silk', name: 'Silk Sarees', parentId: 'cat-sarees' },
      ]),
    });

    render(
      <MemoryRouter initialEntries={['/inventory']}>
        <InventoryPage api={api} catalog={catalog} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Inventory service unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    const row = (await screen.findByRole('rowheader', { name: 'Silk Saree' })).closest('tr');
    expect(within(row!).getByText('—')).toBeInTheDocument();
    expect(within(row!).getByText('8')).toBeInTheDocument();
    expect(within(row!).getByText('1')).toBeInTheDocument();

    // Expand batch breakdown
    await user.click(within(row!).getByRole('button', { name: 'View batches (1)' }));
    expect(await screen.findByText('₹2,200.00')).toBeInTheDocument();
    expect(screen.getByText('BGD00000001')).toBeInTheDocument();

    // Reprint Tag opens modal with default copies = 1
    await user.click(screen.getByRole('button', { name: 'Reprint Tag' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Bagade Clothing')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Copies/)).toHaveValue('1');
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    // Category filter forwards selected parent categoryId to GET /api/v1/inventory
    await user.selectOptions(screen.getByLabelText('Category'), 'cat-sarees');
    await waitFor(() => {
      expect(listInventory).toHaveBeenLastCalledWith(
        expect.objectContaining({ categoryId: 'cat-sarees', page: 0 }),
        expect.any(AbortSignal),
      );
    });
  });

  it('grants WORKER role access to /inventory and /purchases/receive routes through AppRoutes', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/auth/session') {
        return new Response(
          JSON.stringify({ userId: 'worker-1', name: 'Counter Staff', role: 'WORKER' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.startsWith('/api/v1/categories') || url.startsWith('/api/v1/inventory')) {
        return new Response(JSON.stringify({ items: [], page: 0, size: 25, total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const client = createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch });
    render(
      <MemoryRouter initialEntries={['/inventory']}>
        <SessionProvider client={client}>
          <AppRoutes />
        </SessionProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Inventory' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Direct Receipt' })).toHaveAttribute(
      'href',
      '/purchases/receive',
    );
  });
});

// Keep fireEvent import clean when needed; avoid unused import lint warnings.
void act;
void fireEvent;
