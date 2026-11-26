import { apiClient, type ApiClient } from '../api/client.ts';
import type {
  PurchasePlanningParams,
  PurchasePlanningResponse,
  PurchaseTargetResult,
  UpsertPurchaseTargetInput,
} from './types.ts';

function normalizeOptional(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export interface PlanningApi {
  getPurchasePlanning(
    params: PurchasePlanningParams,
    signal?: AbortSignal,
  ): Promise<PurchasePlanningResponse>;
  upsertPurchaseTarget(
    skuId: string,
    input: UpsertPurchaseTargetInput,
  ): Promise<PurchaseTargetResult>;
}

export function createPlanningApi(client: ApiClient = apiClient): PlanningApi {
  return {
    async getPurchasePlanning(
      params: PurchasePlanningParams,
      signal?: AbortSignal,
    ): Promise<PurchasePlanningResponse> {
      return client.get<PurchasePlanningResponse>('/purchase-planning', {
        query: {
          categoryId: normalizeOptional(params.categoryId),
          size: normalizeOptional(params.size),
          minPrice: normalizeOptional(params.minPrice),
          maxPrice: normalizeOptional(params.maxPrice),
          vendorId: normalizeOptional(params.vendorId),
          planningPeriod: normalizeOptional(params.planningPeriod),
          page: params.page,
          pageSize: params.pageSize,
        },
        signal,
      });
    },

    async upsertPurchaseTarget(
      skuId: string,
      input: UpsertPurchaseTargetInput,
    ): Promise<PurchaseTargetResult> {
      const normalizedPeriod = normalizeOptional(input.planningPeriod);
      const body: Record<string, unknown> = {
        targetQuantity: input.targetQuantity,
      };
      if (normalizedPeriod !== undefined) {
        body.planningPeriod = normalizedPeriod;
      }

      return client.put<PurchaseTargetResult>(
        `/purchase-targets/${encodeURIComponent(skuId)}`,
        body,
      );
    },
  };
}

export const planningApi = createPlanningApi();
