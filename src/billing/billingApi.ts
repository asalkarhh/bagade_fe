import { apiClient, type ApiClient, type BlobDownloadResponse } from '../api/client.ts';
import type { PagedResponse } from '../catalog/types.ts';
import type {
  BillDetail,
  BillLineInput,
  BillPreviewResponse,
  BillPrintData,
  BillSearchParams,
  BillSummary,
  CreateBillInput,
  CreateBillResponse,
  CreateCustomerInput,
  Customer,
  CustomerSearchParams,
} from './types.ts';

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function serializeBillLines(lines: BillLineInput[]): Record<string, unknown>[] {
  return lines.map((line) => {
    const out: Record<string, unknown> = {
      skuId: line.skuId,
      quantity: line.quantity,
    };
    if (line.batchId) {
      out.batchId = line.batchId;
    }
    const discount = normalizeOptionalText(line.discountAmount);
    if (discount !== null) {
      out.discountAmount = discount;
    }
    const override = normalizeOptionalText(line.unitPriceOverride);
    if (override !== null) {
      out.unitPriceOverride = override;
    }
    return out;
  });
}

export interface BillingApi {
  listCustomers(
    params: CustomerSearchParams,
    signal?: AbortSignal,
  ): Promise<PagedResponse<Customer>>;
  createCustomer(input: CreateCustomerInput): Promise<Customer>;
  previewBill(lines: BillLineInput[], signal?: AbortSignal): Promise<BillPreviewResponse>;
  createBill(input: CreateBillInput, idempotencyKey: string): Promise<CreateBillResponse>;
  listBills(params: BillSearchParams, signal?: AbortSignal): Promise<PagedResponse<BillSummary>>;
  getBill(billId: string, signal?: AbortSignal): Promise<BillDetail>;
  getBillPrintData(
    billId: string,
    revision?: number | null,
    signal?: AbortSignal,
  ): Promise<BillPrintData>;
  downloadBillPdf(
    billId: string,
    revision?: number | null,
    signal?: AbortSignal,
  ): Promise<BlobDownloadResponse>;
}

export function createBillingApi(client: ApiClient = apiClient): BillingApi {
  return {
    async listCustomers(
      params: CustomerSearchParams,
      signal?: AbortSignal,
    ): Promise<PagedResponse<Customer>> {
      return client.get<PagedResponse<Customer>>('/customers', {
        query: {
          q: params.q?.trim() || undefined,
          page: params.page,
          size: params.size,
        },
        signal,
      });
    },

    async createCustomer(input: CreateCustomerInput): Promise<Customer> {
      const contact = normalizeOptionalText(input.contact);
      return client.post<Customer>('/customers', {
        name: input.name.trim(),
        ...(contact !== null ? { contact } : {}),
      });
    },

    async previewBill(
      lines: BillLineInput[],
      signal?: AbortSignal,
    ): Promise<BillPreviewResponse> {
      return client.post<BillPreviewResponse>(
        '/bills/preview',
        { lines: serializeBillLines(lines) },
        { signal },
      );
    },

    async createBill(
      input: CreateBillInput,
      idempotencyKey: string,
    ): Promise<CreateBillResponse> {
      const body: Record<string, unknown> = {
        lines: serializeBillLines(input.lines),
        expectedTotal: input.expectedTotal.trim(),
        payments: input.payments.map((payment) => {
          const ref = normalizeOptionalText(payment.reference);
          return {
            mode: payment.mode,
            amount: payment.amount.trim(),
            ...(ref !== null ? { reference: ref } : {}),
          };
        }),
      };

      if (input.customerId) {
        body.customerId = input.customerId;
      }

      return client.post<CreateBillResponse>('/bills', body, {
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      });
    },

    async listBills(
      params: BillSearchParams,
      signal?: AbortSignal,
    ): Promise<PagedResponse<BillSummary>> {
      return client.get<PagedResponse<BillSummary>>('/bills', {
        query: {
          billNumber: params.billNumber?.trim() || undefined,
          from: params.from?.trim() || undefined,
          to: params.to?.trim() || undefined,
          customerId: params.customerId || undefined,
          page: params.page,
          size: params.size,
        },
        signal,
      });
    },

    async getBill(billId: string, signal?: AbortSignal): Promise<BillDetail> {
      return client.get<BillDetail>(`/bills/${encodeURIComponent(billId)}`, { signal });
    },

    async getBillPrintData(
      billId: string,
      revision?: number | null,
      signal?: AbortSignal,
    ): Promise<BillPrintData> {
      return client.get<BillPrintData>(`/bills/${encodeURIComponent(billId)}/print`, {
        query: {
          format: 'json',
          revision: revision !== undefined && revision !== null ? revision : undefined,
        },
        signal,
      });
    },

    async downloadBillPdf(
      billId: string,
      revision?: number | null,
      signal?: AbortSignal,
    ): Promise<BlobDownloadResponse> {
      return client.getBlob(`/bills/${encodeURIComponent(billId)}/print`, {
        query: {
          format: 'pdf',
          revision: revision !== undefined && revision !== null ? revision : undefined,
        },
        signal,
      });
    },
  };
}

export const billingApi = createBillingApi();
