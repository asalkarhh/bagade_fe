import type { PurchaseOrderStatus } from './types.ts';

export interface PoStatusDisplay {
  label: string;
  symbol: string;
  variant: 'open' | 'partial' | 'closed' | 'cancelled';
}

const PO_STATUS_MAP: Record<PurchaseOrderStatus, PoStatusDisplay> = {
  OPEN: { label: 'Open', symbol: '●', variant: 'open' },
  PARTIALLY_RECEIVED: { label: 'Partially received', symbol: '◐', variant: 'partial' },
  CLOSED: { label: 'Closed', symbol: '✓', variant: 'closed' },
  CANCELLED: { label: 'Cancelled', symbol: '✕', variant: 'cancelled' },
};

export function getPoStatusDisplay(status: PurchaseOrderStatus): PoStatusDisplay {
  return PO_STATUS_MAP[status];
}

export const ALL_PO_STATUSES: readonly PurchaseOrderStatus[] = [
  'OPEN',
  'PARTIALLY_RECEIVED',
  'CLOSED',
  'CANCELLED',
];
