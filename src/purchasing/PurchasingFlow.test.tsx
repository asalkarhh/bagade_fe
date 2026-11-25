import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App.tsx';
import { createApiClient } from '../api/client.ts';
import { ApiClientError } from '../api/errors.ts';
import { SessionProvider } from '../auth/SessionContext.tsx';
import type { CatalogApi } from '../catalog/catalogApi.ts';
import type { SkuListItem } from '../catalog/types.ts';
import { getShopLocalDateIso } from '../utils/shopDate.ts';
import { CreatePurchaseOrderPage } from './CreatePurchaseOrderPage.tsx';
import { PurchaseOrderDetailPage } from './PurchaseOrderDetailPage.tsx';
import { PurchaseOrdersPage } from './PurchaseOrdersPage.tsx';
import { PurchasesLayout } from './PurchasesLayout.tsx';
import type { PurchasingApi } from './purchasingApi.ts';
import type { PurchaseOrderDetail, PurchaseOrderListItem, Vendor } from './types.ts';
import { VendorsPage } from './VendorsPage.tsx';

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
    listSkus: vi.fn(async () => ({ items: [], page: 0, size: 10, total: 0 })),
    updateSku: vi.fn(),
    findLatestSkuById: vi.fn(async () => null),
    ...overrides,
  };
}

