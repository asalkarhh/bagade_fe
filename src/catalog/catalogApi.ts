import { apiClient, type ApiClient } from '../api/client.ts';
import type {
  Category,
  CreateCategoryInput,
  CreateProductInput,
  CreateSkuInput,
  CreateSkuResponse,
  PagedResponse,
  ProductResponse,
  SkuDetail,
  SkuListItem,
  SkuSearchParams,
  UpdateSkuInput,
} from './types.ts';

const MAX_PAGE_SIZE = 100;
const MAX_ALL_PAGES = 20;

interface RawSkuListItem {
  skuId: string;
  productId?: string | null;
  productName: string;
  size: string | null;
  skuCode: string;
  defaultSellingPrice: string;
  sellableQuantity: number;
  active: boolean;
  version: number;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapSkuListItem(raw: RawSkuListItem): SkuListItem {
  return {
    skuId: raw.skuId,
    productId: typeof raw.productId === 'string' && raw.productId.length > 0 ? raw.productId : null,
    productName: raw.productName,
    size: normalizeOptionalText(raw.size),
    skuCode: raw.skuCode,
    defaultSellingPrice: raw.defaultSellingPrice,
    sellableQuantity: raw.sellableQuantity,
    active: raw.active,
    version: raw.version,
  };
}

function compareSkuItems(a: SkuListItem, b: SkuListItem): number {
  return (
    a.productName.localeCompare(b.productName, undefined, { sensitivity: 'base' }) ||
    a.skuCode.localeCompare(b.skuCode, undefined, { sensitivity: 'base' }) ||
    a.skuId.localeCompare(b.skuId)
  );
}

export interface CatalogApi {
  listAllCategories(signal?: AbortSignal): Promise<Category[]>;
  createCategory(input: CreateCategoryInput): Promise<Category>;
  createProduct(input: CreateProductInput): Promise<ProductResponse>;
  createSku(productId: string, input: CreateSkuInput): Promise<CreateSkuResponse>;
  listSkus(params: SkuSearchParams, signal?: AbortSignal): Promise<PagedResponse<SkuListItem>>;
  updateSku(skuId: string, input: UpdateSkuInput): Promise<SkuDetail>;
  findLatestSkuById(skuId: string, skuCode: string, signal?: AbortSignal): Promise<SkuListItem | null>;
}

export function createCatalogApi(client: ApiClient = apiClient): CatalogApi {
  async function fetchCategoryPage(
    page: number,
    size: number,
    signal?: AbortSignal,
  ): Promise<PagedResponse<Category>> {
    return client.get<PagedResponse<Category>>('/categories', {
      query: { page, size },
      signal,
    });
  }

  async function fetchSkuPage(
    params: {
      q?: string;
      categoryId?: string | null;
      active: boolean;
      page: number;
      size: number;
    },
    signal?: AbortSignal,
  ): Promise<PagedResponse<SkuListItem>> {
    const trimmedQ = params.q?.trim();
    const raw = await client.get<PagedResponse<RawSkuListItem>>('/skus', {
      query: {
        q: trimmedQ || undefined,
        categoryId: params.categoryId || undefined,
        active: params.active,
        page: params.page,
        size: params.size,
      },
      signal,
    });

    return {
      items: raw.items.map(mapSkuListItem),
      page: raw.page,
      size: raw.size,
      total: raw.total,
    };
  }

  async function fetchAllByActiveFlag(
    params: { q?: string; categoryId?: string | null; active: boolean },
    signal?: AbortSignal,
  ): Promise<{ items: SkuListItem[]; total: number }> {
    const firstPage = await fetchSkuPage(
      {
        q: params.q,
        categoryId: params.categoryId,
        active: params.active,
        page: 0,
        size: MAX_PAGE_SIZE,
      },
      signal,
    );

    const collected = [...firstPage.items];
    const totalPages = Math.min(
      Math.ceil(firstPage.total / MAX_PAGE_SIZE),
      MAX_ALL_PAGES,
    );

    for (let page = 1; page < totalPages; page += 1) {
      const next = await fetchSkuPage(
        {
          q: params.q,
          categoryId: params.categoryId,
          active: params.active,
          page,
          size: MAX_PAGE_SIZE,
        },
        signal,
      );
      collected.push(...next.items);
    }

    return { items: collected, total: firstPage.total };
  }

  return {
    async listAllCategories(signal?: AbortSignal): Promise<Category[]> {
      const firstPage = await fetchCategoryPage(0, MAX_PAGE_SIZE, signal);
      const all = [...firstPage.items];
      const totalPages = Math.ceil(firstPage.total / Math.max(firstPage.size, 1));

      for (let page = 1; page < totalPages; page += 1) {
        const nextPage = await fetchCategoryPage(page, MAX_PAGE_SIZE, signal);
        if (nextPage.items.length === 0) {
          break;
        }
        all.push(...nextPage.items);
      }

      return all;
    },

    async createCategory(input: CreateCategoryInput): Promise<Category> {
      return client.post<Category>('/categories', {
        name: input.name.trim(),
        parentId: input.parentId || null,
      });
    },

    async createProduct(input: CreateProductInput): Promise<ProductResponse> {
      return client.post<ProductResponse>('/products', {
        categoryId: input.categoryId,
        name: input.name.trim(),
        brand: normalizeOptionalText(input.brand),
        design: normalizeOptionalText(input.design),
      });
    },

    async createSku(productId: string, input: CreateSkuInput): Promise<CreateSkuResponse> {
      return client.post<CreateSkuResponse>(`/products/${encodeURIComponent(productId)}/skus`, {
        skuCode: input.skuCode.trim(),
        size: normalizeOptionalText(input.size),
        defaultSellingPrice: input.defaultSellingPrice.trim(),
      });
    },

    async listSkus(
      params: SkuSearchParams,
      signal?: AbortSignal,
    ): Promise<PagedResponse<SkuListItem>> {
      if (params.status === 'ACTIVE') {
        return fetchSkuPage(
          {
            q: params.q,
            categoryId: params.categoryId,
            active: true,
            page: params.page,
            size: params.size,
          },
          signal,
        );
      }

      if (params.status === 'INACTIVE') {
        return fetchSkuPage(
          {
            q: params.q,
            categoryId: params.categoryId,
            active: false,
            page: params.page,
            size: params.size,
          },
          signal,
        );
      }

      // Backend GET /api/v1/skus defaults omitted `active` to true and has no native
      // `all` filter parameter, so merge active and inactive results cleanly.
      const [activeResult, inactiveResult] = await Promise.all([
        fetchAllByActiveFlag({ q: params.q, categoryId: params.categoryId, active: true }, signal),
        fetchAllByActiveFlag({ q: params.q, categoryId: params.categoryId, active: false }, signal),
      ]);

      const merged = [...activeResult.items, ...inactiveResult.items].sort(compareSkuItems);
      const start = params.page * params.size;
      const sliced = merged.slice(start, start + params.size);

      return {
        items: sliced,
        page: params.page,
        size: params.size,
        total: activeResult.total + inactiveResult.total,
      };
    },

    async updateSku(skuId: string, input: UpdateSkuInput): Promise<SkuDetail> {
      const payload: Record<string, unknown> = {
        expectedVersion: input.expectedVersion,
      };
      if (input.defaultSellingPrice !== undefined) {
        payload.defaultSellingPrice = input.defaultSellingPrice.trim();
      }
      if (input.active !== undefined) {
        payload.active = input.active;
      }

      return client.patch<SkuDetail>(`/skus/${encodeURIComponent(skuId)}`, payload);
    },

    async findLatestSkuById(
      skuId: string,
      skuCode: string,
      signal?: AbortSignal,
    ): Promise<SkuListItem | null> {
      const [activeMatches, inactiveMatches] = await Promise.all([
        fetchSkuPage({ q: skuCode, active: true, page: 0, size: MAX_PAGE_SIZE }, signal),
        fetchSkuPage({ q: skuCode, active: false, page: 0, size: MAX_PAGE_SIZE }, signal),
      ]);

      return (
        activeMatches.items.find((item) => item.skuId === skuId) ??
        inactiveMatches.items.find((item) => item.skuId === skuId) ??
        null
      );
    },
  };
}

export const catalogApi = createCatalogApi();
