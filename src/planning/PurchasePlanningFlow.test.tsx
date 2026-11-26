import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogApi } from '../catalog/catalogApi.ts';
import { CreatePurchaseOrderPage } from '../purchasing/CreatePurchaseOrderPage.tsx';
import type { PurchasingApi } from '../purchasing/purchasingApi.ts';
import type { Vendor } from '../purchasing/types.ts';
import type { PlanningApi } from './planningApi.ts';
import { PurchasePlanningPage } from './PurchasePlanningPage.tsx';
import type { PurchasePlanningItem, PurchasePlanningResponse } from './types.ts';

function makeMockPlanningApi(overrides: Partial<PlanningApi> = {}): PlanningApi {
  return {
    getPurchasePlanning: vi.fn(async () => ({
      recentSalesFrom: '2026-10-28',
      recentSalesTo: '2026-11-26',
      planningPeriod: null,
      items: [],
      page: 0,
      size: 25,
      total: 0,
    })),
    upsertPurchaseTarget: vi.fn(),
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

function makeMockPurchasingApi(vendors: Vendor[] = [], overrides: Partial<PurchasingApi> = {}): PurchasingApi {
  return {
    listVendors: vi.fn(async () => ({
      items: vendors,
      page: 0,
      size: 25,
      total: vendors.length,
    })),
    listAllVendors: vi.fn(async () => vendors),
    createVendor: vi.fn(),
    listPurchaseOrders: vi.fn(async () => ({ items: [], page: 0, size: 25, total: 0 })),
    getPurchaseOrder: vi.fn(),
    createPurchaseOrder: vi.fn(),
    cancelPurchaseOrderRemainder: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FE08 What to Buy & Purchase Planning', () => {
  it('displays server suggestions, separates unset vs 0 targets, updates targets, and reflects post-receipt and post-cancellation server values', async () => {
    const user = userEvent.setup();

    let items: PurchasePlanningItem[] = [
      {
        skuId: 'sku-main',
        skuCode: 'SAR-SILK-1',
        productName: 'Kanjeevaram Saree',
        size: null,
        currentSellingPrice: '4500.00',
        sellableQuantity: 18,
        openPoQuantity: 6,
        recentSales: 2,
        lastVerifiedCountDate: '2026-11-20',
        pastVendors: [{ vendorId: 'v-a', vendorName: 'Vendor Alpha', active: true }],
        targetQuantity: 30,
        resolvedPlanningPeriod: null,
        suggestedQuantity: 6,
      },
      {
        skuId: 'sku-zero',
        skuCode: 'VST-32',
        productName: 'Cotton Vest',
        size: '32',
        currentSellingPrice: '220.00',
        sellableQuantity: 0,
        openPoQuantity: 0,
        recentSales: 0,
        lastVerifiedCountDate: null,
        pastVendors: [],
        targetQuantity: 0,
        resolvedPlanningPeriod: null,
        suggestedQuantity: 0,
      },
      {
        skuId: 'sku-unset',
        skuCode: 'VST-34',
        productName: 'Cotton Vest',
        size: '34',
        currentSellingPrice: '230.00',
        sellableQuantity: 4,
        openPoQuantity: 0,
        recentSales: 1,
        lastVerifiedCountDate: null,
        pastVendors: [],
        targetQuantity: null,
        resolvedPlanningPeriod: null,
        suggestedQuantity: null,
      },
    ];

    const buildResp = (planningPeriod: string | null = null): PurchasePlanningResponse => ({
      recentSalesFrom: '2026-10-28',
      recentSalesTo: '2026-11-26',
      planningPeriod,
      items: items.map((i) => ({ ...i })),
      page: 0,
      size: 25,
      total: items.length,
    });

    let phase = 0;
    const getPurchasePlanning = vi.fn(async (params) => {
      if (phase === 1) {
        // After receipt of 4 of 6: sellable 22, openPo 2 -> suggested stays 6
        items = items.map((i) =>
          i.skuId === 'sku-main' ? { ...i, sellableQuantity: 22, openPoQuantity: 2, suggestedQuantity: 6 } : i,
        );
      } else if (phase === 2) {
        // After cancelling remaining 2: openPo 0 -> suggested rises to 8
        items = items.map((i) =>
          i.skuId === 'sku-main' ? { ...i, sellableQuantity: 22, openPoQuantity: 0, suggestedQuantity: 8 } : i,
        );
      }
      return buildResp(params.planningPeriod ?? null);
    });

    const upsertPurchaseTarget = vi.fn(async (skuId: string, input) => {
      items = items.map((i) =>
        i.skuId === skuId
          ? {
              ...i,
              targetQuantity: input.targetQuantity,
              resolvedPlanningPeriod: input.planningPeriod ?? null,
              suggestedQuantity: Math.max(0, input.targetQuantity - i.sellableQuantity - i.openPoQuantity),
            }
          : i,
      );
      return {
        skuId,
        targetQuantity: input.targetQuantity,
        planningPeriod: input.planningPeriod ?? null,
      };
    });

    const api = makeMockPlanningApi({ getPurchasePlanning, upsertPurchaseTarget });

    render(
      <MemoryRouter initialEntries={['/what-to-buy']}>
        <PurchasePlanningPage
          api={api}
          catalog={makeMockCatalogApi()}
          purchasing={makeMockPurchasingApi()}
        />
      </MemoryRouter>
    );

    const mainCard = (await screen.findByText('Kanjeevaram Saree')).closest('article')!;
    expect(screen.getByText(/Recent sales period:/i)).toHaveTextContent('2026-10-28 to 2026-11-26');
    expect(mainCard).toHaveTextContent('Suggested Buy6 pcs');
    expect(screen.getByText('No additional stock needed')).toBeInTheDocument();
    expect(screen.getByText('No target set')).toBeInTheDocument();

    // Unset target shows Set Target button while saved 0 shows "Target: 0" + Edit Target
    expect(screen.getByRole('button', { name: 'Set Target' })).toBeInTheDocument();
    const zeroCard = screen.getByText('Cotton Vest — Size 32').closest('article')!;
    expect(zeroCard).toHaveTextContent('Target: 0');
    expect(within(zeroCard).getByRole('button', { name: 'Edit Target' })).toBeInTheDocument();

    // Verify receipt of 4 -> suggestion remains 6
    phase = 1;
    await user.click(screen.getByRole('button', { name: 'Apply Filters' }));
    await waitFor(() => {
      expect(mainCard).toHaveTextContent('22 pcs');
    });
    expect(mainCard).toHaveTextContent('2 pcs');
    expect(mainCard).toHaveTextContent('Suggested Buy6 pcs');

    // Verify cancel remaining 2 -> suggestion becomes 8
    phase = 2;
    await user.click(screen.getByRole('button', { name: 'Apply Filters' }));
    await waitFor(() => {
      expect(mainCard).toHaveTextContent('Suggested Buy8 pcs');
    });

    // Save period target for Cotton Vest 34
    await user.click(screen.getByRole('button', { name: 'Set Target' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Period-specific target' }));
    await user.type(within(dialog).getByLabelText('Planning Period'), 'Diwali');
    await user.type(within(dialog).getByLabelText(/Target Stock Quantity/i), '12');
    await user.click(within(dialog).getByRole('button', { name: 'Save Target' }));

    await waitFor(() => {
      expect(upsertPurchaseTarget).toHaveBeenCalledWith('sku-unset', {
        targetQuantity: 12,
        planningPeriod: 'Diwali',
      });
    });

    const updatedUnsetCard = screen.getByText('Cotton Vest — Size 34').closest('article')!;
    await waitFor(() => {
      expect(updatedUnsetCard).toHaveTextContent('Target: 12');
    });
  });

  it('prepares a Purchase Order draft with selected SKUs, sizes, and vendor without auto-submitting PO', async () => {
    const user = userEvent.setup();
    const vendors: Vendor[] = [
      { vendorId: 'v-a', name: 'Vendor Alpha', contact: '9876543210', active: true },
    ];
    const createPurchaseOrder = vi.fn();

    const planningResp: PurchasePlanningResponse = {
      recentSalesFrom: '2026-10-28',
      recentSalesTo: '2026-11-26',
      planningPeriod: null,
      items: [
        {
          skuId: 'sku-m',
          skuCode: 'KRT-M',
          productName: 'Cotton Kurti',
          size: 'M',
          currentSellingPrice: '899.00',
          sellableQuantity: 3,
          openPoQuantity: 0,
          recentSales: 7,
          lastVerifiedCountDate: '2026-11-24',
          pastVendors: [{ vendorId: 'v-a', vendorName: 'Vendor Alpha', active: true }],
          targetQuantity: 10,
          resolvedPlanningPeriod: null,
          suggestedQuantity: 7,
        },
        {
          skuId: 'sku-l',
          skuCode: 'KRT-L',
          productName: 'Cotton Kurti',
          size: 'L',
          currentSellingPrice: '899.00',
          sellableQuantity: 1,
          openPoQuantity: 0,
          recentSales: 5,
          lastVerifiedCountDate: null,
          pastVendors: [{ vendorId: 'v-a', vendorName: 'Vendor Alpha', active: true }],
          targetQuantity: 8,
          resolvedPlanningPeriod: null,
          suggestedQuantity: 7,
        },
      ],
      page: 0,
      size: 25,
      total: 2,
    };

    const purchasing = makeMockPurchasingApi(vendors, { createPurchaseOrder });

    render(
      <MemoryRouter initialEntries={['/what-to-buy']}>
        <Routes>
          <Route
            path="/what-to-buy"
            element={
              <PurchasePlanningPage
                api={makeMockPlanningApi({ getPurchasePlanning: vi.fn(async () => planningResp) })}
                catalog={makeMockCatalogApi()}
                purchasing={purchasing}
              />
            }
          />
          <Route
            path="/purchases/new"
            element={
              <CreatePurchaseOrderPage api={purchasing} catalog={makeMockCatalogApi()} />
            }
          />
        </Routes>
      </MemoryRouter>
    );

    const checkboxM = await screen.findByLabelText(/Select Cotton Kurti size M \(KRT-M\)/i);
    const checkboxL = screen.getByLabelText(/Select Cotton Kurti size L \(KRT-L\)/i);
    await user.click(checkboxM);
    await user.click(checkboxL);

    // Edit buying quantity for size M cleanly
    const buyQtyInput = screen.getByLabelText(
      /Buying quantity for Cotton Kurti size M \(KRT-M\)/i,
    );
    await user.clear(buyQtyInput);
    await user.type(buyQtyInput, '10');

    await user.selectOptions(
      screen.getByLabelText(/Vendor for Draft Purchase Order/i),
      'v-a',
    );
    await user.click(screen.getByRole('button', { name: 'Prepare Purchase Order' }));

    // Opens FE03 Create Purchase Order screen with prefilled SKUs, sizes, quantities, and vendor — NO auto POST!
    expect(await screen.findByRole('heading', { name: 'New Purchase Order' })).toBeInTheDocument();
    expect(
      screen.getByText((_, node) =>
        node?.tagName === 'P' &&
        /Loaded 2 SKU lines from What to Buy\./i.test(node.textContent ?? ''),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('KRT-M')).toBeInTheDocument();
    expect(screen.getByText('KRT-L')).toBeInTheDocument();
    expect((screen.getByRole('combobox', { name: /Vendor/i }) as HTMLSelectElement).value).toBe(
      'v-a',
    );
    expect(createPurchaseOrder).not.toHaveBeenCalled();
  });
});
