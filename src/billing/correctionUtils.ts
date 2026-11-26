import type { EligibleBatch } from '../inventory/types.ts';
import {
  formatInrDisplay,
  formatPaiseToInr,
  normalizeInrPriceInput,
  parseInrToPaise,
} from '../utils/inrPrice.ts';
import type {
  BillLineDetail,
  PaymentDirection,
  PaymentMode,
  SettlementEntryInput,
} from './types.ts';

export interface ReturnCreditPaise {
  subtotalAbsPaise: number;
  discountAbsPaise: number;
  netAbsPaise: number;
}

export interface SettlementDraftRow {
  localId: number;
  direction: PaymentDirection;
  mode: PaymentMode;
  amountRaw: string;
  referenceRaw: string;
}

export interface SettlementRowValidation {
  localId: number;
  valid: boolean;
  amountError?: string;
  referenceError?: string;
  paise: number | null;
  apiEntry: SettlementEntryInput | null;
}

export interface SettlementGuidance {
  requiredRefundPaise: number;
  additionalDuePaise: number;
  minRequiredPaymentPaise: number;
  maxAllowedPaymentPaise: number;
}

export interface SettlementSummaryValidation {
  rows: SettlementRowValidation[];
  totalPaymentsPaise: number;
  totalRefundsPaise: number;
  netPaidAfterPaise: number;
  balanceDueAfterPaise: number;
  bannerError: string | null;
  valid: boolean;
  apiEntries: SettlementEntryInput[];
}

