import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../api/errors.ts';
import type { CatalogApi } from './catalogApi.ts';
import { ProductsPage } from './ProductsPage.tsx';
import type { Category, PagedResponse, SkuListItem } from './types.ts';

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

describe('ProductsPage', () => {
  it('renders SKU table rows with em dash for unsized SKUs, INR prices, sellable quantity, and handles empty/error/no-match states', async () => {
    const user = userEvent.setup();
    let failFirst = true;

    const categories: Category[] = [
      { categoryId: 'cat-sarees', name: 'Sarees', parentId: null },
      { categoryId: 'cat-silk', name: 'Silk Sarees', parentId: 'cat-sarees' },
    ];

    const skus: SkuListItem[] = [
      {
        skuId: 'sku-saree',
        productId: 'prod-saree',
        productName: 'Kanchipuram Silk',
        size: null,
        skuCode: 'SAR-KAN-001',
        defaultSellingPrice: '4500.00',
        sellableQuantity: 7,
        active: true,
        version: 0,
      },
    ];

    const api = makeMockCatalogApi({
      listAllCategories: vi.fn(async () => categories),
      listSkus: vi.fn(async ({ q }) => {
        if (failFirst) {
          failFirst = false;
          throw new ApiClientError({
            kind: 'network',
            status: 503,
            code: 'BACKEND_UNAVAILABLE',
            message: 'Backend unavailable',
            retryable: true,
          });
        }
        if (q === 'nomatch') {
          return { items: [], page: 0, size: 25, total: 0 };
        }
        return { items: skus, page: 0, size: 25, total: 1 };
      }),
    });

    render(<ProductsPage api={api} />);

    // Retryable error state
    expect(await screen.findByText('Backend unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    // Loaded catalog row
    const row = (await screen.findByRole('rowheader', { name: 'Kanchipuram Silk' })).closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('SAR-KAN-001')).toBeInTheDocument();
    expect(within(row!).getByText('—')).toBeInTheDocument();
    expect(within(row!).getByText('₹4,500.00')).toBeInTheDocument();
    expect(within(row!).getByText('7')).toBeInTheDocument();
    expect(within(row!).getByText('Active')).toBeInTheDocument();

    // Category selector displays parent -> child hierarchy
    const categorySelect = screen.getByLabelText('Category');
    expect(within(categorySelect).getByRole('option', { name: 'Sarees → Silk Sarees' })).toBeInTheDocument();

    // No matching results + Reset filters
    await user.type(screen.getByLabelText(/Search product, SKU code, or size/), 'nomatch{Enter}');
    expect(
      await screen.findByText(/No SKUs match the current search, category, or status filters/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(await screen.findByRole('rowheader', { name: 'Kanchipuram Silk' })).toBeInTheDocument();
  });

  it('prevents slower earlier search responses from overwriting newer search results and resets page on filter change', async () => {
    const user = userEvent.setup();
    let resolveSlow!: (res: PagedResponse<SkuListItem>) => void;
    let callCount = 0;

    const api = makeMockCatalogApi({
      listSkus: vi.fn(async ({ q, page }) => {
        callCount += 1;
        if (callCount === 1) {
          return {
            items: [
              {
                skuId: 'sku-init',
                productId: null,
                productName: 'Initial Item',
                size: 'M',
                skuCode: 'INIT-1',
                defaultSellingPrice: '500.00',
                sellableQuantity: 2,
                active: true,
                version: 0,
              },
            ],
            page: 0,
            size: 25,
            total: 30,
          };
        }
        if (page === 1 && !q) {
          return new Promise<PagedResponse<SkuListItem>>((resolve) => {
            resolveSlow = resolve;
          });
        }
        return {
          items: [
            {
              skuId: 'sku-fast',
              productId: null,
              productName: 'New Search Item',
              size: '34',
              skuCode: 'FAST-34',
              defaultSellingPrice: '250.00',
              sellableQuantity: 4,
              active: true,
              version: 0,
            },
          ],
          page: 0,
          size: 25,
          total: 1,
        };
      }),
    });

    render(<ProductsPage api={api} />);
    expect(await screen.findByRole('rowheader', { name: 'Initial Item' })).toBeInTheDocument();

    // Advance to page 2 (triggers slow request)
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(/Page 2 of 2/)).toBeInTheDocument();

    // Change filter -> resets to page 1 (index 0) and resolves faster
    await user.click(screen.getByRole('radio', { name: 'Inactive' }));
    expect(await screen.findByRole('rowheader', { name: 'New Search Item' })).toBeInTheDocument();

    // Resolve earlier slow page-2 request -> must be ignored
    await act(async () => {
      resolveSlow({
        items: [
          {
            skuId: 'sku-stale',
            productId: null,
            productName: 'Stale Page 2 Item',
            size: 'L',
            skuCode: 'STALE-2',
            defaultSellingPrice: '999.00',
            sellableQuantity: 1,
            active: true,
            version: 0,
          },
        ],
        page: 1,
        size: 25,
        total: 30,
      });
    });

    expect(screen.queryByRole('rowheader', { name: 'Stale Page 2 Item' })).not.toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'New Search Item' })).toBeInTheDocument();
  });

  it('supports creating Sarees -> Silk Sarees, unsized saree product, retrying failed SKU without re-creating product, and adding multiple sizes', async () => {
    const user = userEvent.setup();
    const categories: Category[] = [];
    const skuRows: SkuListItem[] = [];
    let failNextSku = true;

    const api = makeMockCatalogApi({
      listAllCategories: vi.fn(async () => [...categories]),
      createCategory: vi.fn(async ({ name, parentId }) => {
        const created: Category = {
          categoryId: name === 'Sarees' ? 'cat-sarees' : 'cat-silk',
          name,
          parentId,
        };
        categories.push(created);
        return created;
      }),
      createProduct: vi.fn(async ({ categoryId, name }) => ({
        productId: name.includes('Vest') ? 'prod-vest' : 'prod-saree',
        categoryId,
        name,
      })),
      createSku: vi.fn(async (productId, input) => {
        if (failNextSku) {
          failNextSku = false;
          throw new ApiClientError({
            kind: 'conflict',
            status: 409,
            code: 'DUPLICATE_SKU',
            message: 'A SKU with this code or product-and-size combination already exists',
            requestId: 'req-dup',
          });
        }
        const sku: SkuListItem = {
          skuId: `sku-${skuRows.length + 1}`,
          productId,
          productName: productId === 'prod-vest' ? 'Cotton Vest' : 'Bridal Silk Saree',
          size: input.size ?? null,
          skuCode: input.skuCode,
          defaultSellingPrice: input.defaultSellingPrice,
          sellableQuantity: 0,
          active: true,
          version: 0,
        };
        skuRows.push(sku);
        return {
          skuId: sku.skuId,
          skuCode: sku.skuCode,
          size: sku.size,
          defaultSellingPrice: sku.defaultSellingPrice,
          version: 0,
        };
      }),
      listSkus: vi.fn(async () => ({
        items: [...skuRows],
        page: 0,
        size: 25,
        total: skuRows.length,
      })),
    });

    render(<ProductsPage api={api} />);
    await screen.findByText(/No active SKUs in the catalog yet/i);

    // 1. Create parent category "Sarees"
    await user.click(screen.getByRole('button', { name: 'New category' }));
    const dialog1 = screen.getByRole('dialog');
    await user.type(within(dialog1).getByLabelText(/Category name/), 'Sarees');
    await user.click(within(dialog1).getByRole('button', { name: 'Create category' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // 2. Create child category "Silk Sarees" under "Sarees"
    await user.click(screen.getByRole('button', { name: 'New category' }));
    const dialog2 = screen.getByRole('dialog');
    await user.type(within(dialog2).getByLabelText(/Category name/), 'Silk Sarees');
    await user.selectOptions(within(dialog2).getByLabelText(/Parent category/), 'cat-sarees');
    await user.click(within(dialog2).getByRole('button', { name: 'Create category' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // 3. Create Silk Saree product -> pre-selected "Sarees -> Silk Sarees", failed SKU retains productId + inputs
    await user.click(screen.getByRole('button', { name: 'New product' }));
    const prodDialog = screen.getByRole('dialog');
    expect(within(prodDialog).getByLabelText(/^Category/)).toHaveValue('cat-silk');
    await user.type(within(prodDialog).getByLabelText(/Product name/), 'Bridal Silk Saree');
    await user.click(within(prodDialog).getByRole('button', { name: 'Save product & add SKU' }));

    expect(api.createProduct).toHaveBeenCalledTimes(1);

    // First SKU attempt fails -> values and productId must be preserved for retry
    await user.type(within(prodDialog).getByLabelText(/SKU code/), 'SAR-DUP');
    await user.type(within(prodDialog).getByLabelText(/Default selling price/), '4500');
    await user.click(within(prodDialog).getByRole('button', { name: 'Save SKU' }));

    expect(
      await within(prodDialog).findByText(/An unsized SKU already exists for this product/i),
    ).toBeInTheDocument();
    expect(within(prodDialog).getByLabelText(/SKU code/)).toHaveValue('SAR-DUP');
    expect(within(prodDialog).getByLabelText(/Default selling price/)).toHaveValue('4500');

    // Fix SKU code and retry -> does NOT call createProduct a second time
    await user.clear(within(prodDialog).getByLabelText(/SKU code/));
    await user.type(within(prodDialog).getByLabelText(/SKU code/), 'SAR-KAN-001');
    await user.click(within(prodDialog).getByRole('button', { name: 'Save SKU' }));

    expect(api.createProduct).toHaveBeenCalledTimes(1);
    expect(await within(prodDialog).findByText(/Saved SKU SAR-KAN-001 \(unsized\)/i)).toBeInTheDocument();
    await user.click(within(prodDialog).getByRole('button', { name: 'Done' }));

    // 4. Create sized product (32 & 34) and then add size 36 from catalog row using productId
    await user.click(screen.getByRole('button', { name: 'New product' }));
    const vestDialog = screen.getByRole('dialog');
    await user.type(within(vestDialog).getByLabelText(/Product name/), 'Cotton Vest');
    await user.click(within(vestDialog).getByRole('button', { name: 'Save product & add SKU' }));

    await user.type(within(vestDialog).getByLabelText(/SKU code/), 'VES-32');
    await user.type(within(vestDialog).getByLabelText(/^Size/), '32');
    await user.type(within(vestDialog).getByLabelText(/Default selling price/), '199.5');
    await user.click(within(vestDialog).getByRole('button', { name: 'Save SKU' }));
    expect(await within(vestDialog).findByText(/Saved SKU VES-32 \(size 32\)/i)).toBeInTheDocument();

    await user.type(within(vestDialog).getByLabelText(/SKU code/), 'VES-34');
    await user.type(within(vestDialog).getByLabelText(/^Size/), '34');
    await user.type(within(vestDialog).getByLabelText(/Default selling price/), '210');
    await user.click(within(vestDialog).getByRole('button', { name: 'Save another SKU' }));
    expect(await within(vestDialog).findByText(/Saved SKU VES-34 \(size 34\)/i)).toBeInTheDocument();
    await user.click(within(vestDialog).getByRole('button', { name: 'Done' }));

    // Click "Add size" on the VES-32 catalog row to add size 36
    const vesRow = (await screen.findByText('VES-32')).closest('tr');
    await user.click(within(vesRow!).getByRole('button', { name: 'Add size' }));
    const addSizeDialog = screen.getByRole('dialog');
    await user.type(within(addSizeDialog).getByLabelText(/SKU code/), 'VES-36');
    await user.type(within(addSizeDialog).getByLabelText(/^Size/), '36');
    await user.type(within(addSizeDialog).getByLabelText(/Default selling price/), '220');
    await user.click(within(addSizeDialog).getByRole('button', { name: 'Save SKU' }));
    expect(await within(addSizeDialog).findByText(/Saved SKU VES-36 \(size 36\)/i)).toBeInTheDocument();
  });

  it('handles SKU price updates, 409 STALE_VERSION review without auto-overwrite, and deactivation across Active/Inactive/All filters', async () => {
    const user = userEvent.setup();
    let currentSku: SkuListItem = {
      skuId: 'sku-shirt',
      productId: null,
      productName: 'Linen Shirt',
      size: 'L',
      skuCode: 'SH-LIN-L',
      defaultSellingPrice: '1499.00',
      sellableQuantity: 5,
      active: true,
      version: 0,
    };
    let simulateStaleConflict = true;

    const api = makeMockCatalogApi({
      listSkus: vi.fn(async ({ status }) => {
        if (status === 'ACTIVE' && !currentSku.active) {
          return { items: [], page: 0, size: 25, total: 0 };
        }
        if (status === 'INACTIVE' && currentSku.active) {
          return { items: [], page: 0, size: 25, total: 0 };
        }
        return { items: [{ ...currentSku }], page: 0, size: 25, total: 1 };
      }),
      updateSku: vi.fn(async (_skuId, input) => {
        if (simulateStaleConflict && input.expectedVersion === 0) {
          simulateStaleConflict = false;
          currentSku = { ...currentSku, defaultSellingPrice: '1549.00', version: 1 };
          throw new ApiClientError({
            kind: 'conflict',
            status: 409,
            code: 'STALE_VERSION',
            message: 'Resource was modified by another request',
            requestId: 'req-stale',
          });
        }
        currentSku = {
          ...currentSku,
          defaultSellingPrice: input.defaultSellingPrice ?? currentSku.defaultSellingPrice,
          active: input.active ?? currentSku.active,
          version: currentSku.version + 1,
        };
        return {
          skuId: currentSku.skuId,
          productId: 'prod-shirt',
          productName: currentSku.productName,
          skuCode: currentSku.skuCode,
          size: currentSku.size,
          defaultSellingPrice: currentSku.defaultSellingPrice,
          sellableQuantity: currentSku.sellableQuantity,
          active: currentSku.active,
          version: currentSku.version,
        };
      }),
      findLatestSkuById: vi.fn(async () => ({ ...currentSku })),
    });

    render(<ProductsPage api={api} />);
    const row = (await screen.findByRole('rowheader', { name: 'Linen Shirt' })).closest('tr');
    // Without productId in GET /skus, Add size stays disabled instead of guessing by name
    expect(within(row!).getByRole('button', { name: 'Add size' })).toBeDisabled();

    // Edit price -> hits 409 STALE_VERSION -> retains attempted edit and asks for review
    await user.click(within(row!).getByRole('button', { name: 'Edit price' }));
    const dialog = screen.getByRole('dialog');
    const priceInput = within(dialog).getByLabelText(/New selling price/);
    await user.clear(priceInput);
    await user.type(priceInput, '1599.50');
    await user.click(within(dialog).getByRole('button', { name: 'Save price' }));

    expect(
      await within(dialog).findByText(/This SKU was updated elsewhere before your save/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/New selling price/)).toHaveValue('1599.50');
    expect(within(dialog).getAllByText('₹1,549.00').length).toBeGreaterThanOrEqual(1);

    // Explicitly resubmit with reviewed version 1
    await user.click(within(dialog).getByRole('button', { name: 'Submit update again' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('₹1,599.50')).toBeInTheDocument();

    // Deactivate -> disappears from Active, visible in Inactive and All
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(
      await screen.findByText(/No active SKUs in the catalog yet/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Inactive' }));
    expect(await screen.findByRole('rowheader', { name: 'Linen Shirt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate' })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'All' }));
    expect(await screen.findByRole('rowheader', { name: 'Linen Shirt' })).toBeInTheDocument();
  });
});
