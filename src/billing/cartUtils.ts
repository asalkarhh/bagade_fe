import type { EligibleBatch } from '../inventory/types.ts';
import { normalizeInrPriceInput, parseInrToPaise } from '../utils/inrPrice.ts';
import type { BillLineInput } from './types.ts';

export interface CartLine {
  localId: number;
  skuId: string;
  skuCode: string;
  productName: string;
  size: string | null;
  defaultSellingPrice: string;
  batchId: string | null;
  printedMrp: string | null;
  internalBarcode: string | null;
  batchLockedByTag: boolean;
  availableBatches: EligibleBatch[];
  quantityRaw: string;
  discountRaw: string;
  priceOverrideRaw: string;
}

export interface CartLineValidationError {
  quantity?: string;
  discount?: string;
  priceOverride?: string;
}

export interface ValidatedCartLineResult {
  valid: boolean;
  errors: CartLineValidationError;
  apiLine: BillLineInput | null;
}

export interface PriceTotalsSnapshot {
  subtotal: string;
  discountTotal: string;
  total: string;
}

export function generateBillIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `bill-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function parsePositiveWholeQuantity(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    return null;
  }
  const num = Number(trimmed);
  if (!Number.isSafeInteger(num) || num < 1 || num > 1_000_000) {
    return null;
  }
  return num;
}

function normalizeOptionalPricingValue(
  raw: string,
  emptyDefault: string | null,
): { ok: true; value: string | null } | { ok: false } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, value: emptyDefault };
  }
  const parsed = normalizeInrPriceInput(trimmed);
  if (!parsed.ok) {
    return { ok: false };
  }
  return { ok: true, value: parsed.value };
}

/**
 * Merges a scanned or picked item into an existing cart line only when
 * SKU, selected batchId, and pricing inputs (override and discount) match.
 */
export function findMergeableCartLineIndex(
  lines: CartLine[],
  candidate: {
    skuId: string;
    batchId: string | null;
    discountAmount?: string | null;
    unitPriceOverride?: string | null;
  },
): number {
  const targetDiscount = candidate.discountAmount
    ? normalizeOptionalPricingValue(candidate.discountAmount, '0.00')
    : { ok: true as const, value: '0.00' };
  const targetOverride = candidate.unitPriceOverride
    ? normalizeOptionalPricingValue(candidate.unitPriceOverride, null)
    : { ok: true as const, value: null };

  if (!targetDiscount.ok || !targetOverride.ok) {
    return -1;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.skuId !== candidate.skuId) {
      continue;
    }
    if ((line.batchId ?? null) !== (candidate.batchId ?? null)) {
      continue;
    }

    const existingDiscount = normalizeOptionalPricingValue(line.discountRaw, '0.00');
    const existingOverride = normalizeOptionalPricingValue(line.priceOverrideRaw, null);
    if (!existingDiscount.ok || !existingOverride.ok) {
      continue;
    }

    if (
      existingDiscount.value === targetDiscount.value &&
      existingOverride.value === targetOverride.value
    ) {
      return i;
    }
  }

  return -1;
}

export function validateCartLine(line: CartLine): ValidatedCartLineResult {
  const errors: CartLineValidationError = {};
  const qty = parsePositiveWholeQuantity(line.quantityRaw);
  if (qty === null) {
    errors.quantity = 'Enter a whole quantity of 1 or more.';
  }

  let overrideNormalized: string | null = null;
  if (line.priceOverrideRaw.trim().length > 0) {
    const overrideResult = normalizeInrPriceInput(line.priceOverrideRaw);
    if (!overrideResult.ok) {
      errors.priceOverride = overrideResult.error;
    } else {
      overrideNormalized = overrideResult.value;
    }
  }

  let discountNormalized: string | null = null;
  if (line.discountRaw.trim().length > 0) {
    const discountResult = normalizeInrPriceInput(line.discountRaw);
    if (!discountResult.ok) {
      errors.discount = discountResult.error;
    } else {
      discountNormalized = discountResult.value;
    }
  }

  if (!errors.discount && discountNormalized !== null && qty !== null) {
    const unitPaise = parseInrToPaise(overrideNormalized ?? line.defaultSellingPrice);
    const discountPaise = parseInrToPaise(discountNormalized);
    if (unitPaise !== null && discountPaise !== null && discountPaise > qty * unitPaise) {
      errors.discount = 'Line discount cannot exceed line subtotal.';
    }
  }

  const valid = !errors.quantity && !errors.discount && !errors.priceOverride;
  return {
    valid,
    errors,
    apiLine:
      valid && qty !== null
        ? {
            skuId: line.skuId,
            quantity: qty,
            ...(line.batchId ? { batchId: line.batchId } : {}),
            ...(discountNormalized !== null ? { discountAmount: discountNormalized } : {}),
            ...(overrideNormalized !== null ? { unitPriceOverride: overrideNormalized } : {}),
          }
        : null,
  };
}

export function parseTotalsSnapshot(raw: unknown): PriceTotalsSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (
    typeof record.subtotal === 'string' &&
    typeof record.discountTotal === 'string' &&
    typeof record.total === 'string'
  ) {
    return {
      subtotal: record.subtotal,
      discountTotal: record.discountTotal,
      total: record.total,
    };
  }
  return null;
}
