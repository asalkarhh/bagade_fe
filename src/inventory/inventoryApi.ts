import { apiClient, type ApiClient } from '../api/client.ts';
import type { PagedResponse } from '../catalog/types.ts';
import type {
  BarcodeLookupResult,
  BarcodeMappingResult,
  BatchLabel,
  CreateStockCountInput,
  CreateStockCountResponse,
  CreateStockReceiptInput,
  InventoryItem,
  InventorySearchParams,
  PostStockCountInput,
  PostStockCountResponse,
  RegisterBarcodeInput,
  SaveStockCountLineInput,
  SaveStockCountLineResponse,
  StockCountDetail,
  StockReceiptDetail,
} from './types.ts';

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface InventoryApi {
  createStockReceipt(
    input: CreateStockReceiptInput,
    idempotencyKey: string,
  ): Promise<StockReceiptDetail>;
  getStockReceipt(receiptId: string, signal?: AbortSignal): Promise<StockReceiptDetail>;
  lookupBarcode(code: string, signal?: AbortSignal): Promise<BarcodeLookupResult>;
  registerBarcode(input: RegisterBarcodeInput): Promise<BarcodeMappingResult>;
  generateBatchLabel(batchId: string): Promise<BatchLabel>;
  getBatchLabel(batchId: string, signal?: AbortSignal): Promise<BatchLabel>;
  listInventory(
    params: InventorySearchParams,
    signal?: AbortSignal,
  ): Promise<PagedResponse<InventoryItem>>;
  createStockCount(input: CreateStockCountInput): Promise<CreateStockCountResponse>;
  getStockCount(countId: string, signal?: AbortSignal): Promise<StockCountDetail>;
  saveStockCountLine(
    countId: string,
    skuId: string,
    input: SaveStockCountLineInput,
  ): Promise<SaveStockCountLineResponse>;
  postStockCount(
    countId: string,
    input: PostStockCountInput,
    idempotencyKey: string,
  ): Promise<PostStockCountResponse>;
}

export function createInventoryApi(client: ApiClient = apiClient): InventoryApi {
  return {
    async createStockReceipt(
      input: CreateStockReceiptInput,
      idempotencyKey: string,
    ): Promise<StockReceiptDetail> {
      const normalizedInvoice = normalizeOptionalString(input.vendorInvoiceRef);
      const body: Record<string, unknown> = {
        vendorId: input.vendorId,
        receivedDate: input.receivedDate.trim(),
        lines: input.lines.map((line) => {
          const linePayload: Record<string, unknown> = {
            skuId: line.skuId,
            quantity: line.quantity,
            unitCost: line.unitCost.trim(),
            generateInternalTag: Boolean(line.generateInternalTag),
          };
          const trimmedMrp = normalizeOptionalString(line.printedMrp);
          if (trimmedMrp !== null) {
            linePayload.printedMrp = trimmedMrp;
          }
          if (input.poId && line.poLineId) {
            linePayload.poLineId = line.poLineId;
          }
          return linePayload;
        }),
      };

      if (input.poId) {
        body.poId = input.poId;
      }
      if (normalizedInvoice !== null) {
        body.vendorInvoiceRef = normalizedInvoice;
      }

      return client.post<StockReceiptDetail>('/stock-receipts', body, {
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      });
    },

    async getStockReceipt(receiptId: string, signal?: AbortSignal): Promise<StockReceiptDetail> {
      return client.get<StockReceiptDetail>(
        `/stock-receipts/${encodeURIComponent(receiptId)}`,
        { signal },
      );
    },

    async lookupBarcode(code: string, signal?: AbortSignal): Promise<BarcodeLookupResult> {
      return client.get<BarcodeLookupResult>('/barcodes/lookup', {
        query: {
          code: code.trim(),
        },
        signal,
      });
    },

    async registerBarcode(input: RegisterBarcodeInput): Promise<BarcodeMappingResult> {
      return client.post<BarcodeMappingResult>('/barcodes', {
        code: input.code.trim(),
        skuId: input.skuId,
      });
    },

    async generateBatchLabel(batchId: string): Promise<BatchLabel> {
      return client.post<BatchLabel>(
        `/stock-batches/${encodeURIComponent(batchId)}/label`,
        {},
      );
    },

    async getBatchLabel(batchId: string, signal?: AbortSignal): Promise<BatchLabel> {
      return client.get<BatchLabel>(
        `/stock-batches/${encodeURIComponent(batchId)}/label`,
        { signal },
      );
    },

    async listInventory(
      params: InventorySearchParams,
      signal?: AbortSignal,
    ): Promise<PagedResponse<InventoryItem>> {
      const trimmedQ = params.q?.trim();
      return client.get<PagedResponse<InventoryItem>>('/inventory', {
        query: {
          skuId: params.skuId || undefined,
          categoryId: params.categoryId || undefined,
          q: trimmedQ || undefined,
          page: params.page,
          size: params.size,
        },
        signal,
      });
    },

    async createStockCount(input: CreateStockCountInput): Promise<CreateStockCountResponse> {
      const body: Record<string, unknown> = {
        scope: input.scope,
      };
      if (input.scope === 'CATEGORY' && input.categoryId) {
        body.categoryId = input.categoryId;
      }
      return client.post<CreateStockCountResponse>('/stock-counts', body);
    },

    async getStockCount(countId: string, signal?: AbortSignal): Promise<StockCountDetail> {
      return client.get<StockCountDetail>(`/stock-counts/${encodeURIComponent(countId)}`, {
        signal,
      });
    },

    async saveStockCountLine(
      countId: string,
      skuId: string,
      input: SaveStockCountLineInput,
    ): Promise<SaveStockCountLineResponse> {
      const body: Record<string, unknown> = {
        expectedVersion: input.expectedVersion,
        countedQuantity: input.countedQuantity,
        observedStockVersion: input.observedStockVersion,
        reason: normalizeOptionalString(input.reason),
      };
      return client.put<SaveStockCountLineResponse>(
        `/stock-counts/${encodeURIComponent(countId)}/lines/${encodeURIComponent(skuId)}`,
        body,
      );
    },

    async postStockCount(
      countId: string,
      input: PostStockCountInput,
      idempotencyKey: string,
    ): Promise<PostStockCountResponse> {
      return client.post<PostStockCountResponse>(
        `/stock-counts/${encodeURIComponent(countId)}/post`,
        { expectedVersion: input.expectedVersion },
        {
          headers: {
            'Idempotency-Key': idempotencyKey,
          },
        },
      );
    },
  };
}

export const inventoryApi = createInventoryApi();
