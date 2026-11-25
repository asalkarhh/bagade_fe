import { afterEach, describe, expect, it, vi } from 'vitest';
import { getShopLocalDateIso, getShopTimeZone, isValidIsoDate } from './shopDate.ts';

describe('shopDate utilities', () => {
  const originalTemporal = (globalThis as { Temporal?: unknown }).Temporal;

  afterEach(() => {
    vi.useRealTimers();
    if (originalTemporal === undefined) {
      delete (globalThis as { Temporal?: unknown }).Temporal;
    } else {
      (globalThis as { Temporal?: unknown }).Temporal = originalTemporal;
    }
  });

  it('defaults shop timezone to Asia/Kolkata', () => {
    expect(getShopTimeZone()).toBe('Asia/Kolkata');
  });

  it('uses Temporal.Now.plainDateISO when available', () => {
    const plainDateISO = vi.fn(() => ({ toString: () => '2026-11-26' }));
    (globalThis as { Temporal?: unknown }).Temporal = {
      Now: { plainDateISO },
    };

    expect(getShopLocalDateIso('Asia/Kolkata')).toBe('2026-11-26');
    expect(plainDateISO).toHaveBeenCalledWith('Asia/Kolkata');
  });

  it('falls back to Intl en-CA shop calendar date when Temporal is absent', () => {
    delete (globalThis as { Temporal?: unknown }).Temporal;
    vi.useFakeTimers();
    // 2026-11-25 20:00:00 UTC is 2026-11-26 01:30:00 IST (Asia/Kolkata).
    vi.setSystemTime(new Date('2026-11-25T20:00:00Z'));

    expect(getShopLocalDateIso('Asia/Kolkata')).toBe('2026-11-26');
  });

  it('validates real YYYY-MM-DD calendar dates', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2024-02-29')).toBe(true);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('25-11-2026')).toBe(false);
  });
});
