import { describe, expect, it } from 'vitest';
import { encodeCode128 } from './code128.ts';

describe('Code 128 encoder', () => {
  it('encodes internal batch codes like BGD00000001 with >= 10X quiet zones and valid mod-103 checksum', () => {
    const encoded = encodeCode128('BGD00000001');

    expect(encoded.value).toBe('BGD00000001');
    expect(encoded.quietZoneModules).toBeGreaterThanOrEqual(10);
    // Start B (104), 'B' (34), 'G' (39), 'D' (36), Code C (99), 00, 00, 00, 01, checksum, Stop (106)
    expect(encoded.symbolValues.slice(0, 9)).toEqual([104, 34, 39, 36, 99, 0, 0, 0, 1]);
    expect(encoded.symbolValues.at(-1)).toBe(106);

    const dataSymbols = encoded.symbolValues.slice(0, -2);
    const expectedChecksum =
      dataSymbols.reduce((acc, val, idx) => acc + val * (idx === 0 ? 1 : idx), 0) % 103;
    expect(encoded.symbolValues.at(-2)).toBe(expectedChecksum);

    expect(encoded.bars[0]?.x).toBe(encoded.quietZoneModules);
    const lastBar = encoded.bars.at(-1)!;
    expect(lastBar.x + lastBar.width + encoded.quietZoneModules).toBe(encoded.totalModules);
  });

  it('encodes leading-zero numeric barcodes via Code 128C while preserving digits', () => {
    const encoded = encodeCode128('008901234567');
    expect(encoded.symbolValues.slice(0, 7)).toEqual([105, 0, 89, 1, 23, 45, 67]);
  });

  it('rejects empty and non-ASCII barcode strings', () => {
    expect(() => encodeCode128('   ')).toThrow();
    expect(() => encodeCode128('BGD₹01')).toThrow();
  });
});
