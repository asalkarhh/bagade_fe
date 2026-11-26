import type { EligibleBatch } from '../inventory/types.ts';

export type PaymentMode = 'CASH' | 'UPI';
export type PaymentDirection = 'PAYMENT' | 'REFUND';
export type BillStatus = 'ISSUED' | 'PARTIALLY_RETURNED' | 'RETURNED' | 'CANCELLED';
export type StockCondition = 'SELLABLE' | 'NON_SELLABLE';
export type MovementType = 'RECEIPT' | 'SALE' | 'RETURN' | 'ADJUSTMENT';

export interface Customer {
  customerId: string;
  name: string;
  contact: string | null;
}

export interface CreateCustomerInput {
  name: string;
  contact?: string | null;
}

export interface CustomerSearchParams {
  q?: string;
  page: number;
  size: number;
}

export interface BillLineInput {
  skuId: string;
  quantity: number;
  batchId?: string | null;
  discountAmount?: string | null;
  unitPriceOverride?: string | null;
}

export interface BillPaymentInput {
  mode: PaymentMode;
  amount: string;
  reference?: string | null;
}

export interface CreateBillInput {
  lines: BillLineInput[];
  expectedTotal: string;
  customerId?: string | null;
  payments: BillPaymentInput[];
}

export interface BillAllocation {
  skuId: string;
  batchId: string;
  quantity: number;
  capturedUnitCost: string;
  attributionMethod: string;
}

export interface CreateBillResponse {
  billId: string;
  billNumber: string;
  version: number;
  issueDate: string;
  issuedAt: string;
  status: BillStatus;
  subtotal: string;
  discountTotal: string;
  total: string;
  paid: string;
  balanceDue: string;
  allocations: BillAllocation[];
}

export interface BillPreviewLine {
  skuId: string;
  skuCode: string;
  productName: string;
  size: string | null;
  batchId: string | null;
  quantity: number;
  unitSellingPrice: string;
  discountAmount: string;
  lineSubtotal: string;
  lineTotal: string;
  availableQuantity: number;
  sufficientStock: boolean;
  requiresBatchSelection: boolean;
  selectableBatches: EligibleBatch[];
  issues: string[];
}

export interface BillPreviewResponse {
  lines: BillPreviewLine[];
  subtotal: string;
  discountTotal: string;
  total: string;
  canCheckout: boolean;
}

export interface BillSummary {
  billId: string;
  billNumber: string;
  issueDate: string;
  status: BillStatus;
  total: string;
  paid: string;
  balanceDue: string;
}

export interface BillSearchParams {
  billNumber?: string;
  from?: string;
  to?: string;
  customerId?: string | null;
  page: number;
  size: number;
}

export interface BillLineDetail {
  billLineId: string;
  logicalLineId: string;
  skuId: string;
  skuCode: string;
  productName: string;
  size: string | null;
  quantity: number;
  returnedQuantity: number;
  returnableQuantity: number;
  unitSellingPrice: string;
  discountAmount: string;
  lineTotal: string;
  allocations: BillAllocation[];
}

export interface PaymentEntry {
  paymentId: string;
  direction: PaymentDirection;
  mode: PaymentMode;
  amount: string;
  reference: string | null;
  postedAt: string;
  postedBy: string;
}

export interface BillRevisionRef {
  revisionId: string;
  revisionNumber: number;
  subtotal: string;
  discountTotal: string;
  total: string;
  createdAt: string;
}

export interface BillingEventRef {
  eventId: string;
  eventType: string;
  revisionNumber: number;
  reason: string | null;
  occurredAt: string;
  actorId: string;
}

export interface SalesAdjustment {
  adjustmentId: string;
  adjustmentType: string;
  subtotalDelta: string;
  discountDelta: string;
  amountDelta: string;
  occurredAt: string;
  postedBy: string;
}

export interface SaleAllocationReversal {
  reversalId: string;
  saleAllocationId: string;
  billingEventId: string;
  skuId: string;
  batchId: string;
  quantity: number;
  capturedUnitCost: string;
  disposition: string;
  reversedAt: string;
}

