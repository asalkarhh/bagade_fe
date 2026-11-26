import { useId, useState, type FormEvent } from 'react';
import { isApiClientError } from '../../api/errors.ts';
import type { PaymentMode } from '../../billing/types.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { formatInrDisplay, normalizeInrPriceInput, parseInrToPaise } from '../../utils/inrPrice.ts';
import { getShopLocalDateIso, isValidIsoDate } from '../../utils/shopDate.ts';
import type { ExpensesApi } from '../expensesApi.ts';
import {
  OPERATING_EXPENSE_CATEGORY_SUGGESTIONS,
  type Expense,
  type UpdateExpenseInput,
} from '../types.ts';
import '../../catalog/ProductsPage.css';

export interface ExpenseFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  expense: Expense | null;
  api: ExpensesApi;
  categorySuggestions?: readonly string[];
  onClose: () => void;
  onSaved: (expense: Expense, mode: 'create' | 'edit') => void;
  onRefreshList: () => Promise<readonly Expense[]>;
}

interface FormFieldErrors {
  expenseDate?: string;
  category?: string;
  amount?: string;
  notes?: string;
}

export function ExpenseFormModal({
  open,
  mode,
  expense,
  api,
  categorySuggestions = OPERATING_EXPENSE_CATEGORY_SUGGESTIONS,
  onClose,
  onSaved,
  onRefreshList,
}: ExpenseFormModalProps) {
  const dateInputId = useId();
  const categoryInputId = useId();
  const categoryListId = useId();
  const amountInputId = useId();
  const notesInputId = useId();

  const [expenseDate, setExpenseDate] = useState(() =>
    mode === 'edit' && expense ? expense.expenseDate : getShopLocalDateIso(),
  );
  const [category, setCategory] = useState(() => (mode === 'edit' && expense ? expense.category : ''));
  const [amount, setAmount] = useState(() => (mode === 'edit' && expense ? expense.amount : ''));
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(() =>
    mode === 'edit' && expense ? expense.paymentMode : 'CASH',
  );
  const [notes, setNotes] = useState(() =>
    mode === 'edit' && expense ? (expense.notes ?? '') : '',
  );

  const [fieldErrors, setFieldErrors] = useState<FormFieldErrors>({});
  const [formError, setFormError] = useState<{
    tone: 'error' | 'warning';
    message: string;
    requestId?: string | null;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // When PATCH returns 409 STALE_VERSION, keep user's draft inputs and store refreshed server record here.
  const [staleServerExpense, setStaleServerExpense] = useState<Expense | null>(null);

  const activeServerBaseline = staleServerExpense ?? expense;

  const mergedCategoryOptions = Array.from(
    new Set([...OPERATING_EXPENSE_CATEGORY_SUGGESTIONS, ...categorySuggestions]),
  );

  const validateInputs = () => {
    const errors: FormFieldErrors = {};
    const trimmedDate = expenseDate.trim();
    const trimmedCategory = category.trim();
    const trimmedNotes = notes.trim();

    if (!isValidIsoDate(trimmedDate)) {
      errors.expenseDate = 'Choose a valid expense date (YYYY-MM-DD).';
    }
    if (!trimmedCategory) {
      errors.category = 'Enter an operating expense category.';
    } else if (trimmedCategory.length > 100) {
      errors.category = 'Category must not exceed 100 characters.';
    }

    const priceResult = normalizeInrPriceInput(amount);
    if (!priceResult.ok) {
      errors.amount = priceResult.error;
    } else {
      const paise = parseInrToPaise(priceResult.value);
      if (paise === null || paise <= 0) {
        errors.amount = 'Expense amount must be greater than ₹0.00.';
      }
    }

    if (trimmedNotes.length > 500) {
      errors.notes = 'Notes must not exceed 500 characters.';
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || !priceResult.ok) {
      return null;
    }

    return {
      expenseDate: trimmedDate,
      category: trimmedCategory,
      amount: priceResult.value,
      paymentMode,
      notes: trimmedNotes,
    };
  };

  const applyServerValues = (serverRow: Expense) => {
    setExpenseDate(serverRow.expenseDate);
    setCategory(serverRow.category);
    setAmount(serverRow.amount);
    setPaymentMode(serverRow.paymentMode);
    setNotes(serverRow.notes ?? '');
    setFieldErrors({});
    setFormError(null);
    setStaleServerExpense(serverRow);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const validated = validateInputs();
    if (!validated) {
      return;
    }

    setSubmitting(true);

    if (mode === 'create') {
      try {
        const created = await api.createExpense({
          expenseDate: validated.expenseDate,
          category: validated.category,
          amount: validated.amount,
          paymentMode: validated.paymentMode,
          notes: validated.notes || null,
        });
        onSaved(created, 'create');
      } catch (err) {
        if (
          isApiClientError(err) &&
          (err.kind === 'network' || err.kind === 'server' || err.retryable)
        ) {
          setFormError({
            tone: 'warning',
            message:
              'Connection interrupted while saving this expense. Because expense creation does not use an idempotency key, check the Expenses list before resubmitting to avoid a duplicate entry.',
            requestId: err.requestId,
          });
        } else if (isApiClientError(err)) {
          if (err.fieldErrors.length > 0) {
            const serverFieldErrors: FormFieldErrors = {};
            for (const item of err.fieldErrors) {
              if (item.field === 'expenseDate') serverFieldErrors.expenseDate = item.message;
              if (item.field === 'category') serverFieldErrors.category = item.message;
              if (item.field === 'amount') serverFieldErrors.amount = item.message;
              if (item.field === 'notes') serverFieldErrors.notes = item.message;
            }
            setFieldErrors(serverFieldErrors);
          }
          setFormError({
            tone: 'error',
            message: err.message,
            requestId: err.requestId,
          });
        } else {
          setFormError({
            tone: 'warning',
            message:
              'Unable to confirm whether this expense was saved. Check the Expenses list before trying again.',
          });
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!activeServerBaseline) {
      setSubmitting(false);
      return;
    }

    const patchPayload: UpdateExpenseInput = {
      expectedVersion: activeServerBaseline.version,
    };
    if (validated.expenseDate !== activeServerBaseline.expenseDate) {
      patchPayload.expenseDate = validated.expenseDate;
    }
    if (validated.category !== activeServerBaseline.category) {
      patchPayload.category = validated.category;
    }
    if (validated.amount !== activeServerBaseline.amount) {
      patchPayload.amount = validated.amount;
    }
    if (validated.paymentMode !== activeServerBaseline.paymentMode) {
      patchPayload.paymentMode = validated.paymentMode;
    }
    if (validated.notes !== (activeServerBaseline.notes ?? '')) {
      patchPayload.notes = validated.notes;
    }

    const hasChanges =
      patchPayload.expenseDate !== undefined ||
      patchPayload.category !== undefined ||
      patchPayload.amount !== undefined ||
      patchPayload.paymentMode !== undefined ||
      patchPayload.notes !== undefined;

    if (!hasChanges) {
      setFormError({
        tone: 'error',
        message: 'Update at least one field (date, category, amount, payment mode, or notes) before saving.',
      });
      setSubmitting(false);
      return;
    }

    try {
      const updated = await api.updateExpense(activeServerBaseline.expenseId, patchPayload);
      onSaved(updated, 'edit');
    } catch (err) {
      if (isApiClientError(err) && err.code === 'STALE_VERSION') {
        try {
          const refreshedList = await onRefreshList();
          const latestRow =
            refreshedList.find((item) => item.expenseId === activeServerBaseline.expenseId) ?? null;
          setStaleServerExpense(latestRow);
          setFormError({
            tone: 'warning',
            message: latestRow
              ? `Someone else updated this expense to v${latestRow.version} (${latestRow.expenseDate}, ${latestRow.category}, ${formatInrDisplay(latestRow.amount)}, ${latestRow.paymentMode}). Your draft edits have been kept—review and click Save Changes to overwrite.`
              : 'This expense was modified by another request. Latest list values were reloaded; review before saving again.',
            requestId: err.requestId,
          });
        } catch {
          setFormError({
            tone: 'warning',
            message:
              'This expense was updated elsewhere. Refresh the expenses list and review before saving again.',
            requestId: err.requestId,
          });
        }
      } else if (isApiClientError(err)) {
        if (err.fieldErrors.length > 0) {
          const serverFieldErrors: FormFieldErrors = {};
          for (const item of err.fieldErrors) {
            if (item.field === 'expenseDate') serverFieldErrors.expenseDate = item.message;
            if (item.field === 'category') serverFieldErrors.category = item.message;
            if (item.field === 'amount') serverFieldErrors.amount = item.message;
            if (item.field === 'notes') serverFieldErrors.notes = item.message;
          }
          setFieldErrors(serverFieldErrors);
        }
        setFormError({
          tone: 'error',
          message: err.message,
          requestId: err.requestId,
        });
      } else {
        setFormError({
          tone: 'error',
          message: 'Unable to update expense right now. Please try again.',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      title={mode === 'create' ? 'Record Operating Expense' : 'Edit Operating Expense'}
      onClose={onClose}
      preventClose={submitting}
    >
      <form className="catalog-modal-form" onSubmit={handleSubmit} noValidate>
        <p className="catalog-field-hint">
          Log day-to-day shop operating costs (rent, electricity, transport, tea, repairs). Record
          vendor merchandise purchases under Purchases / Stock Receipts instead.
        </p>

        <div className="catalog-field">
          <label htmlFor={dateInputId} className="catalog-label">
            Expense Date
          </label>
          <input
            id={dateInputId}
            type="date"
            className="catalog-input"
            value={expenseDate}
            disabled={submitting}
            aria-invalid={fieldErrors.expenseDate ? 'true' : undefined}
            onChange={(event) => {
              setExpenseDate(event.target.value);
              setFieldErrors((prev) => ({ ...prev, expenseDate: undefined }));
            }}
          />
          {fieldErrors.expenseDate ? (
            <p className="catalog-field-error" role="alert">
              {fieldErrors.expenseDate}
            </p>
          ) : null}
        </div>

        <div className="catalog-field">
          <label htmlFor={categoryInputId} className="catalog-label">
            Category
          </label>
          <input
            id={categoryInputId}
            type="text"
            list={categoryListId}
            className="catalog-input"
            value={category}
            disabled={submitting}
            placeholder="e.g. Rent, Electricity, Transport & Freight"
            aria-invalid={fieldErrors.category ? 'true' : undefined}
            onChange={(event) => {
              setCategory(event.target.value);
              setFieldErrors((prev) => ({ ...prev, category: undefined }));
            }}
          />
          <datalist id={categoryListId}>
            {mergedCategoryOptions.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
          {fieldErrors.category ? (
            <p className="catalog-field-error" role="alert">
              {fieldErrors.category}
            </p>
          ) : null}
        </div>

        <div className="catalog-field">
          <label htmlFor={amountInputId} className="catalog-label">
            Amount (INR)
          </label>
          <input
            id={amountInputId}
            type="text"
            inputMode="decimal"
            className="catalog-input"
            value={amount}
            disabled={submitting}
            placeholder="e.g. 2450.50"
            aria-invalid={fieldErrors.amount ? 'true' : undefined}
            onChange={(event) => {
              setAmount(event.target.value);
              setFieldErrors((prev) => ({ ...prev, amount: undefined }));
            }}
          />
          {fieldErrors.amount ? (
            <p className="catalog-field-error" role="alert">
              {fieldErrors.amount}
            </p>
          ) : null}
        </div>

        <fieldset className="catalog-status-fieldset">
          <legend>Payment Mode</legend>
          <div className="status-radio-group">
            {(['CASH', 'UPI'] as const).map((optionMode) => (
              <label key={optionMode} className="status-radio-option">
                <input
                  type="radio"
                  name="expensePaymentMode"
                  value={optionMode}
                  checked={paymentMode === optionMode}
                  disabled={submitting}
                  onChange={() => setPaymentMode(optionMode)}
                />
                {optionMode}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="catalog-field">
          <label htmlFor={notesInputId} className="catalog-label">
            Notes (optional)
          </label>
          <textarea
            id={notesInputId}
            className="catalog-input"
            rows={3}
            value={notes}
            disabled={submitting}
            placeholder="Optional description or receipt reference"
            aria-invalid={fieldErrors.notes ? 'true' : undefined}
            onChange={(event) => {
              setNotes(event.target.value);
              setFieldErrors((prev) => ({ ...prev, notes: undefined }));
            }}
          />
          {fieldErrors.notes ? (
            <p className="catalog-field-error" role="alert">
              {fieldErrors.notes}
            </p>
          ) : null}
        </div>

        {formError ? (
          <div
            className={`alert-banner ${
              formError.tone === 'warning' ? 'alert-banner--warning' : 'alert-banner--error'
            }`}
            role="alert"
          >
            <div className="alert-banner__content">
              <p>{formError.message}</p>
              {formError.requestId ? (
                <p className="alert-banner__meta">Request ID: {formError.requestId}</p>
              ) : null}
              {formError.tone === 'warning' && mode === 'create' ? (
                <div className="alert-banner__actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={submitting}
                    onClick={() => {
                      void onRefreshList().finally(() => onClose());
                    }}
                  >
                    Check Expenses List
                  </button>
                </div>
              ) : null}
              {staleServerExpense && mode === 'edit' ? (
                <div className="alert-banner__actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={submitting}
                    onClick={() => applyServerValues(staleServerExpense)}
                  >
                    Use Server Values
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="catalog-modal-actions">
          <button type="button" className="btn-secondary" disabled={submitting} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting
              ? 'Saving…'
              : mode === 'create'
                ? 'Save Expense'
                : 'Save Changes'}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
