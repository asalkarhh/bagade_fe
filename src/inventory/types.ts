import type { PurchaseOrderStatus } from '../purchasing/types.ts';

export type BarcodeSourceType = 'BRAND' | 'INTERNAL';

export interface CreateStockReceiptLineInput {
  skuId: string;
  quantity: number;
  unitCost: string;
  printedMrp?: string | null;
  poLineId?: string | null;
  generateInternalTag?: boolean;
}

export interface CreateStockReceiptInput {
  vendorId: string;
  receivedDate: string;
  poId?: string | null;
  vendorInvoiceRef?: string | null;
  lines: CreateStockReceiptLineInput[];
}

export interface StockReceiptLine {
  receiptLineId: string;
  skuId: string;
  skuCode: string;
  productName: string;
  size: string | null;
  poLineId: string | null;
  poLineOpenQuantity: number | null;
  batchId: string;
  quantity: number;
  unitCost: string;
  printedMrp: string | null;
  internalBarcode: string | null;
}

export interface StockReceiptDetail {
  receiptId: string;
  receiptNumber: string;
  vendorId: string;
  vendorName: string;
  poId: string | null;
  poNumber: string | null;
  poStatus: PurchaseOrderStatus | null;
  poTotalOpenQuantity: number | null;
  poVersion: number | null;
  vendorInvoiceRef: string | null;
  receivedDate: string;
  postedAt: string;
  lines: StockReceiptLine[];
}

export interface EligibleBatch {
  batchId: string;
  receivedDate: string;
  printedMrp: string | null;
  sellableQuantity: number;
  internalBarcode: string | null;
}

export interface BarcodeLookupResult {
  code: string;
  mappingType: BarcodeSourceType;
  skuId: string;
  name: string;
  size: string | null;
  defaultSellingPrice: string;
  sellableQuantity: number;
  batchId: string | null;
  printedMrp: string | null;
  batchSellableQuantity: number | null;
  requiresBatchSelection: boolean;
  eligibleBatches: EligibleBatch[];
}

export interface RegisterBarcodeInput {
  code: string;
  skuId: string;
}

export interface BarcodeMappingResult {
  barcodeMappingId: string;
  code: string;
  sourceType: BarcodeSourceType;
  skuId: string;
  batchId: string | null;
}

export interface BatchLabel {
  batchId: string;
  code: string;
  shopName: string;
  productName: string;
  size: string | null;
  displayPrice: string;
  barcode: string;
  textCode: string;
}

export interface InventoryBatch {
  batchId: string;
  receivedDate: string;
  unitCost: string;
  printedMrp: string | null;
  sellableQuantity: number;
  nonSellableQuantity: number;
  internalBarcode: string | null;
}

export interface InventoryItem {
  skuId: string;
  skuCode: string;
  productName: string;
  size: string | null;
  defaultSellingPrice: string;
  active: boolean;
  sellableQuantity: number;
  nonSellableQuantity: number;
  stockVersion: number;
  batches: InventoryBatch[];
}

export interface InventorySearchParams {
  skuId?: string | null;
  categoryId?: string | null;
  q?: string;
  page: number;
  size: number;
}

export type StockCountScope = 'SHOP' | 'CATEGORY';

export type StockCountStatus = 'DRAFT' | 'POSTED';

export type StockCountAllocationBasis = 'FIFO_SHORTAGE' | 'AUDIT_SURPLUS';

export interface CreateStockCountInput {
  scope: StockCountScope;
  categoryId?: string | null;
}

export interface StockCountSkuRef {
  skuId: string;
  skuCode: string;
  productName: string;
  size: string | null;
}

export interface CreateStockCountResponse {
  countId: string;
  scope: StockCountScope;
  categoryId: string | null;
  status: StockCountStatus;
  version: number;
  scopedSkus: StockCountSkuRef[];
}

export interface StockCountLineDetail {
  skuId: string;
  skuCode: string;
  productName: string;
  size: string | null;
  countedQuantity: number | null;
  expectedQuantity: number | null;
  currentQuantity: number;
  observedStockVersion: number | null;
  currentStockVersion: number;
  reason: string | null;
}

export interface StockCountDetail {
  countId: string;
  scope: StockCountScope;
  categoryId: string | null;
  status: StockCountStatus;
  version: number;
  createdAt: string;
  postedAt: string | null;
  postedBy: string | null;
  lines: StockCountLineDetail[];
}

export interface SaveStockCountLineInput {
  expectedVersion: number;
  countedQuantity: number | null;
  observedStockVersion: number;
  reason?: string | null;
}

export interface SaveStockCountLineResponse {
  countId: string;
  countVersion: number;
  line: StockCountLineDetail;
}

export interface PostStockCountInput {
  expectedVersion: number;
}

export interface StockCountAdjustmentSummary {
  skuId: string;
  skuCode: string;
  productName: string;
  size: string | null;
  expectedQuantity: number;
  countedQuantity: number;
  quantityDelta: number;
  reason: string | null;
  allocationBasis: StockCountAllocationBasis | null;
  batchIds: string[];
}

export interface PostStockCountResponse {
  countId: string;
  status: StockCountStatus;
  version: number;
  postedAt: string;
  adjustments: StockCountAdjustmentSummary[];
}

export interface ChangedStockSkuDetail {
  skuId: string;
  skuCode: string;
  observedStockVersion: number | null;
  currentStockVersion: number;
  currentSellableQuantity: number;
}
