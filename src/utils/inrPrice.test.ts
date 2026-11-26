import { describe, expect, it } from 'vitest';
import {
  formatInrDisplay,
  formatPaiseToInr,
  normalizeInrPriceInput,
  parseInrToPaise,
} from './inrPrice.ts';

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

  it('converts INR strings to exact integer paise and formats back cleanly', () => {
    expect(parseInrToPaise('0')).toBe(0);
    expect(parseInrToPaise('199.5')).toBe(19950);
    expect(parseInrToPaise('4500.00')).toBe(450000);
    expect(parseInrToPaise('0.01')).toBe(1);
    expect(parseInrToPaise('invalid')).toBeNull();
    expect(parseInrToPaise('-10.00')).toBeNull();

    expect(formatPaiseToInr(0)).toBe('0.00');
    expect(formatPaiseToInr(19950)).toBe('199.50');
    expect(formatPaiseToInr(450005)).toBe('4500.05');
    expect(formatPaiseToInr(-250)).toBe('-2.50');
  });
});
