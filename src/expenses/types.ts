import type { PaymentMode } from '../billing/types.ts';

export const OPERATING_EXPENSE_CATEGORY_SUGGESTIONS = [
  'Rent',
  'Electricity',
  'Staff Tea & Snacks',
  'Transport & Freight',
  'Packing Material',
  'Alteration & Tailoring',
  'Shop Maintenance',
  'Internet & Phone',
  'Stationery',
] as const;

export interface Expense {
  expenseId: string;
  expenseDate: string;
  category: string;
  amount: string;
  paymentMode: PaymentMode;
  notes: string | null;
  version: number;
}

export interface ExpenseSearchParams {
  from?: string;
  to?: string;
  category?: string;
  page: number;
  size: number;
}

export interface CreateExpenseInput {
  expenseDate: string;
  category: string;
  amount: string;
  paymentMode: PaymentMode;
  notes?: string | null;
}

export interface UpdateExpenseInput {
  expectedVersion: number;
  expenseDate?: string;
  category?: string;
  amount?: string;
  paymentMode?: PaymentMode;
  notes?: string | null;
}
