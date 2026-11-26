import type { ActiveStatusFilter } from '../catalog/types.ts';

export type PurchaseOrderStatus =
  | 'OPEN'
  | 'PARTIALLY_RECEIVED'
  | 'CLOSED'
  | 'CANCELLED';

export interface Vendor {
  vendorId: string;
  name: string;
  contact: string | null;
  active: boolean;
}

export interface CreateVendorInput {
  name: string;
  contact?: string | null;
}

export interface VendorSearchParams {
  q?: string;
  status: ActiveStatusFilter;
  page: number;
  size: number;
}

export interface PurchaseOrderPrefillState {
  vendorId?: string | null;
  vendorRecord?: Vendor | null;
  lines: Array<{
    sku: import('../catalog/types.ts').SkuListItem;
    orderedQuantity: number;
  }>;
}

export interface PurchaseOrderListItem {
  poId: string;
  poNumber: string;
  vendorId: string;
  orderDate: string;
  status: PurchaseOrderStatus;
  totalOpenQuantity: number;
  version: number;
}

export interface PurchaseOrderSearchParams {
  vendorId?: string | null;
  status?: PurchaseOrderStatus | '';
  from?: string;
  to?: string;
  page: number;
  size: number;
}

export interface PurchaseOrderLine {
  poLineId: string;
  skuId: string;
  skuCode: string;
  productName: string;
  size: string | null;
  orderedQuantity: number;
  receivedQuantity: number;
  cancelledQuantity: number;
  openQuantity: number;
  agreedUnitCost: string | null;
}

export interface PurchaseOrderDetail {
  poId: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  orderDate: string;
  status: PurchaseOrderStatus;
  totalOpenQuantity: number;
  version: number;
  lines: PurchaseOrderLine[];
}

export interface CreatePurchaseOrderLineInput {
  skuId: string;
  orderedQuantity: number;
  agreedUnitCost?: string | null;
}

export interface CreatePurchaseOrderInput {
  vendorId: string;
  orderDate: string;
  lines: CreatePurchaseOrderLineInput[];
}

export interface CancelPurchaseOrderRemainderInput {
  expectedVersion: number;
  reason: string;
  poLineIds?: string[];
}
