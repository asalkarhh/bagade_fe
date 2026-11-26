import { formatSignedInrDisplay, normalizeInrPriceInput, parseInrToPaise } from '../utils/inrPrice.ts';
import { isValidIsoDate } from '../utils/shopDate.ts';

export function validateDateRange(
  from: string,
  to: string,
  required = true,
): string | null {
  const trimmedFrom = from.trim();
  const trimmedTo = to.trim();

  if (required && (!trimmedFrom || !trimmedTo)) {
    return 'Select both "From" and "To" dates.';
  }
  if (trimmedFrom && !isValidIsoDate(trimmedFrom)) {
    return 'Enter a valid "From" date (YYYY-MM-DD).';
  }
  if (trimmedTo && !isValidIsoDate(trimmedTo)) {
    return 'Enter a valid "To" date (YYYY-MM-DD).';
  }
  if (trimmedFrom && trimmedTo && trimmedFrom > trimmedTo) {
    return 'Start date ("From") must be on or before end date ("To").';
  }
  return null;
}

export type PriceRangeValidationResult =
  | { ok: true; minPrice?: string; maxPrice?: string }
  | { ok: false; error: string };

export function validateOptionalPriceRange(
  rawMin: string,
  rawMax: string,
): PriceRangeValidationResult {
  const trimmedMin = rawMin.trim();
  const trimmedMax = rawMax.trim();
  let normalizedMin: string | undefined;
  let normalizedMax: string | undefined;

  if (trimmedMin) {
    const res = normalizeInrPriceInput(trimmedMin);
    if (!res.ok) {
      return { ok: false, error: `Minimum price: ${res.error}` };
    }
    normalizedMin = res.value;
  }

  if (trimmedMax) {
    const res = normalizeInrPriceInput(trimmedMax);
    if (!res.ok) {
      return { ok: false, error: `Maximum price: ${res.error}` };
    }
    normalizedMax = res.value;
  }

  if (normalizedMin && normalizedMax) {
    const minPaise = parseInrToPaise(normalizedMin);
    const maxPaise = parseInrToPaise(normalizedMax);
    if (minPaise !== null && maxPaise !== null && minPaise > maxPaise) {
      return {
        ok: false,
        error: 'Minimum selling price must not exceed maximum selling price.',
      };
    }
  }

  return { ok: true, minPrice: normalizedMin, maxPrice: normalizedMax };
}

export function formatReportMoneyOrUnavailable(
  amount: string | null,
  costComplete: boolean,
  unavailableLabel = 'Unavailable (cost incomplete)',
): string {
  if (!costComplete || amount === null) {
    return unavailableLabel;
  }
  return formatSignedInrDisplay(amount);
}

export function formatSignedCountDelta(delta: number): string {
  if (delta === 0) {
    return '0 (Match)';
  }
  return delta > 0 ? `+${delta}` : String(delta);
}
