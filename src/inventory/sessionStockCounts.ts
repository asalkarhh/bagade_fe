import { useSyncExternalStore } from 'react';
import type { StockCountDetail, StockCountScope, StockCountStatus } from './types.ts';

export interface RecentSessionStockCount {
  countId: string;
  scope: StockCountScope;
  categoryId: string | null;
  categoryLabel: string | null;
  status: StockCountStatus;
  version: number;
  totalSkus: number;
  countedSkus: number;
  createdAt: string;
  postedAt: string | null;
}

let recentStockCounts: RecentSessionStockCount[] = [];
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

export function recordSessionStockCount(
  detail: Pick<
    StockCountDetail,
    'countId' | 'scope' | 'categoryId' | 'status' | 'version' | 'createdAt' | 'postedAt' | 'lines'
  >,
  categoryLabel?: string | null,
): void {
  const existing = recentStockCounts.find((item) => item.countId === detail.countId);
  const summary: RecentSessionStockCount = {
    countId: detail.countId,
    scope: detail.scope,
    categoryId: detail.categoryId,
    categoryLabel: categoryLabel ?? existing?.categoryLabel ?? null,
    status: detail.status,
    version: detail.version,
    totalSkus: detail.lines.length,
    countedSkus: detail.lines.filter((line) => line.countedQuantity !== null).length,
    createdAt: detail.createdAt,
    postedAt: detail.postedAt,
  };
  recentStockCounts = [
    summary,
    ...recentStockCounts.filter((item) => item.countId !== detail.countId),
  ].slice(0, 12);
  notifyListeners();
}

export function clearSessionStockCounts(): void {
  recentStockCounts = [];
  notifyListeners();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): readonly RecentSessionStockCount[] {
  return recentStockCounts;
}

export function useRecentSessionStockCounts(): readonly RecentSessionStockCount[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
