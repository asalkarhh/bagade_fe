import type { StockCountScope } from '../inventory/types.ts';

export interface SalesReportParams {
  from: string;
  to: string;
  categoryId?: string | null;
  skuId?: string | null;
  minPrice?: string;
  maxPrice?: string;
  page: number;
  size: number;
}

export interface SalesReportItem {
  skuId: string;
  skuCode: string;
  productName: string;
  size: string | null;
  netUnitsSold: number;
  netSales: string;
  cogs: string | null;
  grossProfit: string | null;
  costComplete: boolean;
  nonSellableReturnUnits: number;
  nonSellableReturnCost: string | null;
  nonSellableReturnSalesValue: string;
}

export interface SalesReport {
  from: string;
  to: string;
  categoryId: string | null;
  skuId: string | null;
  minPrice: string | null;
  maxPrice: string | null;
  netUnitsSold: number;
  netSales: string;
  cogs: string | null;
  grossProfit: string | null;
  costComplete: boolean;
  nonSellableReturnUnits: number;
  nonSellableReturnCost: string | null;
  nonSellableReturnSalesValue: string;
  operatingExpenses: string | null;
  estimatedProfit: string | null;
  items: SalesReportItem[];
  page: number;
  size: number;
  total: number;
}

export interface VendorReportParams {
  from: string;
  to: string;
  snapshotDate?: string;
  vendorId?: string | null;
  categoryId?: string | null;
  page: number;
  size: number;
}

export type ReportBatchSource = 'VENDOR' | 'AUDIT_SURPLUS' | 'RECEIPT' | string;

export interface VendorPerformanceRow {
  vendorId: string | null;
  vendorName: string;
  batchSource: ReportBatchSource;
  receivedUnits: number;
  directBatchSoldUnits: number;
  fifoSoldUnits: number;
  netSoldUnits: number;
  remainingSellableUnits: number;
  sellThroughPercentage: string | null;
  grossMargin: string | null;
  costComplete: boolean;
  weightedDaysFromReceiptToSale: string | null;
}

export interface VendorReport {
  from: string;
  to: string;
  snapshotDate: string;
  vendorId: string | null;
  categoryId: string | null;
  totalReceivedUnits: number;
  totalDirectBatchSoldUnits: number;
  totalFifoSoldUnits: number;
  totalNetSoldUnits: number;
  totalRemainingSellableUnits: number;
  totalSellThroughPercentage: string | null;
  totalGrossMargin: string | null;
  costComplete: boolean;
  weightedDaysFromReceiptToSale: string | null;
  items: VendorPerformanceRow[];
  page: number;
  size: number;
  total: number;
}

export interface StockAgeingParams {
  categoryId?: string | null;
  skuId?: string | null;
  vendorId?: string | null;
  page: number;
  size: number;
}

export interface StockAgeingRow {
  batchId: string;
  skuId: string;
  skuCode: string;
  productName: string;
  size: string | null;
  batchSource: ReportBatchSource;
  vendorId: string | null;
  vendorName: string;
  receiptDate: string | null;
  receiptDateKnown: boolean;
  daysOnHand: number | null;
  sellableQuantity: number;
  unitCost: string | null;
  costKnown: boolean;
  stockValue: string | null;
}

export interface StockAgeingReport {
  asOfDate: string;
  totalSellableUnits: number;
  totalStockValue: string | null;
  costComplete: boolean;
  unknownReceiptDateUnits: number;
  unknownCostUnits: number;
  items: StockAgeingRow[];
  page: number;
  size: number;
  total: number;
}

export interface CollectionsReportParams {
  from: string;
  to: string;
  customerId?: string | null;
  page: number;
  size: number;
}

export interface CustomerCollectionRow {
  customerId: string;
  customerName: string | null;
  customerContact: string | null;
  cashCollected: string;
  upiCollected: string;
  totalCollections: string;
  totalRefunds: string;
  netCollections: string;
  creditSales: string;
  outstandingBalanceAsOfEnd: string;
}

export interface CollectionsReport {
  from: string;
  to: string;
  customerId: string | null;
  cashCollected: string;
  upiCollected: string;
  totalCollections: string;
  cashRefunded: string;
  upiRefunded: string;
  totalRefunds: string;
  netCollections: string;
  creditSales: string;
  outstandingBalanceAsOfEnd: string;
  items: CustomerCollectionRow[];
  page: number;
  size: number;
  total: number;
}

export interface StockAuditReportParams {
  from: string;
  to: string;
  categoryId?: string | null;
  skuId?: string | null;
  page: number;
  size: number;
}

export interface StockAuditRow {
  stockCountId: string;
  countLineId: string;
  scope: StockCountScope;
  skuId: string;
  skuCode: string;
  productName: string;
  size: string | null;
  expectedQuantity: number;
  countedQuantity: number;
  adjustment: number;
  reason: string | null;
  postedByUserId: string;
  postedByUsername: string;
  postedByDisplayName: string;
  postedAt: string;
}

export interface StockAuditReport {
  from: string;
  to: string;
  totalPositiveAdjustment: number;
  totalNegativeAdjustment: number;
  netAdjustment: number;
  items: StockAuditRow[];
  page: number;
  size: number;
  total: number;
}
