import { apiClient, type ApiClient } from '../api/client.ts';
import type { PagedResponse } from '../catalog/types.ts';
import type {
  CancelPurchaseOrderRemainderInput,
  CreatePurchaseOrderInput,
  CreateVendorInput,
  PurchaseOrderDetail,
  PurchaseOrderListItem,
  PurchaseOrderSearchParams,
  Vendor,
  VendorSearchParams,
} from './types.ts';

const MAX_PAGE_SIZE = 100;

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface PurchasingApi {
  listVendors(params: VendorSearchParams, signal?: AbortSignal): Promise<PagedResponse<Vendor>>;
  listAllVendors(signal?: AbortSignal): Promise<Vendor[]>;
  createVendor(input: CreateVendorInput): Promise<Vendor>;
  listPurchaseOrders(
    params: PurchaseOrderSearchParams,
    signal?: AbortSignal,
  ): Promise<PagedResponse<PurchaseOrderListItem>>;
  getPurchaseOrder(poId: string, signal?: AbortSignal): Promise<PurchaseOrderDetail>;
  createPurchaseOrder(input: CreatePurchaseOrderInput): Promise<PurchaseOrderDetail>;
  cancelPurchaseOrderRemainder(
    poId: string,
    input: CancelPurchaseOrderRemainderInput,
    idempotencyKey: string,
  ): Promise<PurchaseOrderDetail>;
}

export function createPurchasingApi(client: ApiClient = apiClient): PurchasingApi {
  return {
    async listVendors(
      params: VendorSearchParams,
      signal?: AbortSignal,
    ): Promise<PagedResponse<Vendor>> {
      const trimmedQ = params.q?.trim();
      const activeParam =
        params.status === 'ACTIVE' ? true : params.status === 'INACTIVE' ? false : undefined;

      return client.get<PagedResponse<Vendor>>('/vendors', {
        query: {
          q: trimmedQ || undefined,
          active: activeParam,
          page: params.page,
          size: params.size,
        },
        signal,
      });
    },

    async listAllVendors(signal?: AbortSignal): Promise<Vendor[]> {
      const firstPage = await client.get<PagedResponse<Vendor>>('/vendors', {
        query: { page: 0, size: MAX_PAGE_SIZE },
        signal,
      });
      const all = [...firstPage.items];
      const totalPages = Math.ceil(firstPage.total / Math.max(firstPage.size, 1));

      for (let page = 1; page < totalPages; page += 1) {
        const next = await client.get<PagedResponse<Vendor>>('/vendors', {
          query: { page, size: MAX_PAGE_SIZE },
          signal,
        });
        if (next.items.length === 0) {
          break;
        }
        all.push(...next.items);
      }

      return all;
    },

    async createVendor(input: CreateVendorInput): Promise<Vendor> {
      return client.post<Vendor>('/vendors', {
        name: input.name.trim(),
        contact: normalizeOptionalText(input.contact),
      });
    },

    async listPurchaseOrders(
      params: PurchaseOrderSearchParams,
      signal?: AbortSignal,
    ): Promise<PagedResponse<PurchaseOrderListItem>> {
      return client.get<PagedResponse<PurchaseOrderListItem>>('/purchase-orders', {
        query: {
          vendorId: params.vendorId || undefined,
          status: params.status || undefined,
          from: params.from?.trim() || undefined,
          to: params.to?.trim() || undefined,
          page: params.page,
          size: params.size,
        },
        signal,
      });
    },

    async getPurchaseOrder(poId: string, signal?: AbortSignal): Promise<PurchaseOrderDetail> {
      return client.get<PurchaseOrderDetail>(
        `/purchase-orders/${encodeURIComponent(poId)}`,
        { signal },
      );
    },

    async createPurchaseOrder(input: CreatePurchaseOrderInput): Promise<PurchaseOrderDetail> {
      return client.post<PurchaseOrderDetail>('/purchase-orders', {
        vendorId: input.vendorId,
        orderDate: input.orderDate.trim(),
        lines: input.lines.map((line) => ({
          skuId: line.skuId,
          orderedQuantity: line.orderedQuantity,
          agreedUnitCost:
            line.agreedUnitCost !== undefined && line.agreedUnitCost !== null
              ? line.agreedUnitCost.trim()
              : null,
        })),
      });
    },

    async cancelPurchaseOrderRemainder(
      poId: string,
      input: CancelPurchaseOrderRemainderInput,
      idempotencyKey: string,
    ): Promise<PurchaseOrderDetail> {
      const body: Record<string, unknown> = {
        expectedVersion: input.expectedVersion,
        reason: input.reason.trim(),
      };
      if (input.poLineIds && input.poLineIds.length > 0) {
        body.poLineIds = input.poLineIds;
      }

      return client.post<PurchaseOrderDetail>(
        `/purchase-orders/${encodeURIComponent(poId)}/cancel-remainder`,
        body,
        {
          headers: {
            'Idempotency-Key': idempotencyKey,
          },
        },
      );
    },
  };
}

export const purchasingApi = createPurchasingApi();
