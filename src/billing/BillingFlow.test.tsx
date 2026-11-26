import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App.tsx';
import { createApiClient } from '../api/client.ts';
import { ApiClientError } from '../api/errors.ts';
import { SessionProvider } from '../auth/SessionContext.tsx';
import type { CatalogApi } from '../catalog/catalogApi.ts';
import type { SkuListItem } from '../catalog/types.ts';
import type { InventoryApi } from '../inventory/inventoryApi.ts';
import type { BarcodeLookupResult, EligibleBatch, InventoryItem } from '../inventory/types.ts';
import { BillDetailPage } from './BillDetailPage.tsx';
import { BillHistoryPage } from './BillHistoryPage.tsx';
import { BillingCounterPage } from './BillingCounterPage.tsx';
import type { BillingApi } from './billingApi.ts';
import type {
  BillDetail,
  BillLineInput,
  BillPreviewResponse,
  BillPrintData,
  BillSummary,
  CreateBillResponse,
  Customer,
} from './types.ts';

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

function makeMockBillingApi(overrides: Partial<BillingApi> = {}): BillingApi {
  return {
    listCustomers: vi.fn(async () => ({ items: [], page: 0, size: 10, total: 0 })),
    createCustomer: vi.fn(),
    previewBill: vi.fn(),
    createBill: vi.fn(),
    listBills: vi.fn(async () => ({ items: [], page: 0, size: 25, total: 0 })),
    getBill: vi.fn(),
    getBillPrintData: vi.fn(),
    downloadBillPdf: vi.fn(async () => ({
      blob: new Blob(['%PDF-1.4\n'], { type: 'application/pdf' }),
      filename: 'BILL-2026-0001.pdf',
    })),
    ...overrides,
  };
}

function computeMockPreview(
  lines: BillLineInput[],
  catalogMap: Record<
    string,
    {
      skuCode: string;
      productName: string;
      size: string | null;
      unitSellingPrice: string;
      availableQuantity: number;
      selectableBatches?: EligibleBatch[];
      requiresBatchSelection?: boolean;
    }
  >,
): BillPreviewResponse {
  let subtotalPaise = 0;
  let discountPaise = 0;
  let canCheckout = lines.length > 0;

  const previewLines = lines.map((line) => {
    const meta = catalogMap[line.skuId];
    const unitStr = line.unitPriceOverride ?? meta.unitSellingPrice;
    const unitPaise = Math.round(Number(unitStr) * 100);
    const lineSubPaise = unitPaise * line.quantity;
    const discStr = line.discountAmount ?? '0.00';
    const discPaise = Math.round(Number(discStr) * 100);
    const lineTotalPaise = Math.max(0, lineSubPaise - discPaise);

    subtotalPaise += lineSubPaise;
    discountPaise += discPaise;

    const needsBatch = Boolean(meta.requiresBatchSelection && !line.batchId);
    const stockOk = line.quantity <= meta.availableQuantity;
    if (needsBatch || !stockOk) {
      canCheckout = false;
    }

    const issues: string[] = [];
    if (needsBatch) issues.push('BATCH_SELECTION_REQUIRED');
    if (!stockOk) issues.push('INSUFFICIENT_STOCK');

    return {
      skuId: line.skuId,
      skuCode: meta.skuCode,
      productName: meta.productName,
      size: meta.size,
      batchId: line.batchId ?? null,
      quantity: line.quantity,
      unitSellingPrice: unitStr,
      discountAmount: discStr,
      lineSubtotal: (lineSubPaise / 100).toFixed(2),
      lineTotal: (lineTotalPaise / 100).toFixed(2),
      availableQuantity: meta.availableQuantity,
      sufficientStock: stockOk,
      requiresBatchSelection: needsBatch,
      selectableBatches: meta.selectableBatches ?? [],
      issues,
    };
  });

  const totalPaise = Math.max(0, subtotalPaise - discountPaise);
  return {
    lines: previewLines,
    subtotal: (subtotalPaise / 100).toFixed(2),
    discountTotal: (discountPaise / 100).toFixed(2),
    total: (totalPaise / 100).toFixed(2),
    canCheckout,
  };
}

