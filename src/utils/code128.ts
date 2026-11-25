/**
 * Pure TypeScript ISO/IEC 15417 Code 128 encoder for product & batch tags.
 * Uses Code Set B for printable ASCII and shifts into Code Set C for runs of
 * 4+ digits (for example "BGD00000001") so 50 × 30 mm clothing tags stay compact
 * with >= 10X quiet zones on both sides.
 */

const CODE128_PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131',
  '211412', // 103: Start A
  '211214', // 104: Start B
  '211232', // 105: Start C
  '2331112', // 106: Stop (13 modules)
];

const CODE_C_LATCH = 99;
const CODE_B_LATCH = 100;
const START_B = 104;
const START_C = 105;
const STOP_CODE = 106;

export interface Code128Encoded {
  value: string;
  symbolValues: number[];
  bars: { x: number; width: number }[];
  symbolModules: number;
  quietZoneModules: number;
  totalModules: number;
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function countConsecutiveDigits(str: string, start: number): number {
  let count = 0;
  while (start + count < str.length && isDigit(str[start + count]!)) {
    count += 1;
  }
  return count;
}

export function encodeCode128(rawValue: string): Code128Encoded {
  const value = rawValue.trim();
  if (!value) {
    throw new Error('Cannot encode an empty Code 128 value.');
  }

  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code > 126) {
      throw new Error(`Unsupported character for Code 128B/C at index ${i}`);
    }
  }

  const symbols: number[] = [];
  let mode: 'B' | 'C' = countConsecutiveDigits(value, 0) >= 4 ? 'C' : 'B';
  symbols.push(mode === 'C' ? START_C : START_B);

  let index = 0;
  while (index < value.length) {
    if (mode === 'C') {
      const remainingDigits = countConsecutiveDigits(value, index);
      if (remainingDigits >= 2) {
        const pair = Number(value.slice(index, index + 2));
        symbols.push(pair);
        index += 2;
      } else {
        symbols.push(CODE_B_LATCH);
        mode = 'B';
      }
    } else {
      const consecutiveDigits = countConsecutiveDigits(value, index);
      const isAtEndWithEvenDigits =
        index + consecutiveDigits === value.length && consecutiveDigits >= 4 && consecutiveDigits % 2 === 0;
      if (consecutiveDigits >= 6 || isAtEndWithEvenDigits) {
        symbols.push(CODE_C_LATCH);
        mode = 'C';
      } else {
        symbols.push(value.charCodeAt(index) - 32);
        index += 1;
      }
    }
  }

  // ISO 15417 modulo 103 check character
  let weightedSum = symbols[0]!;
  for (let i = 1; i < symbols.length; i += 1) {
    weightedSum += symbols[i]! * i;
  }
  const checksum = weightedSum % 103;
  symbols.push(checksum, STOP_CODE);

  const quietZoneModules = 10;
  let cursor = quietZoneModules;
  const bars: { x: number; width: number }[] = [];

  for (const sym of symbols) {
    const widths = CODE128_PATTERNS[sym];
    if (!widths) {
      throw new Error(`Invalid Code 128 symbol index: ${sym}`);
    }
    for (let i = 0; i < widths.length; i += 1) {
      const w = Number(widths[i]);
      if (i % 2 === 0) {
        bars.push({ x: cursor, width: w });
      }
      cursor += w;
    }
  }

  const symbolModules = cursor - quietZoneModules;
  const totalModules = symbolModules + quietZoneModules * 2;

  return {
    value,
    symbolValues: symbols,
    bars,
    symbolModules,
    quietZoneModules,
    totalModules,
  };
}