export interface BillDetail {
  billId: string;
  billNumber: string;
  issueDate: string;
  issuedAt: string;
  status: BillStatus;
  currentRevisionNumber: number;
  version: number;
  customerId: string | null;
  customerName: string | null;
  customerContact: string | null;
  subtotal: string;
  discountTotal: string;
  total: string;
  paid: string;
  balanceDue: string;
  lines: BillLineDetail[];
  payments: PaymentEntry[];
  revisions: BillRevisionRef[];
  events: BillingEventRef[];
  salesAdjustments: SalesAdjustment[];
  allocationReversals: SaleAllocationReversal[];
}

export interface BillPrintLine {
  skuCode: string;
  productName: string;
  size: string | null;
  quantity: number;
  returnedQuantity: number;
  unitSellingPrice: string;
  discountAmount: string;
  lineTotal: string;
}

export interface BillPrintPayment {
  direction: PaymentDirection;
  mode: PaymentMode;
  amount: string;
  reference: string | null;
  postedAt: string;
}

export interface BillPrintCorrection {
  eventType: string;
  occurredAt: string;
  reason: string | null;
  amountDelta: string;
}

export interface BillPrintData {
  shopName: string;
  receiptProfile: string;
  billId: string;
  billNumber: string;
  status: BillStatus | null;
  revisionNumber: number;
  issueDate: string;
  issuedAt: string;
  customerName: string | null;
  customerContact: string | null;
  lines: BillPrintLine[];
  subtotal: string;
  discountTotal: string;
  total: string;
  paid: string;
  balanceDue: string;
  payments: BillPrintPayment[];
  corrections: BillPrintCorrection[];
}

export interface SettlementEntryInput {
  direction: PaymentDirection;
  mode: PaymentMode;
  amount: string;
  reference?: string | null;
}

export interface BillStockEffect {
  skuId: string;
  skuCode: string;
  batchId: string;
  stockCondition: StockCondition;
  movementType: MovementType;
  quantityDelta: number;
  resultingBatchQuantity: number;
}

export interface EditBillLineInput {
  lineId?: string | null;
  skuId: string;
  quantity: number;
  batchId?: string | null;
  discountAmount?: string | null;
  unitPriceOverride?: string | null;
}

export interface ReviseBillInput {
  expectedVersion: number;
  reason: string;
  lines: EditBillLineInput[];
  expectedTotal: string;
  settlement?: SettlementEntryInput[];
}

export interface EditBillResponse {
  billId: string;
  revision: number;
  version: number;
  total: string;
  adjustmentAmount: string;
  balanceDue: string;
}

export interface ReturnLineInput {
  lineId: string;
  quantity: number;
  disposition: StockCondition;
}

export interface ReturnBillInput {
  expectedVersion: number;
  reason: string;
  returnedLines: ReturnLineInput[];
  settlement?: SettlementEntryInput[];
}

export interface ReturnBillResponse {
  returnId: string;
  billId: string;
  version: number;
  balanceDue: string;
  stockEffects: BillStockEffect[];
}

export interface ExchangeBillInput {
  expectedVersion: number;
  reason: string;
  returnedLines: ReturnLineInput[];
  replacementLines: BillLineInput[];
  settlement?: SettlementEntryInput[];
}

export interface ExchangeBillResponse {
  exchangeId: string;
  billId: string;
  version: number;
  priceDifference: string;
  balanceDue: string;
  stockEffects: BillStockEffect[];
}

export interface CancelBillInput {
  expectedVersion: number;
  reason: string;
  settlement?: SettlementEntryInput[];
}

export interface CancelBillResponse {
  billId: string;
  version: number;
  status: BillStatus;
  balanceDue: string;
}

export interface CollectBillPaymentInput {
  expectedVersion: number;
  mode: PaymentMode;
  amount: string;
  reference?: string | null;
}

export interface CollectBillPaymentResponse {
  paymentId: string;
  billId: string;
  version: number;
  balanceDue: string;
}
