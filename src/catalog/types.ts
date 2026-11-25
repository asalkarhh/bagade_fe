export interface PagedResponse<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

export interface Category {
  categoryId: string;
  name: string;
  parentId: string | null;
}

export interface CategoryOption {
  categoryId: string;
  name: string;
  parentId: string | null;
  label: string;
  depth: number;
}

export interface CreateCategoryInput {
  name: string;
  parentId: string | null;
}

export interface CreateProductInput {
  categoryId: string;
  name: string;
  brand?: string | null;
  design?: string | null;
}

export interface ProductResponse {
  productId: string;
  categoryId: string;
  name: string;
}

export interface CreateSkuInput {
  skuCode: string;
  size?: string | null;
  defaultSellingPrice: string;
}

export interface CreateSkuResponse {
  skuId: string;
  skuCode: string;
  size: string | null;
  defaultSellingPrice: string;
  version: number;
}

export interface SkuListItem {
  skuId: string;
  productId: string | null;
  productName: string;
  size: string | null;
  skuCode: string;
  defaultSellingPrice: string;
  sellableQuantity: number;
  active: boolean;
  version: number;
}

export interface SkuDetail {
  skuId: string;
  productId: string;
  productName: string;
  skuCode: string;
  size: string | null;
  defaultSellingPrice: string;
  sellableQuantity: number;
  active: boolean;
  version: number;
}

export interface UpdateSkuInput {
  expectedVersion: number;
  defaultSellingPrice?: string;
  active?: boolean;
}

export type ActiveStatusFilter = 'ACTIVE' | 'INACTIVE' | 'ALL';

export interface SkuSearchParams {
  q?: string;
  categoryId?: string | null;
  status: ActiveStatusFilter;
  page: number;
  size: number;
}
