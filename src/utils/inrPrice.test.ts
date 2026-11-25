import { describe, expect, it } from 'vitest';
import { formatInrDisplay, normalizeInrPriceInput } from './inrPrice.ts';

describe('inrPrice utilities', () => {
  it('normalizes valid INR decimal inputs while preserving exact decimal accuracy', () => {
    expect(normalizeInrPriceInput('4500')).toEqual({ ok: true, value: '4500.00' });
    expect(normalizeInrPriceInput(' 199.5 ')).toEqual({ ok: true, value: '199.50' });
    expect(normalizeInrPriceInput('0045.50')).toEqual({ ok: true, value: '45.50' });
    expect(normalizeInrPriceInput('0')).toEqual({ ok: true, value: '0.00' });
    expect(normalizeInrPriceInput('9999999999.99')).toEqual({
      ok: true,
      value: '9999999999.99',
    });
  });

  it('rejects negative values, excess decimal places, and non-numeric strings', () => {
    expect(normalizeInrPriceInput('')).toMatchObject({ ok: false });
    expect(normalizeInrPriceInput('-10')).toMatchObject({ ok: false });
    expect(normalizeInrPriceInput('199.999')).toMatchObject({ ok: false });
    expect(normalizeInrPriceInput('abc')).toMatchObject({ ok: false });
    expect(normalizeInrPriceInput('10000000000.00')).toMatchObject({ ok: false });
  });

  it('formats decimal prices in Indian rupees with lossless grouping', () => {
    expect(formatInrDisplay('4500.00')).toBe('₹4,500.00');
    expect(formatInrDisplay('125000.50')).toBe('₹1,25,000.50');
    expect(formatInrDisplay('199.5')).toBe('₹199.50');
    expect(formatInrDisplay('9999999999.99')).toBe('₹9,99,99,99,999.99');
  });
});
