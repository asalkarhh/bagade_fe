import { apiClient, type ApiClient, type BlobDownloadResponse } from '../api/client.ts';
import type { PagedResponse } from '../catalog/types.ts';
import type {
  BillDetail,
  BillLineInput,
  BillPreviewResponse,
  BillPrintData,
  BillSearchParams,
  BillSummary,
  CancelBillInput,
  CancelBillResponse,
  CollectBillPaymentInput,
  CollectBillPaymentResponse,
  CreateBillInput,
  CreateBillResponse,
  CreateCustomerInput,
  Customer,
  CustomerSearchParams,
  EditBillLineInput,
  EditBillResponse,
  ExchangeBillInput,
  ExchangeBillResponse,
  ReturnBillInput,
  ReturnBillResponse,
  ReviseBillInput,
  SettlementEntryInput,
} from './types.ts';

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function serializeBillLines(lines: (BillLineInput | EditBillLineInput)[]): Record<string, unknown>[] {
  return lines.map((line) => {
    const out: Record<string, unknown> = {
      skuId: line.skuId,
      quantity: line.quantity,
    };
    if ('lineId' in line && line.lineId) {
      out.lineId = line.lineId;
    }
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

function serializeSettlementEntries(
  settlement?: SettlementEntryInput[],
): Record<string, unknown>[] {
  if (!settlement || settlement.length === 0) {
    return [];
  }
  return settlement.map((entry) => {
    const ref = normalizeOptionalText(entry.reference);
    return {
      direction: entry.direction,
      mode: entry.mode,
      amount: entry.amount.trim(),
      ...(ref !== null ? { reference: ref } : {}),
    };
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
  reviseBill(
    billId: string,
    input: ReviseBillInput,
    idempotencyKey: string,
  ): Promise<EditBillResponse>;
  returnItems(
    billId: string,
    input: ReturnBillInput,
    idempotencyKey: string,
  ): Promise<ReturnBillResponse>;
  exchangeItems(
    billId: string,
    input: ExchangeBillInput,
    idempotencyKey: string,
  ): Promise<ExchangeBillResponse>;
  cancelBill(
    billId: string,
    input: CancelBillInput,
    idempotencyKey: string,
  ): Promise<CancelBillResponse>;
  collectPayment(
    billId: string,
    input: CollectBillPaymentInput,
    idempotencyKey: string,
  ): Promise<CollectBillPaymentResponse>;
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

    async reviseBill(
      billId: string,
      input: ReviseBillInput,
      idempotencyKey: string,
    ): Promise<EditBillResponse> {
      const settlement = serializeSettlementEntries(input.settlement);
      return client.post<EditBillResponse>(
        `/bills/${encodeURIComponent(billId)}/revisions`,
        {
          expectedVersion: input.expectedVersion,
          reason: input.reason.trim(),
          lines: serializeBillLines(input.lines),
          expectedTotal: input.expectedTotal.trim(),
          settlement,
        },
        {
          headers: {
            'Idempotency-Key': idempotencyKey,
          },
        },
      );
    },

    async returnItems(
      billId: string,
      input: ReturnBillInput,
      idempotencyKey: string,
    ): Promise<ReturnBillResponse> {
      const settlement = serializeSettlementEntries(input.settlement);
      return client.post<ReturnBillResponse>(
        `/bills/${encodeURIComponent(billId)}/returns`,
        {
          expectedVersion: input.expectedVersion,
          reason: input.reason.trim(),
          returnedLines: input.returnedLines.map((line) => ({
            lineId: line.lineId,
            quantity: line.quantity,
            disposition: line.disposition,
          })),
          settlement,
        },
        {
          headers: {
            'Idempotency-Key': idempotencyKey,
          },
        },
      );
    },

    async exchangeItems(
      billId: string,
      input: ExchangeBillInput,
      idempotencyKey: string,
    ): Promise<ExchangeBillResponse> {
      const settlement = serializeSettlementEntries(input.settlement);
      return client.post<ExchangeBillResponse>(
        `/bills/${encodeURIComponent(billId)}/exchanges`,
        {
          expectedVersion: input.expectedVersion,
          reason: input.reason.trim(),
          returnedLines: input.returnedLines.map((line) => ({
            lineId: line.lineId,
            quantity: line.quantity,
            disposition: line.disposition,
          })),
          replacementLines: serializeBillLines(input.replacementLines),
          settlement,
        },
        {
          headers: {
            'Idempotency-Key': idempotencyKey,
          },
        },
      );
    },

    async cancelBill(
      billId: string,
      input: CancelBillInput,
      idempotencyKey: string,
    ): Promise<CancelBillResponse> {
      const settlement = serializeSettlementEntries(input.settlement);
      return client.post<CancelBillResponse>(
        `/bills/${encodeURIComponent(billId)}/cancellations`,
        {
          expectedVersion: input.expectedVersion,
          reason: input.reason.trim(),
          settlement,
        },
        {
          headers: {
            'Idempotency-Key': idempotencyKey,
          },
        },
      );
    },

    async collectPayment(
      billId: string,
      input: CollectBillPaymentInput,
      idempotencyKey: string,
    ): Promise<CollectBillPaymentResponse> {
      const ref = normalizeOptionalText(input.reference);
      return client.post<CollectBillPaymentResponse>(
        `/bills/${encodeURIComponent(billId)}/payments`,
        {
          expectedVersion: input.expectedVersion,
          mode: input.mode,
          amount: input.amount.trim(),
          ...(ref !== null ? { reference: ref } : {}),
        },
        {
          headers: {
            'Idempotency-Key': idempotencyKey,
          },
        },
      );
    },
  };
}

export const billingApi = createBillingApi();