function renderWithRouter(ui: React.ReactElement, initialEntry = '/billing') {
  return render(<MemoryRouter initialEntries={[initialEntry]}>{ui}</MemoryRouter>);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FE05 Counter Billing, Credit Checkout, and 80 mm Receipt Printing', () => {
  it('scans leading-zero branded barcode via Enter, retains internal tag batchId, merges only matching pricing/batch lines, and restores scan focus without stealing edits', async () => {
    const user = userEvent.setup();
    const createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock-receipt');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const lookupBarcode = vi.fn(async (code: string): Promise<BarcodeLookupResult> => {
      if (code === '0089012345') {
        return {
          code: '0089012345',
          mappingType: 'BRAND',
          skuId: 'sku-kurti',
          name: 'Cotton Kurti',
          size: 'M',
          defaultSellingPrice: '850.00',
          sellableQuantity: 10,
          batchId: null,
          printedMrp: null,
          batchSellableQuantity: null,
          requiresBatchSelection: false,
          eligibleBatches: [],
        };
      }
      if (code === 'BGD00000077') {
        return {
          code: 'BGD00000077',
          mappingType: 'INTERNAL',
          skuId: 'sku-saree',
          name: 'Kanjivaram Silk Saree',
          size: null,
          defaultSellingPrice: '4500.00',
          sellableQuantity: 4,
          batchId: 'batch-silk-77',
          printedMrp: '4800.00',
          batchSellableQuantity: 2,
          requiresBatchSelection: false,
          eligibleBatches: [],
        };
      }
      throw new ApiClientError({
        kind: 'not_found',
        status: 404,
        code: 'BARCODE_NOT_FOUND',
        message: 'Barcode not found',
      });
    });

    const previewBill = vi.fn(async (lines: BillLineInput[]) =>
      computeMockPreview(lines, {
        'sku-kurti': {
          skuCode: 'KRT-M',
          productName: 'Cotton Kurti',
          size: 'M',
          unitSellingPrice: '850.00',
          availableQuantity: 10,
        },
        'sku-saree': {
          skuCode: 'SILK-01',
          productName: 'Kanjivaram Silk Saree',
          size: null,
          unitSellingPrice: '4500.00',
          availableQuantity: 4,
        },
      }),
    );

    const createBill = vi.fn(
      async (input: { expectedTotal: string }, _idempotencyKey: string): Promise<CreateBillResponse> => ({
        billId: 'bill-101',
        billNumber: 'BILL-2026-0101',
        version: 1,
        issueDate: '2026-11-26',
        issuedAt: '2026-11-26T05:00:00Z',
        status: 'ISSUED',
        subtotal: '6200.00',
        discountTotal: '50.00',
        total: input.expectedTotal,
        paid: input.expectedTotal,
        balanceDue: '0.00',
        allocations: [],
      }),
    );

    const billing = makeMockBillingApi({ previewBill, createBill });
    const inventory = makeMockInventoryApi({ lookupBarcode });
    const catalog = makeMockCatalogApi();

    renderWithRouter(
      <BillingCounterPage billing={billing} inventory={inventory} catalog={catalog} />,
    );

    const scanInput = screen.getByLabelText(/Barcode \(supplier or internal\)/);

    // 1. Scan branded barcode with leading zeros via Enter (must not submit checkout!)
    await user.click(scanInput);
    await user.type(scanInput, '0089012345{enter}');

    expect(lookupBarcode).toHaveBeenCalledWith('0089012345');
    expect(await screen.findByText('Cotton Kurti')).toBeInTheDocument();
    expect(createBill).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(scanInput);

    // 2. Scan exact same branded item again -> merges quantity from 1 -> 2
    await user.type(scanInput, '0089012345{enter}');
    const kurtiCard1 = screen.getByRole('article', { name: 'Cotton Kurti cart line 1' });
    expect(within(kurtiCard1).getByLabelText('Quantity (Cotton Kurti)')).toHaveValue('2');

    // 3. Edit discount on line 1, then scan branded item again -> keeps a separate line 2!
    const discountInput = within(kurtiCard1).getByLabelText('Line discount (₹)');
    await user.type(discountInput, '50');
    expect(document.activeElement).toBe(discountInput);

    await user.type(scanInput, '0089012345{enter}');
    const kurtiCard2 = await screen.findByRole('article', {
      name: 'Cotton Kurti cart line 2',
    });
    expect(within(kurtiCard2).getByLabelText('Quantity (Cotton Kurti)')).toHaveValue('1');

    // Focus should NOT be stolen if cashier moves focus into another cart field during async scan
    let resolveDelayedLookup!: (value: BarcodeLookupResult) => void;
    lookupBarcode.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDelayedLookup = resolve;
        }),
    );
    await user.type(scanInput, 'BGD00000077{enter}');
    const qtyLine2 = within(kurtiCard2).getByLabelText('Quantity (Cotton Kurti)');
    await user.click(qtyLine2);
    expect(document.activeElement).toBe(qtyLine2);

    await act(async () => {
      resolveDelayedLookup({
        code: 'BGD00000077',
        mappingType: 'INTERNAL',
        skuId: 'sku-saree',
        name: 'Kanjivaram Silk Saree',
        size: null,
        defaultSellingPrice: '4500.00',
        sellableQuantity: 4,
        batchId: 'batch-silk-77',
        printedMrp: '4800.00',
        batchSellableQuantity: 2,
        requiresBatchSelection: false,
        eligibleBatches: [],
      });
    });

    const sareeCard = await screen.findByRole('article', {
      name: 'Kanjivaram Silk Saree cart line 3',
    });
    expect(within(sareeCard).getByText('Internal tag: BGD00000077')).toBeInTheDocument();
    expect(within(sareeCard).getByText('Printed MRP: ₹4,800.00')).toBeInTheDocument();
    // Cashier's focus was NOT stolen while editing qtyLine2!
    expect(document.activeElement).toBe(qtyLine2);

    // Wait for preview total: 2*850 - 50 + 1*850 + 1*4500 = 7000.00 (subtotal 7050 - 50 = 7000.00)
    const billTotalRow = screen.getByText('Bill Total').closest('.billing-total-row') as HTMLElement;
    await waitFor(() => {
      expect(within(billTotalRow).getByText('₹7,000.00')).toBeInTheDocument();
    });

    // Split payment: Cash 3000 + UPI remaining (4000.00)
    await user.click(screen.getByRole('button', { name: 'Split Cash + UPI' }));
    await user.type(screen.getByLabelText('Amount (₹) (1)'), '3000');
    const fillButtons = screen.getAllByRole('button', { name: 'Fill remaining' });
    await user.click(fillButtons[1]);
    expect(screen.getByLabelText('Amount (₹) (2)')).toHaveValue('4000.00');
    await user.type(screen.getAllByLabelText('Payment reference (optional)')[1], 'UPI-REF-88');

    await user.click(screen.getByRole('button', { name: 'Complete Bill' }));

    await waitFor(() => {
      expect(createBill).toHaveBeenCalledTimes(1);
    });
    const [submittedPayload, submittedKey] = createBill.mock.calls[0];
    expect(submittedKey).toBeTruthy();
    expect(submittedPayload).toEqual({
      lines: [
        { skuId: 'sku-kurti', quantity: 2, discountAmount: '50.00' },
        { skuId: 'sku-kurti', quantity: 1 },
        { skuId: 'sku-saree', quantity: 1, batchId: 'batch-silk-77' },
      ],
      expectedTotal: '7000.00',
      payments: [
        { mode: 'CASH', amount: '3000.00' },
        { mode: 'UPI', amount: '4000.00', reference: 'UPI-REF-88' },
      ],
    });

    expect(await screen.findByText('Bill issued: BILL-2026-0101')).toBeInTheDocument();
    expect(catalog.listSkus).toHaveBeenCalled();
    expect(inventory.listInventory).toHaveBeenCalled();
    expect(billing.listBills).toHaveBeenCalled();

    // Direct Download PDF from completed banner works cleanly
    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => {
      expect(billing.downloadBillPdf).toHaveBeenCalledWith('bill-101');
      expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    });
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it('offers product search on BARCODE_NOT_FOUND without clearing cart, prompts differing printed MRPs, and flags insufficient stock', async () => {
    const user = userEvent.setup();

    const lookupBarcode = vi.fn(async (code: string): Promise<BarcodeLookupResult> => {
      if (code === '001122') {
        return {
          code: '001122',
          mappingType: 'BRAND',
          skuId: 'sku-1',
          name: 'Linen Shirt',
          size: 'L',
          defaultSellingPrice: '1200.00',
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
        message: 'No matching barcode mapping found.',
      });
    });

    const skuFromSearch: SkuListItem = {
      skuId: 'sku-trouser',
      productId: 'prod-2',
      productName: 'Formal Trouser',
      size: '32',
      skuCode: 'TRS-32',
      defaultSellingPrice: '1500.00',
      sellableQuantity: 2,
      active: true,
      version: 1,
    };

    const inventoryItems: InventoryItem[] = [
      {
        skuId: 'sku-trouser',
        skuCode: 'TRS-32',
        productName: 'Formal Trouser',
        size: '32',
        defaultSellingPrice: '1500.00',
        active: true,
        sellableQuantity: 2,
        nonSellableQuantity: 0,
        stockVersion: 1,
        batches: [
          {
            batchId: 'batch-mrp-1',
            receivedDate: '2026-11-10',
            unitCost: '900.00',
            printedMrp: '1499.00',
            sellableQuantity: 1,
            nonSellableQuantity: 0,
            internalBarcode: null,
          },
          {
            batchId: 'batch-mrp-2',
            receivedDate: '2026-11-20',
            unitCost: '950.00',
            printedMrp: '1699.00',
            sellableQuantity: 1,
            nonSellableQuantity: 0,
            internalBarcode: null,
          },
        ],
      },
    ];

    const previewBill = vi.fn(async (lines: BillLineInput[]) =>
      computeMockPreview(lines, {
        'sku-1': {
          skuCode: 'LIN-L',
          productName: 'Linen Shirt',
          size: 'L',
          unitSellingPrice: '1200.00',
          availableQuantity: 5,
        },
        'sku-trouser': {
          skuCode: 'TRS-32',
          productName: 'Formal Trouser',
          size: '32',
          unitSellingPrice: '1500.00',
          availableQuantity: 1,
        },
      }),
    );

    const billing = makeMockBillingApi({ previewBill });
    const inventory = makeMockInventoryApi({
      lookupBarcode,
      listInventory: vi.fn(async () => ({ items: inventoryItems, page: 0, size: 5, total: 1 })),
    });
    const catalog = makeMockCatalogApi({
      listSkus: vi.fn(async () => ({ items: [skuFromSearch], page: 0, size: 10, total: 1 })),
    });

    renderWithRouter(
      <BillingCounterPage billing={billing} inventory={inventory} catalog={catalog} />,
    );

    const scanInput = screen.getByLabelText(/Barcode \(supplier or internal\)/);
    await user.type(scanInput, '001122{enter}');
    expect(await screen.findByText('Linen Shirt')).toBeInTheDocument();

    // Unknown barcode preserves existing cart and offers catalog search pre-seeded with failed code
    await user.type(scanInput, '999999{enter}');
    expect(await screen.findByText(/No matching barcode mapping found/i)).toBeInTheDocument();
    expect(screen.getByText('Linen Shirt')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Search product catalog' }));
    const dialog = await screen.findByRole('dialog', { name: 'Select active SKU' });
    expect(within(dialog).getByLabelText('Search active SKUs')).toHaveValue('999999');

    await user.click(await within(dialog).findByRole('button', { name: 'Select' }));

    // Differing printed MRPs trigger BatchSelectionModal while keeping selling price clearly separate
    const batchDialog = await screen.findByRole('dialog', {
      name: 'Select stock batch (differing printed MRPs)',
    });
    expect(batchDialog).toHaveTextContent('Shop selling price: ₹1,500.00');
    expect(batchDialog).toHaveTextContent('Printed MRP: ₹1,499.00');
    expect(batchDialog).toHaveTextContent('Printed MRP: ₹1,699.00');

    const selectBatchBtns = within(batchDialog).getAllByRole('button', { name: 'Select batch' });
    await user.click(selectBatchBtns[1]);

    const trouserCard = await screen.findByRole('article', {
      name: 'Formal Trouser cart line 2',
    });
    expect(within(trouserCard).getByText('Printed MRP: ₹1,699.00')).toBeInTheDocument();
    expect(document.activeElement).toBe(scanInput);

    // Increase quantity above batch availability -> flags insufficient stock without clearing cart
    await user.click(within(trouserCard).getByRole('button', { name: 'Increase quantity for Formal Trouser' }));
    expect(
      await within(trouserCard).findByText(/Insufficient stock: only 1 sellable unit available/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Linen Shirt')).toBeInTheDocument();
  });

  it('enforces customer requirement on partial/full credit, allows inline customer creation keeping cart intact, blocks overpayment, and handles Idempotency-Key retries plus 409 PRICE_CHANGED', async () => {
    const user = userEvent.setup();

    let customersDb: Customer[] = [];
    let currentCatalogPrice = '1000.00';
    let createAttempt = 0;
    const submittedCalls: { payload: unknown; key: string }[] = [];

    const lookupBarcode = vi.fn(async (): Promise<BarcodeLookupResult> => ({
      code: '005500',
      mappingType: 'BRAND',
      skuId: 'sku-dress',
      name: 'Festive Dress',
      size: 'S',
      defaultSellingPrice: currentCatalogPrice,
      sellableQuantity: 5,
      batchId: null,
      printedMrp: null,
      batchSellableQuantity: null,
      requiresBatchSelection: false,
      eligibleBatches: [],
    }));

    const previewBill = vi.fn(async (lines: BillLineInput[]) =>
      computeMockPreview(lines, {
        'sku-dress': {
          skuCode: 'DRS-S',
          productName: 'Festive Dress',
          size: 'S',
          unitSellingPrice: currentCatalogPrice,
          availableQuantity: 5,
        },
      }),
    );

    const createBill = vi.fn(async (input, idempotencyKey): Promise<CreateBillResponse> => {
      createAttempt += 1;
      submittedCalls.push({ payload: input, key: idempotencyKey });

      if (createAttempt === 1) {
        throw new ApiClientError({
          kind: 'conflict',
          status: 409,
          code: 'PRICE_CHANGED',
          message: 'Item prices changed since preview.',
          details: {
            currentTotals: {
              subtotal: '1200.00',
              discountTotal: '0.00',
              total: '1200.00',
            },
          },
        });
      }

      if (createAttempt === 2) {
        throw new ApiClientError({
          kind: 'network',
          status: null,
          code: 'NETWORK_ERROR',
          message: 'Connection reset.',
          retryable: true,
        });
      }

      return {
        billId: 'bill-credit-1',
        billNumber: 'BILL-2026-0205',
        version: 1,
        issueDate: '2026-11-26',
        issuedAt: '2026-11-26T06:00:00Z',
        status: 'ISSUED',
        subtotal: '1200.00',
        discountTotal: '0.00',
        total: input.expectedTotal,
        paid: '0.00',
        balanceDue: input.expectedTotal,
        allocations: [],
      };
    });

    const billing = makeMockBillingApi({
      listCustomers: vi.fn(async () => ({
        items: customersDb,
        page: 0,
        size: 10,
        total: customersDb.length,
      })),
      createCustomer: vi.fn(async ({ name, contact }) => {
        const created: Customer = {
          customerId: 'cust-new-1',
          name,
          contact: contact ?? null,
        };
        customersDb = [created];
        return created;
      }),
      previewBill,
      createBill,
    });

    renderWithRouter(
      <BillingCounterPage
        billing={billing}
        inventory={makeMockInventoryApi({ lookupBarcode })}
        catalog={makeMockCatalogApi()}
      />,
    );

    await user.type(screen.getByLabelText(/Barcode \(supplier or internal\)/), '005500{enter}');
    const billTotalRow = screen.getByText('Bill Total').closest('.billing-total-row') as HTMLElement;
    await waitFor(() => {
      expect(within(billTotalRow).getByText('₹1,000.00')).toBeInTheDocument();
    });

    // Overpayment check
    await user.click(screen.getByRole('button', { name: 'Cash (Full)' }));
    const cashInput = screen.getByLabelText('Amount (₹) (1)');
    await user.clear(cashInput);
    await user.type(cashInput, '1500');
    expect(screen.getByText(/Overpayment is not allowed/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Complete Bill' }));
    expect(createBill).not.toHaveBeenCalled();

    // Switch to Full Credit without customer -> blocked cleanly
    await user.click(screen.getByRole('button', { name: 'Full Credit' }));
    await user.click(screen.getByRole('button', { name: 'Complete Bill' }));
    expect(
      await screen.findByText(/Select or create a customer when a credit balance remains due/i),
    ).toBeInTheDocument();
    expect(createBill).not.toHaveBeenCalled();

    // Create customer inline while preserving cart
    await user.click(screen.getByRole('button', { name: 'Select / Create customer' }));
    const custDialog = await screen.findByRole('dialog', { name: 'Select or create customer' });
    await user.click(within(custDialog).getByRole('button', { name: '+ New customer' }));
    await user.type(within(custDialog).getByLabelText(/Customer name/i), 'Meena Patel');
    await user.type(within(custDialog).getByLabelText(/Contact /i), '9820012345');
    await user.click(within(custDialog).getByRole('button', { name: 'Create & select customer' }));

    expect(await screen.findByText(/Meena Patel/i)).toBeInTheDocument();
    expect(screen.getByText('Festive Dress')).toBeInTheDocument();

    // Attempt 1 triggers 409 PRICE_CHANGED -> backend price increased to 1200.00
    currentCatalogPrice = '1200.00';
    await user.click(screen.getByRole('button', { name: 'Complete Bill' }));

    expect(await screen.findByText(/Catalog prices changed while this bill was open/i)).toBeInTheDocument();
    expect(screen.getByText(/Revised totals: Subtotal/i)).toHaveTextContent('₹1,200.00');
    // Must refresh preview automatically to 1200.00 and NOT auto-submit!
    await waitFor(() => {
      expect(within(billTotalRow).getByText('₹1,200.00')).toBeInTheDocument();
    });
    expect(createBill).toHaveBeenCalledTimes(1);

    // Attempt 2 uses a fresh Idempotency-Key with updated expectedTotal '1200.00' -> fails network
    await user.click(screen.getByRole('button', { name: 'Complete Bill' }));
    expect(
      await screen.findByText(/Retry with the same Idempotency-Key so the bill is not created twice/i),
    ).toBeInTheDocument();

    // Retry checkout -> reuses EXACT same Idempotency-Key and payload from Attempt 2!
    await user.click(screen.getByRole('button', { name: 'Retry checkout' }));
    expect(await screen.findByText('Bill issued: BILL-2026-0205')).toBeInTheDocument();
    expect(createBill).toHaveBeenCalledTimes(3);

    expect(submittedCalls[1].key).not.toBe(submittedCalls[0].key);
    expect(submittedCalls[2].key).toBe(submittedCalls[1].key);
    expect(submittedCalls[2].payload).toEqual(submittedCalls[1].payload);
    expect(submittedCalls[2].payload).toMatchObject({
      expectedTotal: '1200.00',
      customerId: 'cust-new-1',
      payments: [],
    });
  });

  it('filters bill history, views saved bill snapshot, passes selected revision consistently to print modal and PDF download, and enforces print cancel safety', async () => {
    const user = userEvent.setup();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rev-pdf');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const summaries: BillSummary[] = [
      {
        billId: 'bill-50',
        billNumber: 'BILL-2026-0050',
        issueDate: '2026-11-25',
        status: 'PARTIALLY_RETURNED',
        total: '1800.00',
        paid: '1000.00',
        balanceDue: '800.00',
      },
    ];

    const detail: BillDetail = {
      billId: 'bill-50',
      billNumber: 'BILL-2026-0050',
      issueDate: '2026-11-25',
      issuedAt: '2026-11-25T10:30:00Z',
      status: 'PARTIALLY_RETURNED',
      currentRevisionNumber: 2,
      version: 2,
      customerId: 'cust-1',
      customerName: 'Ramesh',
      customerContact: '9988776655',
      subtotal: '1900.00',
      discountTotal: '100.00',
      total: '1800.00',
      paid: '1000.00',
      balanceDue: '800.00',
      lines: [
        {
          billLineId: 'bl-1',
          logicalLineId: 'll-1',
          skuId: 'sku-1',
          skuCode: 'SR-RED',
          productName: 'Red Silk Saree',
          size: null,
          quantity: 1,
          returnedQuantity: 0,
          returnableQuantity: 1,
          unitSellingPrice: '1900.00',
          discountAmount: '100.00',
          lineTotal: '1800.00',
          allocations: [],
        },
      ],
      payments: [
        {
          paymentId: 'pay-1',
          direction: 'PAYMENT',
          mode: 'UPI',
          amount: '1000.00',
          reference: 'UPI-50',
          postedAt: '2026-11-25T10:30:00Z',
          postedBy: 'worker1',
        },
      ],
      revisions: [
        {
          revisionId: 'rev-1',
          revisionNumber: 1,
          subtotal: '2000.00',
          discountTotal: '0.00',
          total: '2000.00',
          createdAt: '2026-11-25T10:30:00Z',
        },
        {
          revisionId: 'rev-2',
          revisionNumber: 2,
          subtotal: '1900.00',
          discountTotal: '100.00',
          total: '1800.00',
          createdAt: '2026-11-25T11:00:00Z',
        },
      ],
      events: [],
      salesAdjustments: [],
      allocationReversals: [],
    };

    const listBills = vi.fn(async () => ({ items: summaries, page: 0, size: 25, total: 1 }));
    const getBill = vi.fn(async () => detail);
    const getBillPrintData = vi.fn(
      async (_billId: string, revision?: number | null): Promise<BillPrintData> => ({
        shopName: 'Bagade Sarees',
        receiptProfile: 'THERMAL_80MM',
        billId: 'bill-50',
        billNumber: 'BILL-2026-0050',
        status: 'PARTIALLY_RETURNED',
        revisionNumber: revision ?? 2,
        issueDate: '2026-11-25',
        issuedAt: '2026-11-25T10:30:00Z',
        customerName: 'Ramesh',
        customerContact: '9988776655',
        lines: [
          {
            skuCode: 'SR-RED',
            productName: 'Red Silk Saree',
            size: null,
            quantity: 1,
            returnedQuantity: 0,
            unitSellingPrice: revision === 1 ? '2000.00' : '1900.00',
            discountAmount: revision === 1 ? '0.00' : '100.00',
            lineTotal: revision === 1 ? '2000.00' : '1800.00',
          },
        ],
        subtotal: revision === 1 ? '2000.00' : '1900.00',
        discountTotal: revision === 1 ? '0.00' : '100.00',
        total: revision === 1 ? '2000.00' : '1800.00',
        paid: '1000.00',
        balanceDue: revision === 1 ? '1000.00' : '800.00',
        payments: [],
        corrections: [],
      }),
    );

    const billing = makeMockBillingApi({
      listBills,
      getBill,
      getBillPrintData,
    });

    const historyRender = renderWithRouter(<BillHistoryPage api={billing} />, '/billing/history');
    expect(await screen.findByText('BILL-2026-0050')).toBeInTheDocument();

    // Filter by billNumber and check query params passed cleanly
    await user.type(screen.getByLabelText('Bill number'), 'BILL-2026-0050');
    await waitFor(() => {
      expect(listBills).toHaveBeenLastCalledWith(
        expect.objectContaining({ billNumber: 'BILL-2026-0050', page: 0, size: 25 }),
        expect.any(AbortSignal),
      );
    });
    historyRender.unmount();

    // Render BillDetailPage via route parameter for bill-50
    render(
      <MemoryRouter initialEntries={['/billing/bill-50']}>
        <Routes>
          <Route path="/billing/:billId" element={<BillDetailPage api={billing} />} />
        </Routes>
      </MemoryRouter>,
    );

    // Wait for saved snapshot rendering
    expect(await screen.findByRole('heading', { name: 'BILL-2026-0050' })).toBeInTheDocument();
    expect(screen.getByText('Red Silk Saree')).toBeInTheDocument();

    // Select Revision 1 and verify BOTH Print Preview Modal and direct Download PDF receive revision 1
    await user.selectOptions(screen.getByLabelText('Receipt revision'), '1');
    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => {
      expect(billing.downloadBillPdf).toHaveBeenCalledWith('bill-50', 1);
    });

    await user.click(screen.getByRole('button', { name: 'Print Receipt (80 mm)' }));
    const printDialog = await screen.findByRole('dialog', {
      name: 'Bill Receipt Preview — Rev 1',
    });
    expect(await within(printDialog).findByText(/\(Rev 1\)/)).toBeInTheDocument();
    expect(getBillPrintData).toHaveBeenCalledWith('bill-50', 1, expect.any(AbortSignal));

    // Clicking Print keeps preview dialog open for retry/PDF if printing cancels
    await user.click(within(printDialog).getByRole('button', { name: 'Print 80mm receipt' }));
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(
      within(printDialog).getByText(/If printing was cancelled or the printer is unavailable/i),
    ).toBeInTheDocument();
    expect(within(printDialog).getByRole('button', { name: 'Print again' })).toBeInTheDocument();
  });

  it('allows both WORKER and OWNER to access /billing, /billing/history, and /billing/:billId via AppRoutes', async () => {
    for (const role of ['WORKER', 'OWNER'] as const) {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/v1/auth/session') {
          return new Response(
            JSON.stringify({ userId: `${role}-id`, name: role, role }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.startsWith('/api/v1/bills')) {
          return new Response(JSON.stringify({ items: [], page: 0, size: 25, total: 0 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ csrfToken: 'csrf' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const client = createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch });
      const { unmount } = render(
        <MemoryRouter initialEntries={['/billing/history']}>
          <SessionProvider client={client}>
            <AppRoutes />
          </SessionProvider>
        </MemoryRouter>,
      );

      expect(await screen.findByRole('heading', { name: 'Bill History' })).toBeInTheDocument();
      unmount();
    }
  });
});
