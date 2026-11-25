import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../api/client.ts';
import { createCatalogApi } from './catalogApi.ts';
import { buildCategoryOptions } from './categoryUtils.ts';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('catalogApi and categoryUtils', () => {
  it('paginates across all category pages and builds hierarchical labels', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('page=0')) {
        return jsonResponse({
          items: [
            { categoryId: 'cat-sarees', name: 'Sarees', parentId: null },
            { categoryId: 'cat-innerwear', name: 'Innerwear', parentId: null },
          ],
          page: 0,
          size: 2,
          total: 3,
        });
      }
      if (url.includes('page=1')) {
        return jsonResponse({
          items: [{ categoryId: 'cat-silk', name: 'Silk Sarees', parentId: 'cat-sarees' }],
          page: 1,
          size: 2,
          total: 3,
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const client = createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch });
    const api = createCatalogApi(client);

    const categories = await api.listAllCategories();
    expect(categories).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const options = buildCategoryOptions(categories);
    expect(options.map((o) => o.label)).toEqual([
      'Innerwear',
      'Sarees',
      'Sarees → Silk Sarees',
    ]);
  });

  it('normalizes blank size to null on SKU creation and merges active/inactive results for ALL filter', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/v1/auth/csrf') {
        return jsonResponse({ csrfToken: 'csrf-1' });
      }
      if (url === '/api/v1/products/prod-1/skus' && init?.method === 'POST') {
        const parsed = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(parsed).toEqual({
          skuCode: 'SAR-001',
          size: null,
          defaultSellingPrice: '4500.00',
        });
        return jsonResponse(
          {
            skuId: 'sku-1',
            skuCode: 'SAR-001',
            size: null,
            defaultSellingPrice: '4500.00',
            version: 0,
          },
          201,
        );
      }
      if (url.includes('/api/v1/skus') && url.includes('active=true')) {
        return jsonResponse({
          items: [
            {
              skuId: 'sku-2',
              productName: 'Linen Shirt',
              size: 'M',
              skuCode: 'SH-M',
              defaultSellingPrice: '1299.00',
              sellableQuantity: 5,
              active: true,
              version: 0,
            },
          ],
          page: 0,
          size: 100,
          total: 1,
        });
      }
      if (url.includes('/api/v1/skus') && url.includes('active=false')) {
        return jsonResponse({
          items: [
            {
              skuId: 'sku-1',
              productId: 'prod-1',
              productName: 'Banarasi Saree',
              size: null,
              skuCode: 'SAR-001',
              defaultSellingPrice: '4500.00',
              sellableQuantity: 2,
              active: false,
              version: 1,
            },
          ],
          page: 0,
          size: 100,
          total: 1,
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const client = createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch });
    const api = createCatalogApi(client);

    await api.createSku('prod-1', {
      skuCode: ' SAR-001 ',
      size: '   ',
      defaultSellingPrice: '4500.00',
    });

    const allPage = await api.listSkus({ status: 'ALL', page: 0, size: 25 });
    expect(allPage.total).toBe(2);
    expect(allPage.items.map((item) => item.skuCode)).toEqual(['SAR-001', 'SH-M']);
    // Preserves productId only when returned by backend, never inferred
    expect(allPage.items[0].productId).toBe('prod-1');
    expect(allPage.items[1].productId).toBeNull();
  });
});
