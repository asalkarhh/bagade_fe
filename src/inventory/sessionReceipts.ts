import { useSyncExternalStore } from 'react';
import type { StockReceiptDetail } from './types.ts';

export interface RecentSessionReceipt {
  receiptId: string;
  receiptNumber: string;
  vendorName: string;
  poId: string | null;
  poNumber: string | null;
  receivedDate: string;
  totalUnits: number;
}

let recentReceipts: RecentSessionReceipt[] = [];
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

export function recordSessionReceipt(receipt: StockReceiptDetail): void {
  const totalUnits = receipt.lines.reduce((sum, line) => sum + line.quantity, 0);
  const summary: RecentSessionReceipt = {
    receiptId: receipt.receiptId,
    receiptNumber: receipt.receiptNumber,
    vendorName: receipt.vendorName,
    poId: receipt.poId,
    poNumber: receipt.poNumber,
    receivedDate: receipt.receivedDate,
    totalUnits,
  };
  recentReceipts = [
    summary,
    ...recentReceipts.filter((item) => item.receiptId !== receipt.receiptId),
  ].slice(0, 10);
  notifyListeners();
}

export function clearSessionReceipts(): void {
  recentReceipts = [];
  notifyListeners();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): readonly RecentSessionReceipt[] {
  return recentReceipts;
}

export function useRecentSessionReceipts(): readonly RecentSessionReceipt[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
