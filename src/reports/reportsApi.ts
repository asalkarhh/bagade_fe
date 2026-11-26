import { apiClient, type ApiClient } from '../api/client.ts';
import type {
  CollectionsReport,
  CollectionsReportParams,
  SalesReport,
  SalesReportParams,
  StockAgeingParams,
  StockAgeingReport,
  StockAuditReport,
  StockAuditReportParams,
  VendorReport,
  VendorReportParams,
} from './types.ts';

function normalizeOptional(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export interface ReportsApi {
  getSalesReport(params: SalesReportParams, signal?: AbortSignal): Promise<SalesReport>;
  getVendorReport(params: VendorReportParams, signal?: AbortSignal): Promise<VendorReport>;
  getStockAgeingReport(params: StockAgeingParams, signal?: AbortSignal): Promise<StockAgeingReport>;
  getCollectionsReport(
    params: CollectionsReportParams,
    signal?: AbortSignal,
  ): Promise<CollectionsReport>;
  getStockAuditReport(
    params: StockAuditReportParams,
    signal?: AbortSignal,
  ): Promise<StockAuditReport>;
}

export function createReportsApi(client: ApiClient = apiClient): ReportsApi {
  return {
    async getSalesReport(params: SalesReportParams, signal?: AbortSignal): Promise<SalesReport> {
      return client.get<SalesReport>('/reports/sales', {
        query: {
          from: params.from.trim(),
          to: params.to.trim(),
          categoryId: normalizeOptional(params.categoryId),
          skuId: normalizeOptional(params.skuId),
          minPrice: normalizeOptional(params.minPrice),
          maxPrice: normalizeOptional(params.maxPrice),
          page: params.page,
          size: params.size,
        },
        signal,
      });
    },

    async getVendorReport(params: VendorReportParams, signal?: AbortSignal): Promise<VendorReport> {
      return client.get<VendorReport>('/reports/vendors', {
        query: {
          from: params.from.trim(),
          to: params.to.trim(),
          snapshotDate: normalizeOptional(params.snapshotDate),
          vendorId: normalizeOptional(params.vendorId),
          categoryId: normalizeOptional(params.categoryId),
          page: params.page,
          size: params.size,
        },
        signal,
      });
    },

    async getStockAgeingReport(
      params: StockAgeingParams,
      signal?: AbortSignal,
    ): Promise<StockAgeingReport> {
      return client.get<StockAgeingReport>('/reports/stock-ageing', {
        query: {
          categoryId: normalizeOptional(params.categoryId),
          skuId: normalizeOptional(params.skuId),
          vendorId: normalizeOptional(params.vendorId),
          page: params.page,
          size: params.size,
        },
        signal,
      });
    },

    async getCollectionsReport(
      params: CollectionsReportParams,
      signal?: AbortSignal,
    ): Promise<CollectionsReport> {
      return client.get<CollectionsReport>('/reports/collections', {
        query: {
          from: params.from.trim(),
          to: params.to.trim(),
          customerId: normalizeOptional(params.customerId),
          page: params.page,
          size: params.size,
        },
        signal,
      });
    },

    async getStockAuditReport(
      params: StockAuditReportParams,
      signal?: AbortSignal,
    ): Promise<StockAuditReport> {
      return client.get<StockAuditReport>('/reports/stock-audits', {
        query: {
          from: params.from.trim(),
          to: params.to.trim(),
          categoryId: normalizeOptional(params.categoryId),
          skuId: normalizeOptional(params.skuId),
          page: params.page,
          size: params.size,
        },
        signal,
      });
    },
  };
}

export const reportsApi = createReportsApi();
