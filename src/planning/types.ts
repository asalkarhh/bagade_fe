export interface PastVendorRef {
  vendorId: string;
  vendorName: string;
  active: boolean;
}

export interface PurchasePlanningItem {
  skuId: string;
  skuCode: string;
  productName: string;
  size: string | null;
  currentSellingPrice: string;
  sellableQuantity: number;
  openPoQuantity: number;
  recentSales: number;
  lastVerifiedCountDate: string | null;
  pastVendors: PastVendorRef[];
  targetQuantity: number | null;
  resolvedPlanningPeriod: string | null;
  suggestedQuantity: number | null;
}

export interface PurchasePlanningResponse {
  recentSalesFrom: string;
  recentSalesTo: string;
  planningPeriod: string | null;
  items: PurchasePlanningItem[];
  page: number;
  size: number;
  total: number;
}

export interface PurchasePlanningParams {
  categoryId?: string | null;
  size?: string;
  minPrice?: string;
  maxPrice?: string;
  vendorId?: string | null;
  planningPeriod?: string;
  page: number;
  pageSize: number;
}

export interface UpsertPurchaseTargetInput {
  targetQuantity: number;
  planningPeriod?: string | null;
}

export interface PurchaseTargetResult {
  skuId: string;
  targetQuantity: number;
  planningPeriod: string | null;
}
