import { apiClient, type ApiClient } from '../api/client.ts';
import type { PagedResponse } from '../catalog/types.ts';
import type {
  CreateExpenseInput,
  Expense,
  ExpenseSearchParams,
  UpdateExpenseInput,
} from './types.ts';

function normalizeOptionalNotes(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface ExpensesApi {
  listExpenses(
    params: ExpenseSearchParams,
    signal?: AbortSignal,
  ): Promise<PagedResponse<Expense>>;
  createExpense(input: CreateExpenseInput): Promise<Expense>;
  updateExpense(expenseId: string, input: UpdateExpenseInput): Promise<Expense>;
}

export function createExpensesApi(client: ApiClient = apiClient): ExpensesApi {
  return {
    async listExpenses(
      params: ExpenseSearchParams,
      signal?: AbortSignal,
    ): Promise<PagedResponse<Expense>> {
      const trimmedFrom = params.from?.trim();
      const trimmedTo = params.to?.trim();
      const trimmedCategory = params.category?.trim();

      return client.get<PagedResponse<Expense>>('/expenses', {
        query: {
          from: trimmedFrom || undefined,
          to: trimmedTo || undefined,
          category: trimmedCategory || undefined,
          page: params.page,
          size: params.size,
        },
        signal,
      });
    },

    async createExpense(input: CreateExpenseInput): Promise<Expense> {
      const normalizedNotes = normalizeOptionalNotes(input.notes);
      const body: Record<string, unknown> = {
        expenseDate: input.expenseDate.trim(),
        category: input.category.trim(),
        amount: input.amount.trim(),
        paymentMode: input.paymentMode,
      };
      if (normalizedNotes !== null) {
        body.notes = normalizedNotes;
      }
      return client.post<Expense>('/expenses', body);
    },

    async updateExpense(expenseId: string, input: UpdateExpenseInput): Promise<Expense> {
      const body: Record<string, unknown> = {
        expectedVersion: input.expectedVersion,
      };
      if (input.expenseDate !== undefined) {
        body.expenseDate = input.expenseDate.trim();
      }
      if (input.category !== undefined) {
        body.category = input.category.trim();
      }
      if (input.amount !== undefined) {
        body.amount = input.amount.trim();
      }
      if (input.paymentMode !== undefined) {
        body.paymentMode = input.paymentMode;
      }
      if (input.notes !== undefined) {
        // Send empty string to clear existing notes on PATCH because backend treats null as omitted.
        body.notes = input.notes === null ? '' : input.notes.trim();
      }

      return client.patch<Expense>(
        `/expenses/${encodeURIComponent(expenseId)}`,
        body,
      );
    },
  };
}

export const expensesApi = createExpensesApi();