describe('FE03 Vendors and Purchase Orders UI', () => {
  it('supports retrying vendor list, filtering Active/Inactive/All, searching, and creating a vendor while keeping form on error', async () => {
    const user = userEvent.setup();
    let failInitial = true;
    let vendors: Vendor[] = [
      {
        vendorId: 'v-1',
        name: 'Kanchipuram Looms',
        contact: '9876543210',
        active: true,
      },
      {
        vendorId: 'v-old',
        name: 'Old Textile House',
        contact: null,
        active: false,
      },
    ];

    const listVendors = vi.fn(async ({ q, status }: { q?: string; status: string }) => {
      if (failInitial) {
        failInitial = false;
        throw new ApiClientError({
          kind: 'network',
          status: 503,
          code: 'BACKEND_UNAVAILABLE',
          message: 'Vendor service temporarily unavailable',
          retryable: true,
        });
      }

      const filtered = vendors.filter((v) => {
        if (status === 'ACTIVE' && !v.active) return false;
        if (status === 'INACTIVE' && v.active) return false;
        if (q) {
          const needle = q.toLowerCase();
          return (
            v.name.toLowerCase().includes(needle) ||
            (v.contact?.toLowerCase().includes(needle) ?? false)
          );
        }
        return true;
      });
      return { items: filtered, page: 0, size: 25, total: filtered.length };
    });

    let failCreate = true;
    const createVendor = vi.fn(async ({ name, contact }: { name: string; contact?: string | null }) => {
      if (failCreate) {
        failCreate = false;
        throw new ApiClientError({
          kind: 'conflict',
          status: 409,
          code: 'DUPLICATE_VENDOR',
          message: 'Vendor name already exists',
          fieldErrors: [{ field: 'name', message: 'A vendor with this name already exists' }],
          retryable: false,
        });
      }
      const created: Vendor = {
        vendorId: 'v-2',
        name,
        contact: contact ?? null,
        active: true,
      };
      vendors = [...vendors, created];
      return created;
    });

    const api = makeMockPurchasingApi({ listVendors, createVendor });

    render(
      <MemoryRouter initialEntries={['/purchases/vendors']}>
        <Routes>
          <Route path="/purchases" element={<PurchasesLayout />}>
            <Route path="vendors" element={<VendorsPage api={api} />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Vendor service temporarily unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('rowheader', { name: 'Kanchipuram Looms' })).toBeInTheDocument();
    expect(screen.queryByRole('rowheader', { name: 'Old Textile House' })).not.toBeInTheDocument();

    // Switch to Inactive -> shows inactive vendor with em dash contact
    await user.click(screen.getByRole('radio', { name: 'Inactive' }));
    const inactiveRow = (await screen.findByRole('rowheader', { name: 'Old Textile House' })).closest(
      'tr',
    );
    expect(inactiveRow).not.toBeNull();
    expect(within(inactiveRow!).getByText('—')).toBeInTheDocument();
    expect(within(inactiveRow!).getByText('Inactive')).toBeInTheDocument();

    // Switch to All and search by contact
    await user.click(screen.getByRole('radio', { name: 'All' }));
    await user.type(screen.getByLabelText('Search vendor name or contact'), '98765');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('rowheader', { name: 'Kanchipuram Looms' })).toBeInTheDocument();
    expect(screen.queryByRole('rowheader', { name: 'Old Textile House' })).not.toBeInTheDocument();

    // Create vendor -> failure preserves form -> fix name & resubmit succeeds
    await user.click(screen.getByRole('button', { name: 'New vendor' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Vendor name/), 'Duplicate Looms');
    await user.type(within(dialog).getByLabelText(/Contact/), 'owner@looms.in');
    await user.click(within(dialog).getByRole('button', { name: 'Create vendor' }));

    expect(
      await within(dialog).findByText('A vendor with this name already exists'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Vendor name/)).toHaveValue('Duplicate Looms');
    expect(within(dialog).getByLabelText(/Contact/)).toHaveValue('owner@looms.in');

    await user.clear(within(dialog).getByLabelText(/Vendor name/));
    await user.type(within(dialog).getByLabelText(/Vendor name/), 'Surat Weaves');
    await user.click(within(dialog).getByRole('button', { name: 'Create vendor' }));

    expect(await screen.findByText('Vendor "Surat Weaves" created.')).toBeInTheDocument();
  });

  it('prevents stale PO responses from overwriting newer filters, resets pagination, validates date ranges, and displays all 4 statuses', async () => {
    const user = userEvent.setup();

    let resolveSlowInitial!: (value: {
      items: PurchaseOrderListItem[];
      page: number;
      size: number;
      total: number;
    }) => void;

    const vendors: Vendor[] = [
      { vendorId: 'v-1', name: 'Kanchipuram Looms', contact: null, active: true },
      { vendorId: 'v-2', name: 'Surat Weaves', contact: null, active: true },
    ];

    const listPurchaseOrders = vi.fn(
      ({ status, page }: { status?: string; vendorId?: string | null; page: number }) => {
        if (!status) {
          return new Promise<{
            items: PurchaseOrderListItem[];
            page: number;
            size: number;
            total: number;
          }>((resolve) => {
            resolveSlowInitial = resolve;
          });
        }

        return Promise.resolve({
          items: [
            {
              poId: 'po-closed',
              poNumber: 'PO-0099',
              vendorId: 'v-2',
              orderDate: '2026-11-24',
              status: 'CLOSED' as const,
              totalOpenQuantity: 0,
              version: 2,
            },
            {
              poId: 'po-part',
              poNumber: 'PO-0098',
              vendorId: 'v-1',
              orderDate: '2026-11-23',
              status: 'PARTIALLY_RECEIVED' as const,
              totalOpenQuantity: 6,
              version: 1,
            },
            {
              poId: 'po-open',
              poNumber: 'PO-0097',
              vendorId: 'v-1',
              orderDate: '2026-11-22',
              status: 'OPEN' as const,
              totalOpenQuantity: 12,
              version: 0,
            },
            {
              poId: 'po-cancel',
              poNumber: 'PO-0096',
              vendorId: 'v-2',
              orderDate: '2026-11-21',
              status: 'CANCELLED' as const,
              totalOpenQuantity: 0,
              version: 1,
            },
          ],
          page,
          size: 25,
          total: 30,
        });
      },
    );

    const api = makeMockPurchasingApi({
      listAllVendors: vi.fn(async () => vendors),
      listPurchaseOrders,
    });

    render(
      <MemoryRouter initialEntries={['/purchases']}>
        <Routes>
          <Route path="/purchases" element={<PurchasesLayout />}>
            <Route index element={<PurchaseOrdersPage api={api} />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    // Filter immediately while initial unfiltered request is still slow/pending
    await user.selectOptions(screen.getByLabelText('Status'), 'CLOSED');

    const closedPoLink = await screen.findByRole('link', { name: 'PO-0099' });
    const closedPoRow = closedPoLink.closest('tr');
    expect(closedPoRow).not.toBeNull();
    expect(within(closedPoRow!).getByText('Surat Weaves')).toBeInTheDocument();
    expect(screen.getAllByText('Closed').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Partially received').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Open').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Cancelled').length).toBeGreaterThanOrEqual(2);

    // Paginate to page 1, then change Vendor filter and verify page resets to 0
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(listPurchaseOrders).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'CLOSED', page: 1 }),
        expect.any(AbortSignal),
      );
    });
    await user.selectOptions(screen.getByLabelText('Vendor'), 'v-2');
    await waitFor(() => {
      expect(listPurchaseOrders).toHaveBeenLastCalledWith(
        expect.objectContaining({ vendorId: 'v-2', status: 'CLOSED', page: 0 }),
        expect.any(AbortSignal),
      );
    });

    // Resolve the stale initial response afterwards; it must NOT replace newer results
    await act(async () => {
      resolveSlowInitial({
        items: [
          {
            poId: 'po-stale',
            poNumber: 'PO-STALE',
            vendorId: 'v-1',
            orderDate: '2026-11-01',
            status: 'OPEN',
            totalOpenQuantity: 99,
            version: 0,
          },
        ],
        page: 0,
        size: 25,
        total: 1,
      });
    });

    expect(screen.queryByRole('link', { name: 'PO-STALE' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'PO-0099' })).toBeInTheDocument();

    // Validate From > To date range blocks invalid API fetch
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-11-28' } });
    const callCountAfterFromDate = listPurchaseOrders.mock.calls.length;
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-11-20' } });

    expect(
      await screen.findByText("'From' date must not be after 'To' date."),
    ).toBeInTheDocument();
    expect(listPurchaseOrders).toHaveBeenCalledTimes(callCountAfterFromDate);
    expect(listPurchaseOrders).not.toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-11-28', to: '2026-11-20' }),
      expect.anything(),
    );
  });

  it('creates a PO with inline vendor creation preserving lines, blank vs 0.00 cost, network recovery, and redirects on save', async () => {
    const user = userEvent.setup();
    const expectedToday = getShopLocalDateIso();

    const existingVendors: Vendor[] = [
      { vendorId: 'v-1', name: 'Kanchipuram Looms', contact: '9876543210', active: true },
    ];
    const skus: SkuListItem[] = [
      {
        skuId: 'sku-1',
        productId: 'p-1',
        productName: 'Banarasi Silk Saree',
        size: null,
        skuCode: 'SAR-BAN-100',
        defaultSellingPrice: '4500.00',
        sellableQuantity: 0,
        active: true,
        version: 0,
      },
      {
        skuId: 'sku-2',
        productId: 'p-2',
        productName: 'Cotton Kurti',
        size: 'M',
        skuCode: 'KUR-COT-M',
        defaultSellingPrice: '899.00',
        sellableQuantity: 2,
        active: true,
        version: 0,
      },
    ];

    let attemptCount = 0;
    const createdDetail: PurchaseOrderDetail = {
      poId: 'po-created-1',
      poNumber: 'PO-0042',
      vendorId: 'v-new',
      vendorName: 'Varanasi Silk Co',
      orderDate: expectedToday,
      status: 'OPEN',
      totalOpenQuantity: 15,
      version: 0,
      lines: [
        {
          poLineId: 'l-1',
          skuId: 'sku-1',
          skuCode: 'SAR-BAN-100',
          productName: 'Banarasi Silk Saree',
          size: null,
          orderedQuantity: 12,
          receivedQuantity: 0,
          cancelledQuantity: 0,
          openQuantity: 12,
          agreedUnitCost: null,
        },
        {
          poLineId: 'l-2',
          skuId: 'sku-2',
          skuCode: 'KUR-COT-M',
          productName: 'Cotton Kurti',
          size: 'M',
          orderedQuantity: 3,
          receivedQuantity: 0,
          cancelledQuantity: 0,
          openQuantity: 3,
          agreedUnitCost: '0.00',
        },
      ],
    };

    const listPurchaseOrders = vi.fn(async () => ({
      items: [
        {
          poId: 'po-recent-1',
          poNumber: 'PO-0041',
          vendorId: 'v-new',
          orderDate: expectedToday,
          status: 'OPEN' as const,
          totalOpenQuantity: 5,
          version: 0,
        },
      ],
      page: 0,
      size: 5,
      total: 1,
    }));

    const createPurchaseOrder = vi.fn(async () => {
      attemptCount += 1;
      if (attemptCount === 1) {
        throw new ApiClientError({
          kind: 'network',
          status: 503,
          code: 'NETWORK_ERROR',
          message: 'Connection lost',
          retryable: true,
        });
      }
      return createdDetail;
    });

    const api = makeMockPurchasingApi({
      listVendors: vi.fn(async () => ({
        items: existingVendors,
        page: 0,
        size: 25,
        total: existingVendors.length,
      })),
      createVendor: vi.fn(async ({ name, contact }) => ({
        vendorId: 'v-new',
        name,
        contact: contact ?? null,
        active: true,
      })),
      createPurchaseOrder,
      listPurchaseOrders,
      getPurchaseOrder: vi.fn(async () => createdDetail),
    });

    const catalog = makeMockCatalogApi({
      listSkus: vi.fn(async ({ q }) => {
        const filtered = q
          ? skus.filter(
              (s) =>
                s.productName.toLowerCase().includes(q.toLowerCase()) ||
                s.skuCode.toLowerCase().includes(q.toLowerCase()),
            )
          : skus;
        return { items: filtered, page: 0, size: 10, total: filtered.length };
      }),
    });

    render(
      <MemoryRouter initialEntries={['/purchases/new']}>
        <Routes>
          <Route path="/purchases" element={<PurchasesLayout />}>
            <Route
              path="new"
              element={<CreatePurchaseOrderPage api={api} catalog={catalog} />}
            />
            <Route path=":poId" element={<PurchaseOrderDetailPage api={api} />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByLabelText(/Order date/)).toHaveValue(expectedToday);

    // Select line 1 SKU before adding vendor to verify lines stay preserved after inline vendor creation
    await user.click(screen.getByRole('button', { name: 'Select SKU (line 1)' }));
    const skuDialog = screen.getByRole('dialog');
    const sareeRow = (await within(skuDialog).findByRole('rowheader', { name: 'Banarasi Silk Saree' })).closest('tr');
    await user.click(within(sareeRow!).getByRole('button', { name: 'Select' }));

    const line1Qty = document.getElementById('po-line-qty-1') as HTMLInputElement;
    await user.clear(line1Qty);
    await user.type(line1Qty, '12');

    // Add second line with explicit 0 cost
    await user.click(screen.getByRole('button', { name: '+ Add line' }));
    await user.click(screen.getByRole('button', { name: 'Select SKU (line 2)' }));
    const skuDialog2 = screen.getByRole('dialog');
    const kurtiRow = (await within(skuDialog2).findByRole('rowheader', { name: 'Cotton Kurti' })).closest('tr');
    await user.click(within(kurtiRow!).getByRole('button', { name: 'Select' }));

    const line2Qty = document.getElementById('po-line-qty-2') as HTMLInputElement;
    const line2Cost = document.getElementById('po-line-cost-2') as HTMLInputElement;
    await user.clear(line2Qty);
    await user.type(line2Qty, '3');
    await user.type(line2Cost, '0');

    // Create vendor inline; selects new vendor while keeping both lines intact
    await user.click(screen.getByRole('button', { name: '+ New vendor' }));
    const vendorDialog = screen.getByRole('dialog');
    await user.type(within(vendorDialog).getByLabelText(/Vendor name/), 'Varanasi Silk Co');
    await user.click(within(vendorDialog).getByRole('button', { name: 'Create vendor' }));

    await waitFor(() => {
      expect(screen.getByLabelText(/^Vendor/)).toHaveValue('v-new');
    });
    expect(screen.getByText('Banarasi Silk Saree')).toBeInTheDocument();
    expect(screen.getByText('Cotton Kurti')).toBeInTheDocument();

    // First submit drops with network error -> draft preserved & Check recent POs works
    await user.click(screen.getByRole('button', { name: 'Save purchase order' }));

    expect(
      await screen.findByText(/cannot guarantee safe automatic replay/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check recent POs' }));
    expect(await screen.findByRole('link', { name: 'PO-0041' })).toBeInTheDocument();

    // Resubmit succeeds -> verifies null vs "0.00" and navigates to detail page
    await user.click(screen.getByRole('button', { name: 'Save purchase order' }));

    expect(createPurchaseOrder).toHaveBeenLastCalledWith({
      vendorId: 'v-new',
      orderDate: expectedToday,
      lines: [
        { skuId: 'sku-1', orderedQuantity: 12, agreedUnitCost: null },
        { skuId: 'sku-2', orderedQuantity: 3, agreedUnitCost: '0.00' },
      ],
    });

    expect(await screen.findByRole('heading', { name: 'PO-0042' })).toBeInTheDocument();
    expect(screen.getByText('Varanasi Silk Co')).toBeInTheDocument();
  });

  it('supports selective remainder cancellation, idempotent retry across network errors, and 409 STALE_VERSION review', async () => {
    const user = userEvent.setup();

    let currentPo: PurchaseOrderDetail = {
      poId: 'po-partial-1',
      poNumber: 'PO-0055',
      vendorId: 'v-1',
      vendorName: 'Kanchipuram Looms',
      orderDate: '2026-11-25',
      status: 'PARTIALLY_RECEIVED',
      totalOpenQuantity: 10,
      version: 1,
      lines: [
        {
          poLineId: 'line-a',
          skuId: 'sku-a',
          skuCode: 'SAR-SLK-01',
          productName: 'Silk Saree',
          size: null,
          orderedQuantity: 12,
          receivedQuantity: 6,
          cancelledQuantity: 0,
          openQuantity: 6,
          agreedUnitCost: '1500.00',
        },
        {
          poLineId: 'line-b',
          skuId: 'sku-b',
          skuCode: 'PET-COT-L',
          productName: 'Cotton Petticoat',
          size: 'L',
          orderedQuantity: 4,
          receivedQuantity: 0,
          cancelledQuantity: 0,
          openQuantity: 4,
          agreedUnitCost: null,
        },
      ],
    };

    const capturedKeys: string[] = [];
    let cancelStep = 0;

    const getPurchaseOrder = vi.fn(async () => currentPo);
    const cancelPurchaseOrderRemainder = vi.fn(
      async (_poId: string, input: { expectedVersion: number; reason: string; poLineIds?: string[] }, key: string) => {
        capturedKeys.push(key);
        cancelStep += 1;

        if (cancelStep === 1) {
          throw new ApiClientError({
            kind: 'network',
            status: 503,
            code: 'NETWORK_ERROR',
            message: 'Connection reset',
            retryable: true,
          });
        }

        if (cancelStep === 2) {
          // Simulates another staff member updating the PO concurrently before retry succeeds;
          // wait: here test verifies BOTH network same-key retry AND 409 reload behavior cleanly!
          currentPo = {
            ...currentPo,
            version: 2,
            totalOpenQuantity: 8,
            lines: [
              {
                ...currentPo.lines[0]!,
                receivedQuantity: 8,
                openQuantity: 4,
              },
              currentPo.lines[1]!,
            ],
          };
          throw new ApiClientError({
            kind: 'conflict',
            status: 409,
            code: 'STALE_VERSION',
            message: 'Purchase order version conflict',
            retryable: false,
          });
        }

        currentPo = {
          ...currentPo,
          status: 'CLOSED',
          totalOpenQuantity: 4,
          version: input.expectedVersion + 1,
          lines: [
            {
              ...currentPo.lines[0]!,
              cancelledQuantity: 4,
              openQuantity: 0,
            },
            currentPo.lines[1]!,
          ],
        };
        return currentPo;
      },
    );

    const api = makeMockPurchasingApi({ getPurchaseOrder, cancelPurchaseOrderRemainder });

    render(
      <MemoryRouter initialEntries={['/purchases/po-partial-1']}>
        <Routes>
          <Route path="/purchases" element={<PurchasesLayout />}>
            <Route path=":poId" element={<PurchaseOrderDetailPage api={api} />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'PO-0055' })).toBeInTheDocument();
    expect(screen.getByText('₹1,500.00')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel Remaining Quantity' }));
    const dialog = screen.getByRole('dialog');

    // Verify received quantities stay visible when reviewing open lines
    expect(within(dialog).getByText(/Received: 6/i)).toBeInTheDocument();

    // Select specific open line A
    await user.click(within(dialog).getByRole('radio', { name: 'Select specific open lines' }));
    await user.click(within(dialog).getByRole('checkbox', { name: /Silk Saree/i }));
    await user.type(within(dialog).getByLabelText(/Cancellation reason/), 'Damaged dye lot');

    // Attempt 1 fails with network error
    await user.click(within(dialog).getByRole('button', { name: 'Confirm cancellation' }));
    expect(await within(dialog).findByText(/outcome is unknown/i)).toBeInTheDocument();

    // Attempt 2 sends the EXACT same Idempotency-Key & triggers 409 STALE_VERSION -> reloads version 2 for review
    await user.click(within(dialog).getByRole('button', { name: 'Retry cancellation' }));
    expect(capturedKeys[0]).toBeTruthy();
    expect(capturedKeys[1]).toBe(capturedKeys[0]);

    expect(
      await within(dialog).findByText(/now version 2 with 8 total open units/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Received: 8/i)).toBeInTheDocument();
    expect(cancelPurchaseOrderRemainder).toHaveBeenCalledTimes(2);

    // Confirm again after reviewing latest quantities -> uses updated expectedVersion (2) and fresh Idempotency-Key
    await user.click(within(dialog).getByRole('button', { name: 'Confirm cancellation' }));
    expect(cancelPurchaseOrderRemainder).toHaveBeenCalledTimes(3);
    expect(cancelPurchaseOrderRemainder).toHaveBeenLastCalledWith(
      'po-partial-1',
      {
        expectedVersion: 2,
        reason: 'Damaged dye lot',
        poLineIds: ['line-a'],
      },
      expect.any(String),
    );
    expect(capturedKeys[2]).not.toBe(capturedKeys[0]);

    expect(
      await screen.findByText(/status is now Closed with 4 open unit\(s\)\. Received quantities remain unchanged\./i),
    ).toBeInTheDocument();
  });

  it('allows WORKER role to access Purchases routes in the authenticated layout', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/auth/session') {
        return new Response(
          JSON.stringify({ userId: 'worker-1', name: 'Counter Staff', role: 'WORKER' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.startsWith('/api/v1/vendors') || url.startsWith('/api/v1/purchase-orders')) {
        return new Response(JSON.stringify({ items: [], page: 0, size: 100, total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const client = createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    render(
      <MemoryRouter initialEntries={['/purchases/vendors']}>
        <SessionProvider client={client}>
          <AppRoutes />
        </SessionProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Vendors' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Purchase Orders' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New Purchase Order' })).toBeInTheDocument();
  });
});
