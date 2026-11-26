import { isApiClientError } from '../api/errors.ts';
import type { ChangedStockSkuDetail, StockCountLineDetail } from './types.ts';

const WHOLE_NUMBER_PATTERN = /^\d+$/;

export type ParsedCountQuantityResult =
  | { valid: true; value: number | null }
  | { valid: false; error: string };

/**
 * Parses a physical count input string while distinguishing an empty string
 * (uncounted / pending) from an explicit "0" count.
 */
export function parseCountQuantityInput(raw: string): ParsedCountQuantityResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { valid: true, value: null };
  }
  if (!WHOLE_NUMBER_PATTERN.test(trimmed)) {
    return {
      valid: false,
      error: 'Enter a whole number 0 or greater, or leave blank while pending.',
    };
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return {
      valid: false,
      error: 'Counted quantity must be a valid non-negative whole number.',
    };
  }
  return { valid: true, value: parsed };
}

/**
 * Returns the expected sellable quantity for comparison and discrepancy checks.
 * Once a draft line is saved, expectedQuantity reflects the captured stock;
 * while still pending, currentQuantity reflects live shelf stock.
 */
export function getLineExpectedQuantity(line: StockCountLineDetail): number {
  return line.expectedQuantity !== null ? line.expectedQuantity : line.currentQuantity;
}

export function doesLineHaveStaleStockVersion(line: StockCountLineDetail): boolean {
  if (line.observedStockVersion === null) {
    return false;
  }
  if (line.observedStockVersion !== line.currentStockVersion) {
    return true;
  }
  return line.expectedQuantity !== null && line.expectedQuantity !== line.currentQuantity;
}

export function computeLineDiscrepancy(
  countedQuantity: number | null,
  expectedQuantity: number,
): number | null {
  if (countedQuantity === null) {
    return null;
  }
  return countedQuantity - expectedQuantity;
}

export function formatSignedDelta(delta: number | null): string {
  if (delta === null) {
    return '—';
  }
  if (delta === 0) {
    return '0 (Match)';
  }
  return delta > 0 ? `+${delta}` : String(delta);
}

/**
 * Extracts typed changed-SKU records attached to a 409 STOCK_CHANGED response.
 */
export function parseChangedStockSkus(error: unknown): ChangedStockSkuDetail[] {
  if (!isApiClientError(error) || error.code !== 'STOCK_CHANGED') {
    return [];
  }
  const rawList = error.details?.changedSkus;
  if (!Array.isArray(rawList)) {
    return [];
  }

  const parsed: ChangedStockSkuDetail[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.skuId === 'string' &&
      typeof record.skuCode === 'string' &&
      typeof record.currentStockVersion === 'number' &&
      typeof record.currentSellableQuantity === 'number'
    ) {
      parsed.push({
        skuId: record.skuId,
        skuCode: record.skuCode,
        observedStockVersion:
          typeof record.observedStockVersion === 'number' ? record.observedStockVersion : null,
        currentStockVersion: record.currentStockVersion,
        currentSellableQuantity: record.currentSellableQuantity,
      });
    }
  }
  return parsed;
}
