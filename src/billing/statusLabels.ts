import type { BillStatus } from './types.ts';

export interface BillStatusDisplay {
  label: string;
  symbol: string;
  variant: 'issued' | 'partial' | 'returned' | 'cancelled';
}

const BILL_STATUS_MAP: Record<BillStatus, BillStatusDisplay> = {
  ISSUED: { label: 'Issued', symbol: '✓', variant: 'issued' },
  PARTIALLY_RETURNED: { label: 'Partially returned', symbol: '◐', variant: 'partial' },
  RETURNED: { label: 'Returned', symbol: '↺', variant: 'returned' },
  CANCELLED: { label: 'Cancelled', symbol: '✕', variant: 'cancelled' },
};

export function getBillStatusDisplay(status: BillStatus): BillStatusDisplay {
  return BILL_STATUS_MAP[status];
}
