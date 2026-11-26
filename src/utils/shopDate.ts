const DEFAULT_SHOP_TIMEZONE = 'Asia/Kolkata';
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface TemporalPlainDateLike {
  toString(): string;
}

interface TemporalGlobalLike {
  Now?: {
    plainDateISO?: (timeZone?: string) => TemporalPlainDateLike;
  };
}

export function getShopTimeZone(): string {
  const configured = import.meta.env.VITE_SHOP_TIMEZONE?.trim();
  return configured || DEFAULT_SHOP_TIMEZONE;
}

/**
 * Returns today's calendar date (YYYY-MM-DD) in the shop's local IANA timezone.
 * Uses Temporal.PlainDate when natively available, with an Intl en-CA fallback
 * for browsers without Temporal.
 */
export function getShopLocalDateIso(timeZone: string = getShopTimeZone()): string {
  const temporal = (globalThis as { Temporal?: TemporalGlobalLike }).Temporal;
  if (temporal?.Now?.plainDateISO) {
    try {
      const iso = temporal.Now.plainDateISO(timeZone).toString();
      if (ISO_DATE_PATTERN.test(iso)) {
        return iso;
      }
    } catch {
      // Fall back to Intl formatting if timezone or Temporal call fails.
    }
  }

  try {
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    if (ISO_DATE_PATTERN.test(formatted)) {
      return formatted;
    }
  } catch {
    // Fall back to system timezone calendar components below.
  }

  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getShopMonthStartDateIso(timeZone: string = getShopTimeZone()): string {
  const todayIso = getShopLocalDateIso(timeZone);
  return `${todayIso.slice(0, 8)}01`;
}

export function isValidIsoDate(value: string): boolean {
  const trimmed = value.trim();
  if (!ISO_DATE_PATTERN.test(trimmed)) {
    return false;
  }
  const [yearStr, monthStr, dayStr] = trimmed.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

export function formatShopTimestamp(
  isoInstant: string,
  timeZone: string = getShopTimeZone(),
): string {
  const date = new Date(isoInstant);
  if (Number.isNaN(date.getTime())) {
    return isoInstant;
  }
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}
