const INR_INPUT_PATTERN = /^\d{1,10}(?:\.\d{1,2})?$/;

export type NormalizedPriceResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function normalizeInrPriceInput(raw: string): NormalizedPriceResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: 'Enter a selling price in INR.' };
  }

  if (!INR_INPUT_PATTERN.test(trimmed)) {
    return {
      ok: false,
      error: 'Enter a non-negative INR price with up to 2 decimal places (for example, 450 or 450.50).',
    };
  }

  const [rawInt, rawDec = ''] = trimmed.split('.');
  const strippedInt = rawInt.replace(/^0+(?=\d)/, '');
  if (strippedInt.length > 10) {
    return {
      ok: false,
      error: 'Price exceeds the maximum supported 10-digit INR amount.',
    };
  }

  const paddedDec = rawDec.padEnd(2, '0');
  return { ok: true, value: `${strippedInt}.${paddedDec}` };
}

function groupIndianDigits(integerPart: string): string {
  if (integerPart.length <= 3) {
    return integerPart;
  }
  const lastThree = integerPart.slice(-3);
  const rest = integerPart.slice(0, -3);
  const groupedRest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${groupedRest},${lastThree}`;
}

export function formatInrDisplay(decimalPrice: string): string {
  const trimmed = decimalPrice.trim();
  if (!INR_INPUT_PATTERN.test(trimmed)) {
    return trimmed ? `₹${trimmed}` : '—';
  }
  const [rawInt, rawDec = ''] = trimmed.split('.');
  const normalizedInt = rawInt.replace(/^0+(?=\d)/, '');
  const formattedInt = groupIndianDigits(normalizedInt);
  const formattedDec = rawDec.padEnd(2, '0');
  return `₹${formattedInt}.${formattedDec}`;
}

export function parseInrToPaise(raw: string): number | null {
  const trimmed = raw.trim();
  if (!INR_INPUT_PATTERN.test(trimmed)) {
    return null;
  }
  const [rawInt, rawDec = ''] = trimmed.split('.');
  const strippedInt = rawInt.replace(/^0+(?=\d)/, '');
  const paddedDec = rawDec.padEnd(2, '0');
  const paise = Number(strippedInt) * 100 + Number(paddedDec);
  return Number.isSafeInteger(paise) ? paise : null;
}

export function formatPaiseToInr(paise: number): string {
  const rounded = Math.trunc(paise);
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  const rupees = Math.floor(abs / 100);
  const remainder = String(abs % 100).padStart(2, '0');
  return `${sign}${rupees}.${remainder}`;
}