function roundHalfUpDivide(numerator: number, denominator: number): number {
  if (numerator <= 0 || denominator <= 0) {
    return 0;
  }
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/**
 * Mirrors BillingStockHelper.computeReturnCredit using exact integer paise math.
 */
export function computeReturnCreditPaise(
  line: Pick<BillLineDetail, 'quantity' | 'returnedQuantity' | 'unitSellingPrice' | 'discountAmount'>,
  returnQtyNow: number,
): ReturnCreditPaise {
  if (returnQtyNow <= 0 || line.quantity <= 0) {
    return { subtotalAbsPaise: 0, discountAbsPaise: 0, netAbsPaise: 0 };
  }

  const unitPaise = parseInrToPaise(line.unitSellingPrice) ?? 0;
  const discountPaise = parseInrToPaise(line.discountAmount) ?? 0;
  const prevRet = Math.max(0, line.returnedQuantity);
  const newCum = Math.min(line.quantity, prevRet + returnQtyNow);

  const prevDiscCum = prevRet === 0 ? 0 : roundHalfUpDivide(discountPaise * prevRet, line.quantity);
  const newDiscCum =
    newCum === line.quantity ? discountPaise : roundHalfUpDivide(discountPaise * newCum, line.quantity);

  const discountAbsPaise = Math.max(0, newDiscCum - prevDiscCum);
  const subtotalAbsPaise = unitPaise * returnQtyNow;
  const netAbsPaise = Math.max(0, subtotalAbsPaise - discountAbsPaise);

  return { subtotalAbsPaise, discountAbsPaise, netAbsPaise };
}

/**
 * Computes active remaining net total in paise for a revision line, accounting for
 * any units already returned before this edit.
 */
export function computeRevisionActiveNetPaise(params: {
  quantity: number;
  returnedQuantity: number;
  originalQuantity: number;
  unitPricePaise: number;
  discountPaise: number;
}): number {
  const { quantity, returnedQuantity, originalQuantity, unitPricePaise, discountPaise } = params;
  const lineTotalPaise = Math.max(0, quantity * unitPricePaise - discountPaise);
  if (returnedQuantity <= 0 || originalQuantity <= 0) {
    return lineTotalPaise;
  }
  const returnedDiscPaise =
    returnedQuantity === originalQuantity
      ? discountPaise
      : roundHalfUpDivide(discountPaise * returnedQuantity, originalQuantity);
  const returnedNetPaise = Math.max(0, returnedQuantity * unitPricePaise - returnedDiscPaise);
  return Math.max(0, lineTotalPaise - returnedNetPaise);
}

export function computeSettlementGuidance(
  currentPaidPaise: number,
  adjustedTotalPaise: number,
  hasCustomer: boolean,
): SettlementGuidance {
  const diff = adjustedTotalPaise - currentPaidPaise;
  if (diff < 0) {
    return {
      requiredRefundPaise: Math.abs(diff),
      additionalDuePaise: 0,
      minRequiredPaymentPaise: 0,
      maxAllowedPaymentPaise: 0,
    };
  }
  return {
    requiredRefundPaise: 0,
    additionalDuePaise: diff,
    minRequiredPaymentPaise: hasCustomer ? 0 : diff,
    maxAllowedPaymentPaise: diff,
  };
}

export function validateSettlementEntries(
  rows: SettlementDraftRow[],
  currentPaidPaise: number,
  adjustedTotalPaise: number,
  hasCustomer: boolean,
  allowedDirections: readonly PaymentDirection[],
): SettlementSummaryValidation {
  const rowResults: SettlementRowValidation[] = rows.map((row) => {
    let amountError: string | undefined;
    let referenceError: string | undefined;
    let paise: number | null = null;
    let normalizedAmount: string | null = null;

    if (!allowedDirections.includes(row.direction)) {
      amountError = `${row.direction} entries are not permitted for this operation.`;
    }

    const trimmed = row.amountRaw.trim();
    if (!amountError && !trimmed) {
      amountError = 'Enter a positive INR amount or remove this settlement row.';
    } else if (!amountError) {
      const normalized = normalizeInrPriceInput(trimmed);
      if (!normalized.ok) {
        amountError = normalized.error;
      } else {
        const parsedPaise = parseInrToPaise(normalized.value);
        if (parsedPaise === null || parsedPaise <= 0) {
          amountError = 'Settlement amount must be greater than ₹0.00.';
        } else {
          paise = parsedPaise;
          normalizedAmount = normalized.value;
        }
      }
    }

    if (row.referenceRaw.trim().length > 150) {
      referenceError = 'Reference must not exceed 150 characters.';
    }

    const valid = !amountError && !referenceError;
    return {
      localId: row.localId,
      valid,
      amountError,
      referenceError,
      paise,
      apiEntry:
        valid && normalizedAmount !== null
          ? {
              direction: row.direction,
              mode: row.mode,
              amount: normalizedAmount,
              ...(row.referenceRaw.trim() ? { reference: row.referenceRaw.trim() } : {}),
            }
          : null,
    };
  });

  const totalPaymentsPaise = rowResults.reduce(
    (sum, r, idx) => sum + (rows[idx].direction === 'PAYMENT' ? (r.paise ?? 0) : 0),
    0,
  );
  const totalRefundsPaise = rowResults.reduce(
    (sum, r, idx) => sum + (rows[idx].direction === 'REFUND' ? (r.paise ?? 0) : 0),
    0,
  );

  const paidAfterRefunds = currentPaidPaise - totalRefundsPaise;
  const netPaidAfterPaise = paidAfterRefunds + totalPaymentsPaise;
  const balanceDueAfterPaise = adjustedTotalPaise - netPaidAfterPaise;

  let bannerError: string | null = null;
  if (totalRefundsPaise > currentPaidPaise) {
    bannerError = `Total refunds (${formatInrDisplay(formatPaiseToInr(totalRefundsPaise))}) exceed collected payments (${formatInrDisplay(formatPaiseToInr(currentPaidPaise))}).`;
  } else if (paidAfterRefunds > adjustedTotalPaise) {
    const requiredRefund = paidAfterRefunds - adjustedTotalPaise;
    bannerError = `Refund of at least ${formatInrDisplay(formatPaiseToInr(requiredRefund))} is required because the adjusted total (${formatInrDisplay(formatPaiseToInr(adjustedTotalPaise))}) is below net collected payments.`;
  } else if (netPaidAfterPaise > adjustedTotalPaise) {
    bannerError = `Net payments (${formatInrDisplay(formatPaiseToInr(netPaidAfterPaise))}) exceed adjusted bill total (${formatInrDisplay(formatPaiseToInr(adjustedTotalPaise))}).`;
  } else if (balanceDueAfterPaise > 0 && !hasCustomer) {
    bannerError = `Walk-in bills cannot carry a positive balance due (${formatInrDisplay(formatPaiseToInr(balanceDueAfterPaise))}). Record settlement payment for the full difference.`;
  }

  const allRowsValid = rowResults.every((r) => r.valid);
  const apiEntries = rowResults
    .map((r) => r.apiEntry)
    .filter((entry): entry is SettlementEntryInput => entry !== null);

  return {
    rows: rowResults,
    totalPaymentsPaise,
    totalRefundsPaise,
    netPaidAfterPaise,
    balanceDueAfterPaise,
    bannerError,
    valid: allRowsValid && bannerError === null,
    apiEntries,
  };
}

export interface SelectableBatchWithSku extends EligibleBatch {
  skuId?: string;
}

export function parseSelectableBatches(raw: unknown): SelectableBatchWithSku[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: SelectableBatchWithSku[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const rec = item as Record<string, unknown>;
    if (typeof rec.batchId !== 'string') {
      continue;
    }
    result.push({
      skuId: typeof rec.skuId === 'string' ? rec.skuId : undefined,
      batchId: rec.batchId,
      receivedDate: typeof rec.receivedDate === 'string' ? rec.receivedDate : '',
      printedMrp: typeof rec.printedMrp === 'string' ? rec.printedMrp : null,
      sellableQuantity: typeof rec.sellableQuantity === 'number' ? rec.sellableQuantity : 0,
      internalBarcode: typeof rec.internalBarcode === 'string' ? rec.internalBarcode : null,
    });
  }
  return result;
}
