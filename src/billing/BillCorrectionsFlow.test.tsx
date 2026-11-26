import { render, screen, waitFor, within } from '@testing-library/react';
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
import type { InventoryItem } from '../inventory/types.ts';
import { BillDetailPage } from './BillDetailPage.tsx';
import { BillHistoryPage } from './BillHistoryPage.tsx';
import { CustomersPage } from './CustomersPage.tsx';
import type { BillingApi } from './billingApi.ts';
import {
  computeReturnCreditPaise,
  computeRevisionActiveNetPaise,
  validateSettlementEntries,
} from './correctionUtils.ts';
import type {
  BillDetail,
  BillPrintData,
  CancelBillResponse,
  CollectBillPaymentResponse,
  Customer,
  EditBillResponse,
  ExchangeBillResponse,
  ReturnBillResponse,
} from './types.ts';

function makeMockBillingApi(overrides: Partial<BillingApi> = {}): BillingApi {
  return {
    listCustomers: vi.fn(async () => ({ items: [], page: 0, size: 25, total: 0 })),
    createCustomer: vi.fn(),
    previewBill: vi.fn(),
    createBill: vi.fn(),
    listBills: vi.fn(async () => ({ items: [], page: 0, size: 25, total: 0 })),
    getBill: vi.fn(),
    getBillPrintData: vi.fn(),
    downloadBillPdf: vi.fn(async () => ({
      blob: new Blob(['%PDF-1.4\n'], { type: 'application/pdf' }),
      filename: 'bill.pdf',
    })),
    reviseBill: vi.fn(),
    returnItems: vi.fn(),
    exchangeItems: vi.fn(),
    cancelBill: vi.fn(),
    collectPayment: vi.fn(),
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

function renderBillRoute(
  billId: string,
  billing: BillingApi,
  inventory = makeMockInventoryApi(),
  catalog = makeMockCatalogApi(),
) {
  return render(
    <MemoryRouter initialEntries={[`/billing/${billId}`]}>
      <Routes>
        <Route
          path="/billing/:billId"
          element={<BillDetailPage api={billing} inventory={inventory} catalog={catalog} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FE06 Bill Edits, Returns, Exchanges, Cancellations, Credit Collections & Customers', () => {
  it('computes return credits, revision active nets, and settlement rules accurately in paise', () => {
    // Line of 3 units @ 100.00 with 10.00 discount: return 1st unit = 97.00? roundHalfUp(1000/3 = 333), net = 10000 - 333 = 9667 paise
    const line = {
      quantity: 3,
      returnedQuantity: 0,
      unitSellingPrice: '100.00',
      discountAmount: '10.00',
    };
    const r1 = computeReturnCreditPaise(line, 1);
    expect(r1).toEqual({ subtotalAbsPaise: 10000, discountAbsPaise: 333, netAbsPaise: 9667 });
    // Returning remaining 2 clears full remainder of 1000 paise discount (1000 - 333 = 667)
    const r2 = computeReturnCreditPaise({ ...line, returnedQuantity: 1 }, 2);
    expect(r2).toEqual({ subtotalAbsPaise: 20000, discountAbsPaise: 667, netAbsPaise: 19333 });

    expect(
      computeRevisionActiveNetPaise({
        quantity: 3,
        returnedQuantity: 1,
        originalQuantity: 3,
        unitPricePaise: 10000,
        discountPaise: 1000,
      }),
    ).toBe(19333);

    // Requires refund when adjusted total falls below collected net paid
    const missingRefund = validateSettlementEntries([], 900000, 850000, false, ['PAYMENT', 'REFUND']);
    expect(missingRefund.valid).toBe(false);
    expect(missingRefund.bannerError).toMatch(/Refund of at least ₹500\.00 is required/i);

    // Walk-in bill cannot carry positive credit balance
    const walkInCredit = validateSettlementEntries([], 50000, 65000, false, ['PAYMENT', 'REFUND']);
    expect(walkInCredit.valid).toBe(false);
    expect(walkInCredit.bannerError).toMatch(/Walk-in bills cannot carry a positive balance/i);

    // Customer bill CAN carry credit balance
    const customerCredit = validateSettlementEntries([], 50000, 65000, true, ['PAYMENT', 'REFUND']);
    expect(customerCredit.valid).toBe(true);
    expect(customerCredit.balanceDueAfterPaise).toBe(15000);
  });

  it('performs price-only edit handling 409 PRICE_CHANGED and STALE_VERSION, keeping bill number visible and leaving inventory untouched', async () => {
    const user = userEvent.setup();

    let currentBill: BillDetail = {
      billId: 'bill-edit-1',
      billNumber: 'BILL-2026-0301',
      issueDate: '2026-11-26',
      issuedAt: '2026-11-26T04:00:00Z',
      status: 'ISSUED',
      currentRevisionNumber: 1,
      version: 0,
      customerId: null,
      customerName: null,
      customerContact: null,
      subtotal: '9000.00',
      discountTotal: '0.00',
      total: '9000.00',
      paid: '9000.00',
      balanceDue: '0.00',
      lines: [
        {
          billLineId: 'bl-1',
          logicalLineId: 'll-1',
          skuId: 'sku-saree',
          skuCode: 'SAR-EDIT-1',
          productName: 'Silk Saree',
          size: null,
          quantity: 2,
          returnedQuantity: 0,
          returnableQuantity: 2,
          unitSellingPrice: '4500.00',
          discountAmount: '0.00',
          lineTotal: '9000.00',
          allocations: [],
        },
      ],
      payments: [
        {
          paymentId: 'p-1',
          direction: 'PAYMENT',
          mode: 'CASH',
          amount: '9000.00',
          reference: null,
          postedAt: '2026-11-26T04:00:00Z',
          postedBy: 'worker1',
        },
      ],
      revisions: [
        {
          revisionId: 'rev-1',
          revisionNumber: 1,
          subtotal: '9000.00',
          discountTotal: '0.00',
          total: '9000.00',
          createdAt: '2026-11-26T04:00:00Z',
        },
      ],
      events: [],
      salesAdjustments: [],
      allocationReversals: [],
    };

    const reviseCalls: { key: string; expectedVersion: number; expectedTotal: string }[] = [];
    let attempt = 0;

    const billing = makeMockBillingApi({
      getBill: vi.fn(async () => currentBill),
      reviseBill: vi.fn(async (_billId, input, idempotencyKey): Promise<EditBillResponse> => {
        attempt += 1;
        reviseCalls.push({
          key: idempotencyKey,
          expectedVersion: input.expectedVersion,
          expectedTotal: input.expectedTotal,
        });
        if (attempt === 1) {
          throw new ApiClientError({
            kind: 'conflict',
            status: 409,
            code: 'PRICE_CHANGED',
            message: 'Bill total changed since preview.',
            details: {
              currentTotals: { subtotal: '8500.00', discountTotal: '0.00', total: '8500.00' },
            },
          });
        }
        if (attempt === 2) {
          currentBill = { ...currentBill, version: 1 };
          throw new ApiClientError({
            kind: 'conflict',
            status: 409,
            code: 'STALE_VERSION',
            message: 'Bill was modified by another request.',
          });
        }

        currentBill = {
          ...currentBill,
          currentRevisionNumber: 2,
          version: 2,
          subtotal: '8500.00',
          total: '8500.00',
          paid: '8500.00',
          balanceDue: '0.00',
        };
        return {
          billId: 'bill-edit-1',
          revision: 2,
          version: 2,
          total: '8500.00',
          adjustmentAmount: '-500.00',
          balanceDue: '0.00',
        };
      }),
    });
    const inventory = makeMockInventoryApi();
    const catalog = makeMockCatalogApi();

    renderBillRoute('bill-edit-1', billing, inventory, catalog);
    expect(await screen.findByRole('heading', { name: 'BILL-2026-0301' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit Bill' }));
    const priceInput = screen.getByLabelText('Unit selling price (₹)');
    await user.clear(priceInput);
    await user.type(priceInput, '4250.00');

    await user.click(screen.getByRole('button', { name: /Refund ₹500\.00 \(Cash\)/i }));
    await user.type(screen.getByLabelText(/Revision reason/i), 'Agreed price discount');

    await user.click(screen.getByRole('button', { name: 'Review Revision' }));
    expect(
      await screen.findByRole('heading', { name: 'Review revision for BILL-2026-0301' }),
    ).toBeInTheDocument();
    expect(screen.getByText('No stock changes (price/discount-only revision)')).toBeInTheDocument();

    // Attempt 1 -> 409 PRICE_CHANGED
    await user.click(screen.getByRole('button', { name: 'Confirm & Post Revision' }));
    expect(await screen.findByText(/Catalog prices changed while editing/i)).toBeInTheDocument();

    // Re-review & Attempt 2 -> 409 STALE_VERSION (reloads version 1, preserves draft)
    await user.click(screen.getByRole('button', { name: 'Review Revision' }));
    await user.click(screen.getByRole('button', { name: 'Confirm & Post Revision' }));
    expect(await screen.findByText(/Reloaded BILL-2026-0301/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('4250.00')).toBeInTheDocument();

    // Attempt 3 succeeds with updated expectedVersion=1 and a NEW Idempotency-Key
    await user.click(screen.getByRole('button', { name: 'Review Revision' }));
    await user.click(screen.getByRole('button', { name: 'Confirm & Post Revision' }));

    expect(await screen.findByText(/Revision 2 saved for BILL-2026-0301/i)).toBeInTheDocument();
    expect(reviseCalls[0].expectedVersion).toBe(0);
    expect(reviseCalls[2].expectedVersion).toBe(1);
    expect(reviseCalls[2].key).not.toBe(reviseCalls[0].key);
    expect(reviseCalls[2].key).not.toBe(reviseCalls[1].key);
    expect(billing.listBills).toHaveBeenCalled();
    // Price-only revision must NOT refresh inventory/catalog
    expect(inventory.listInventory).not.toHaveBeenCalled();
    expect(catalog.listSkus).not.toHaveBeenCalled();
  });

  it('handles partial SELLABLE and NON_SELLABLE returns, network retry with same Idempotency-Key, stock effects, and current receipt corrections print view', async () => {
    const user = userEvent.setup();

    let billState: BillDetail = {
      billId: 'bill-ret-1',
      billNumber: 'BILL-2026-0402',
      issueDate: '2026-11-26',
      issuedAt: '2026-11-26T05:00:00Z',
      status: 'ISSUED',
      currentRevisionNumber: 1,
      version: 0,
      customerId: 'cust-1',
      customerName: 'Ananya',
      customerContact: '9800001111',
      subtotal: '2000.00',
      discountTotal: '0.00',
      total: '2000.00',
      paid: '2000.00',
      balanceDue: '0.00',
      lines: [
        {
          billLineId: 'bl-a',
          logicalLineId: 'll-a',
          skuId: 'sku-a',
          skuCode: 'KRT-A',
          productName: 'Kurti Alpha',
          size: 'M',
          quantity: 2,
          returnedQuantity: 0,
          returnableQuantity: 2,
          unitSellingPrice: '500.00',
          discountAmount: '0.00',
          lineTotal: '1000.00',
          allocations: [],
        },
        {
          billLineId: 'bl-b',
          logicalLineId: 'll-b',
          skuId: 'sku-b',
          skuCode: 'KRT-B',
          productName: 'Kurti Beta',
          size: 'L',
          quantity: 1,
          returnedQuantity: 0,
          returnableQuantity: 1,
          unitSellingPrice: '1000.00',
          discountAmount: '0.00',
          lineTotal: '1000.00',
          allocations: [],
        },
      ],
      payments: [
        {
          paymentId: 'p-1',
          direction: 'PAYMENT',
          mode: 'CASH',
          amount: '2000.00',
          reference: null,
          postedAt: '2026-11-26T05:00:00Z',
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
          createdAt: '2026-11-26T05:00:00Z',
        },
      ],
      events: [],
      salesAdjustments: [],
      allocationReversals: [],
    };

    const returnCalls: { key: string; body: unknown }[] = [];
    let failFirstNetwork = true;

    const billing = makeMockBillingApi({
      getBill: vi.fn(async () => billState),
      returnItems: vi.fn(async (_id, input, key): Promise<ReturnBillResponse> => {
        returnCalls.push({ key, body: input });
        if (failFirstNetwork) {
          failFirstNetwork = false;
          throw new ApiClientError({
            kind: 'network',
            status: null,
            code: 'NETWORK_ERROR',
            message: 'Connection dropped.',
            retryable: true,
          });
        }
        billState = {
          ...billState,
          status: 'PARTIALLY_RETURNED',
          version: 1,
          total: '500.00',
          paid: '500.00',
          lines: [
            {
              ...billState.lines[0],
              returnedQuantity: 1,
              returnableQuantity: 1,
            },
            {
              ...billState.lines[1],
              returnedQuantity: 1,
              returnableQuantity: 0,
            },
          ],
        };
        return {
          returnId: 'ret-99',
          billId: 'bill-ret-1',
          version: 1,
          balanceDue: '0.00',
          stockEffects: [
            {
              skuId: 'sku-a',
              skuCode: 'KRT-A',
              batchId: 'b-a',
              stockCondition: 'SELLABLE',
              movementType: 'RETURN',
              quantityDelta: 1,
              resultingBatchQuantity: 5,
            },
            {
              skuId: 'sku-b',
              skuCode: 'KRT-B',
              batchId: 'b-b',
              stockCondition: 'NON_SELLABLE',
              movementType: 'RETURN',
              quantityDelta: 1,
              resultingBatchQuantity: 1,
            },
          ],
        };
      }),
      getBillPrintData: vi.fn(
        async (_id, revision): Promise<BillPrintData> => ({
          shopName: 'Bagade Clothing',
          receiptProfile: '80mm',
          billId: 'bill-ret-1',
          billNumber: 'BILL-2026-0402',
          status: revision ? null : 'PARTIALLY_RETURNED',
          revisionNumber: 1,
          issueDate: '2026-11-26',
          issuedAt: '2026-11-26T05:00:00Z',
          customerName: 'Ananya',
          customerContact: '9800001111',
          lines: [],
          subtotal: revision ? '2000.00' : '500.00',
          discountTotal: '0.00',
          total: revision ? '2000.00' : '500.00',
          paid: revision ? '2000.00' : '500.00',
          balanceDue: '0.00',
          payments: [
            {
              direction: 'REFUND',
              mode: 'CASH',
              amount: '1500.00',
              reference: null,
              postedAt: '2026-11-26T05:30:00Z',
            },
          ],
          corrections: revision
            ? []
            : [
                {
                  eventType: 'RETURN',
                  occurredAt: '2026-11-26T05:30:00Z',
                  reason: '1 good size swap + 1 damaged stitch',
                  amountDelta: '-1500.00',
                },
              ],
        }),
      ),
    });

    const inventory = makeMockInventoryApi();
    const catalog = makeMockCatalogApi();

    renderBillRoute('bill-ret-1', billing, inventory, catalog);
    expect(await screen.findByRole('heading', { name: 'BILL-2026-0402' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Return Items' }));

    // Enter return exceeding remaining returnable (3 > 2) -> inline guard
    const qtyA = screen.getByLabelText('Return qty (0 to 2)');
    await user.clear(qtyA);
    await user.type(qtyA, '3');
    expect(
      screen.getByText(/Cannot return 3; remaining returnable quantity is 2/i),
    ).toBeInTheDocument();

    await user.clear(qtyA);
    await user.type(qtyA, '1');

    const qtyB = screen.getByLabelText('Return qty (0 to 1)');
    await user.clear(qtyB);
    await user.type(qtyB, '1');

    // Mark second line NON_SELLABLE (stays OUT of sellable stock)
    const cardB = qtyB.closest('article') as HTMLElement;
    await user.click(within(cardB).getByLabelText(/Non-sellable \/ damaged/i));

    // Apply refund ₹1,500.00 preset and enter reason
    await user.click(screen.getByRole('button', { name: /Refund ₹1,500\.00 \(Cash\)/i }));
    await user.type(screen.getByLabelText(/Return reason/i), '1 good + 1 damaged stitch');

    await user.click(screen.getByRole('button', { name: 'Review Return' }));
    const reviewList = screen.getByRole('list', { name: 'Items to return' });
    expect(reviewList).toHaveTextContent('will go back into SELLABLE stock');
    expect(reviewList).toHaveTextContent('will be recorded as NON_SELLABLE (stays OUT of sellable stock)');

    // First post hits network drop -> retries exact same payload & Idempotency-Key
    await user.click(screen.getByRole('button', { name: 'Confirm & Post Return' }));
    expect(await screen.findByText(/reuse the same Idempotency-Key/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry return' }));

    expect(await screen.findByText(/Return posted on BILL-2026-0402/i)).toBeInTheDocument();
    expect(returnCalls).toHaveLength(2);
    expect(returnCalls[1].key).toBe(returnCalls[0].key);
    expect(returnCalls[1].body).toEqual(returnCalls[0].body);

    const effectsList = screen.getByRole('list', { name: 'Confirmed stock changes' });
    expect(effectsList).toHaveTextContent('added back to SELLABLE stock');
    expect(effectsList).toHaveTextContent('recorded as NON_SELLABLE (kept out of sellable stock)');

    expect(inventory.listInventory).toHaveBeenCalled();
    expect(catalog.listSkus).toHaveBeenCalled();

    // Opening default Current Print Receipt shows CORRECTIONS from print endpoint
    await user.click(screen.getByRole('button', { name: 'Print Receipt (80 mm)' }));
    const printDialog = await screen.findByRole('dialog');
    expect(await within(printDialog).findByText('CORRECTIONS')).toBeInTheDocument();
    expect(within(printDialog).getByText(/REFUND CASH/)).toBeInTheDocument();
    expect(billing.getBillPrintData).toHaveBeenCalledWith(
      'bill-ret-1',
      null,
      expect.any(AbortSignal),
    );
  });

  it('executes size 32 -> 34 exchange after preserving draft on INSUFFICIENT_STOCK conflict', async () => {
    const user = userEvent.setup();

    let billState: BillDetail = {
      billId: 'bill-exch-1',
      billNumber: 'BILL-2026-0500',
      issueDate: '2026-11-26',
      issuedAt: '2026-11-26T06:00:00Z',
      status: 'ISSUED',
      currentRevisionNumber: 1,
      version: 0,
      customerId: null,
      customerName: null,
      customerContact: null,
      subtotal: '500.00',
      discountTotal: '0.00',
      total: '500.00',
      paid: '500.00',
      balanceDue: '0.00',
      lines: [
        {
          billLineId: 'bl-32',
          logicalLineId: 'll-32',
          skuId: 'sku-32',
          skuCode: 'BRF-32',
          productName: 'Cotton Briefs',
          size: '32',
          quantity: 1,
          returnedQuantity: 0,
          returnableQuantity: 1,
          unitSellingPrice: '500.00',
          discountAmount: '0.00',
          lineTotal: '500.00',
          allocations: [],
        },
      ],
      payments: [],
      revisions: [],
      events: [],
      salesAdjustments: [],
      allocationReversals: [],
    };

    const sku34: SkuListItem = {
      skuId: 'sku-34',
      productId: 'p-brf',
      productName: 'Cotton Briefs',
      size: '34',
      skuCode: 'BRF-34',
      defaultSellingPrice: '650.00',
      sellableQuantity: 1,
      active: true,
      version: 1,
    };

    const inv34: InventoryItem = {
      skuId: 'sku-34',
      skuCode: 'BRF-34',
      productName: 'Cotton Briefs',
      size: '34',
      defaultSellingPrice: '650.00',
      active: true,
      sellableQuantity: 1,
      nonSellableQuantity: 0,
      stockVersion: 1,
      batches: [
        {
          batchId: 'batch-34-1',
          receivedDate: '2026-11-20',
          unitCost: '380.00',
          printedMrp: '699.00',
          sellableQuantity: 1,
          nonSellableQuantity: 0,
          internalBarcode: null,
        },
      ],
    };

    let attempt = 0;
    const billing = makeMockBillingApi({
      getBill: vi.fn(async () => billState),
      exchangeItems: vi.fn(async (_id, input): Promise<ExchangeBillResponse> => {
        attempt += 1;
        if (attempt === 1) {
          throw new ApiClientError({
            kind: 'conflict',
            status: 409,
            code: 'INSUFFICIENT_STOCK',
            message: 'Insufficient stock for SKU BRF-34 (requested 2, available 1).',
          });
        }
        billState = {
          ...billState,
          status: 'PARTIALLY_RETURNED',
          currentRevisionNumber: 2,
          version: 1,
          total: '650.00',
          paid: '650.00',
        };
        return {
          exchangeId: 'exch-32-34',
          billId: 'bill-exch-1',
          version: 1,
          priceDifference: '150.00',
          balanceDue: '0.00',
          stockEffects: [
            {
              skuId: 'sku-32',
              skuCode: 'BRF-32',
              batchId: 'batch-32-1',
              stockCondition: 'SELLABLE',
              movementType: 'RETURN',
              quantityDelta: 1,
              resultingBatchQuantity: 3,
            },
            {
              skuId: input.replacementLines[0].skuId,
              skuCode: 'BRF-34',
              batchId: 'batch-34-1',
              stockCondition: 'SELLABLE',
              movementType: 'SALE',
              quantityDelta: -1,
              resultingBatchQuantity: 0,
            },
          ],
        };
      }),
    });

    const inventory = makeMockInventoryApi({
      listInventory: vi.fn(async () => ({ items: [inv34], page: 0, size: 5, total: 1 })),
    });
    const catalog = makeMockCatalogApi({
      listSkus: vi.fn(async () => ({ items: [sku34], page: 0, size: 10, total: 1 })),
    });

    renderBillRoute('bill-exch-1', billing, inventory, catalog);
    expect(await screen.findByRole('heading', { name: 'BILL-2026-0500' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Exchange Items' }));

    // Select 1 size-32 returned
    const retQty = screen.getByLabelText('Return qty (0 to 1)');
    await user.clear(retQty);
    await user.type(retQty, '1');

    // Add size-34 replacement via search picker
    await user.click(screen.getByRole('button', { name: 'Search Replacement Product' }));
    const skuDialog = await screen.findByRole('dialog', { name: 'Select active SKU' });
    await user.click(await within(skuDialog).findByRole('button', { name: 'Select' }));

    // Enter qty=2 on replacement -> shows price difference +₹800 -> fails INSUFFICIENT_STOCK keeping draft intact!
    const repQty = await screen.findByLabelText('Replacement qty (Cotton Briefs)');
    await user.clear(repQty);
    await user.type(repQty, '2');
    await user.click(screen.getByRole('button', { name: /Collect ₹800\.00 \(Cash\)/i }));
    await user.type(screen.getByLabelText(/Exchange reason/i), 'Size 32 exchanged for 34');

    await user.click(screen.getByRole('button', { name: 'Review Exchange' }));
    await user.click(screen.getByRole('button', { name: 'Confirm & Post Exchange' }));

    expect(
      await screen.findByText(/No stock or bill changes were applied/i),
    ).toBeInTheDocument();
    // Draft preserved cleanly!
    expect(screen.getByDisplayValue('Size 32 exchanged for 34')).toBeInTheDocument();

    // Fix qty to 1, collect ₹150.00 UPI, and post successfully
    const repQtyAgain = screen.getByLabelText('Replacement qty (Cotton Briefs)');
    await user.clear(repQtyAgain);
    await user.type(repQtyAgain, '1');
    await user.click(screen.getByRole('button', { name: /Collect ₹150\.00 \(UPI\)/i }));
    await user.click(screen.getByRole('button', { name: 'Review Exchange' }));
    await user.click(screen.getByRole('button', { name: 'Confirm & Post Exchange' }));

    expect(await screen.findByText(/Exchange posted on BILL-2026-0500/i)).toBeInTheDocument();
    const effects = screen.getByRole('list', { name: 'Confirmed stock changes' });
    expect(effects).toHaveTextContent('BRF-32: +1 (added back to SELLABLE stock)');
    expect(effects).toHaveTextContent('BRF-34: -1 (deducted from SELLABLE stock)');
  });

  it('cancels a partially returned bill reversing only remaining units and refunding remaining paid amount', async () => {
    const user = userEvent.setup();

    let billState: BillDetail = {
      billId: 'bill-cxl-1',
      billNumber: 'BILL-2026-0600',
      issueDate: '2026-11-26',
      issuedAt: '2026-11-26T07:00:00Z',
      status: 'PARTIALLY_RETURNED',
      currentRevisionNumber: 1,
      version: 1,
      customerId: 'cust-1',
      customerName: 'Suman',
      customerContact: '9822001122',
      subtotal: '200.00',
      discountTotal: '0.00',
      total: '200.00',
      paid: '180.00',
      balanceDue: '20.00',
      lines: [
        {
          billLineId: 'bl-top',
          logicalLineId: 'll-top',
          skuId: 'sku-top',
          skuCode: 'TOP-CXL-1',
          productName: 'Linen Top',
          size: 'S',
          quantity: 3,
          returnedQuantity: 1,
          returnableQuantity: 2,
          unitSellingPrice: '100.00',
          discountAmount: '0.00',
          lineTotal: '300.00',
          allocations: [],
        },
      ],
      payments: [],
      revisions: [],
      events: [],
      salesAdjustments: [],
      allocationReversals: [],
    };

    const billing = makeMockBillingApi({
      getBill: vi.fn(async () => billState),
      cancelBill: vi.fn(async (): Promise<CancelBillResponse> => {
        billState = {
          ...billState,
          status: 'CANCELLED',
          version: 2,
          total: '0.00',
          paid: '0.00',
          balanceDue: '0.00',
          lines: [{ ...billState.lines[0], returnedQuantity: 3, returnableQuantity: 0 }],
        };
        return { billId: 'bill-cxl-1', version: 2, status: 'CANCELLED', balanceDue: '0.00' };
      }),
    });

    renderBillRoute('bill-cxl-1', billing);
    expect(await screen.findByRole('heading', { name: 'BILL-2026-0600' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel Bill' }));
    const remList = screen.getByRole('list', { name: 'Remaining unreturned units' });
    expect(remList).toHaveTextContent('returning remaining 2 of 3 pieces to SELLABLE stock');
    expect(remList).toHaveTextContent('1 previously returned untouched');

    await user.click(screen.getByRole('button', { name: /Refund ₹180\.00 \(Cash\)/i }));
    await user.type(screen.getByLabelText(/Cancellation reason/i), 'Order cancelled');
    await user.click(screen.getByRole('button', { name: 'Confirm & Cancel BILL-2026-0600' }));

    expect(
      await screen.findByText(/BILL-2026-0600 is cancelled\./i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Bill' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Return Items' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print Receipt (80 mm)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
  });

  it('navigates from Customers screen to customer bill history filter, collects credit with PAYMENT_EXCEEDS_BALANCE reload, and leaves inventory untouched', async () => {
    const user = userEvent.setup();

    let customersDb: Customer[] = [
      { customerId: 'cust-pk', name: 'Prakash Kale', contact: '9011223344' },
    ];
    let billState: BillDetail = {
      billId: 'bill-cr-1',
      billNumber: 'BILL-2026-0700',
      issueDate: '2026-11-26',
      issuedAt: '2026-11-26T08:00:00Z',
      status: 'ISSUED',
      currentRevisionNumber: 1,
      version: 0,
      customerId: 'cust-pk',
      customerName: 'Prakash Kale',
      customerContact: '9011223344',
      subtotal: '1000.00',
      discountTotal: '0.00',
      total: '1000.00',
      paid: '200.00',
      balanceDue: '800.00',
      lines: [
        {
          billLineId: 'bl-blz',
          logicalLineId: 'll-blz',
          skuId: 'sku-blz',
          skuCode: 'BLZ-40',
          productName: 'Blazer',
          size: '40',
          quantity: 1,
          returnedQuantity: 0,
          returnableQuantity: 1,
          unitSellingPrice: '1000.00',
          discountAmount: '0.00',
          lineTotal: '1000.00',
          allocations: [],
        },
      ],
      payments: [],
      revisions: [],
      events: [],
      salesAdjustments: [],
      allocationReversals: [],
    };

    let collectAttempt = 0;
    const billing = makeMockBillingApi({
      listCustomers: vi.fn(async () => ({
        items: customersDb,
        page: 0,
        size: 25,
        total: customersDb.length,
      })),
      createCustomer: vi.fn(async ({ name, contact }) => {
        const created: Customer = {
          customerId: 'cust-new',
          name,
          contact: contact ?? null,
        };
        customersDb = [...customersDb, created];
        return created;
      }),
      listBills: vi.fn(async () => ({
        items: [
          {
            billId: 'bill-cr-1',
            billNumber: 'BILL-2026-0700',
            issueDate: '2026-11-26',
            status: 'ISSUED' as const,
            total: '1000.00',
            paid: billState.paid,
            balanceDue: billState.balanceDue,
          },
        ],
        page: 0,
        size: 25,
        total: 1,
      })),
      getBill: vi.fn(async () => billState),
      collectPayment: vi.fn(async (_id, input): Promise<CollectBillPaymentResponse> => {
        collectAttempt += 1;
        if (collectAttempt === 1) {
          billState = { ...billState, version: 1, paid: '500.00', balanceDue: '500.00' };
          throw new ApiClientError({
            kind: 'conflict',
            status: 409,
            code: 'PAYMENT_EXCEEDS_BALANCE',
            message: 'Payment amount 600.00 exceeds remaining bill balance due 500.00.',
          });
        }
        billState = { ...billState, version: 2, paid: '1000.00', balanceDue: '0.00' };
        return {
          paymentId: 'pay-final-1',
          billId: 'bill-cr-1',
          version: 2,
          balanceDue: input.amount === '500.00' ? '0.00' : '200.00',
        };
      }),
    });

    const inventory = makeMockInventoryApi();
    const catalog = makeMockCatalogApi();

    render(
      <MemoryRouter initialEntries={['/customers']}>
        <Routes>
          <Route path="/customers" element={<CustomersPage api={billing} />} />
          <Route path="/billing/history" element={<BillHistoryPage api={billing} />} />
          <Route
            path="/billing/:billId"
            element={<BillDetailPage api={billing} inventory={inventory} catalog={catalog} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Customers' })).toBeInTheDocument();
    expect(await screen.findByText('Prakash Kale')).toBeInTheDocument();

    // Navigate from Customers -> View bills -> pre-filtered BillHistoryPage -> BillDetailPage
    await user.click(screen.getByRole('link', { name: 'View bills' }));
    expect(await screen.findByRole('heading', { name: 'Bill History' })).toBeInTheDocument();
    await waitFor(() => {
      expect(billing.listBills).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cust-pk' }),
        expect.any(AbortSignal),
      );
    });
    expect(screen.getByRole('button', { name: 'Customer: Prakash Kale' })).toBeInTheDocument();

    await user.click(await screen.findByRole('link', { name: 'BILL-2026-0700' }));
    expect(await screen.findByRole('heading', { name: 'BILL-2026-0700' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Record Payment/i }));
    const amtInput = screen.getByLabelText(/Payment amount/i);
    await user.clear(amtInput);
    await user.type(amtInput, '600.00');
    await user.click(screen.getByRole('radio', { name: 'UPI' }));
    await user.type(screen.getByLabelText(/Payment reference/i), 'UTR-FINAL');

    // Attempt 1 -> 409 PAYMENT_EXCEEDS_BALANCE reloads current balance ₹500.00 while keeping entered payment for review
    await user.click(screen.getByRole('button', { name: 'Record Payment' }));
    expect(
      await screen.findByText(/Current outstanding balance on BILL-2026-0700 \(Version 1\): ₹500\.00/i),
    ).toBeInTheDocument();
    expect(amtInput).toHaveValue('600.00');

    // Update to ₹500.00 -> collects final balance without touching inventory
    await user.click(screen.getByRole('button', { name: /Fill full balance/i }));
    await user.click(screen.getByRole('button', { name: 'Record Payment' }));
    expect(await screen.findByText(/Remaining balance due: ₹0\.00/i)).toBeInTheDocument();
    expect(inventory.listInventory).not.toHaveBeenCalled();
    expect(catalog.listSkus).not.toHaveBeenCalled();
  });

  it('permits both WORKER and OWNER to access /customers via AppRoutes', async () => {
    for (const role of ['WORKER', 'OWNER'] as const) {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/v1/auth/session') {
          return new Response(JSON.stringify({ userId: 'u', name: role, role }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.startsWith('/api/v1/customers')) {
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
        <MemoryRouter initialEntries={['/customers']}>
          <SessionProvider client={client}>
            <AppRoutes />
          </SessionProvider>
        </MemoryRouter>,
      );

      expect(await screen.findByRole('heading', { name: 'Customers' })).toBeInTheDocument();
      unmount();
    }
  });
});
