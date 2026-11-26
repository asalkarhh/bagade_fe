import { useId, useState, type FormEvent } from 'react';
import { isApiClientError } from '../../api/errors.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import type { PlanningApi } from '../planningApi.ts';
import type { PurchasePlanningItem, PurchaseTargetResult } from '../types.ts';
import '../../catalog/ProductsPage.css';

export interface PurchaseTargetModalProps {
  open: boolean;
  item: PurchasePlanningItem;
  activePlanningPeriod: string;
  api: PlanningApi;
  onClose: () => void;
  onSaved: (result: PurchaseTargetResult, item: PurchasePlanningItem) => void;
}

const WHOLE_NUMBER_PATTERN = /^\d+$/;

export function PurchaseTargetModal({
  open,
  item,
  activePlanningPeriod,
  api,
  onClose,
  onSaved,
}: PurchaseTargetModalProps) {
  const qtyInputId = useId();
  const periodInputId = useId();

  const initialPeriodScope: 'DEFAULT' | 'PERIOD' =
    item.resolvedPlanningPeriod || activePlanningPeriod.trim() ? 'PERIOD' : 'DEFAULT';

  const [targetRaw, setTargetRaw] = useState(() =>
    item.targetQuantity !== null ? String(item.targetQuantity) : '',
  );
  const [scopeMode, setScopeMode] = useState<'DEFAULT' | 'PERIOD'>(initialPeriodScope);
  const [periodInput, setPeriodInput] = useState(
    () => item.resolvedPlanningPeriod ?? activePlanningPeriod.trim(),
  );

  const [qtyError, setQtyError] = useState<string | null>(null);
  const [periodError, setPeriodError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<{
    message: string;
    requestId?: string | null;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setQtyError(null);
    setPeriodError(null);
    setSubmitError(null);

    const trimmedQty = targetRaw.trim();
    if (!WHOLE_NUMBER_PATTERN.test(trimmedQty)) {
      setQtyError('Enter a non-negative whole number (0 or greater).');
      return;
    }
    const parsedQty = Number(trimmedQty);
    if (!Number.isSafeInteger(parsedQty) || parsedQty < 0) {
      setQtyError('Target quantity must be a valid non-negative integer.');
      return;
    }

    const trimmedPeriod = periodInput.trim();
    if (scopeMode === 'PERIOD') {
      if (!trimmedPeriod) {
        setPeriodError('Enter a planning period name (for example, Diwali), or switch to Default target.');
        return;
      }
      if (trimmedPeriod.length > 50) {
        setPeriodError('Planning period must not exceed 50 characters.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const saved = await api.upsertPurchaseTarget(item.skuId, {
        targetQuantity: parsedQty,
        planningPeriod: scopeMode === 'PERIOD' ? trimmedPeriod : null,
      });
      onSaved(saved, item);
    } catch (err) {
      if (isApiClientError(err)) {
        setSubmitError({ message: err.message, requestId: err.requestId });
      } else {
        setSubmitError({ message: 'Unable to save purchase target right now. Please try again.' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      title={item.targetQuantity === null ? 'Set Minimum Target' : 'Edit Minimum Target'}
      onClose={onClose}
      preventClose={submitting}
    >
      <form className="catalog-modal-form" onSubmit={handleSubmit} noValidate>
        <div className="catalog-added-list">
          <strong>
            {item.productName}
            {item.size ? ` (Size ${item.size})` : ''}
          </strong>
          <span>
            SKU: <code>{item.skuCode}</code> · Sellable now: {item.sellableQuantity} · Open PO:{' '}
            {item.openPoQuantity}
          </span>
        </div>

        <fieldset className="catalog-status-fieldset">
          <legend>Target Scope</legend>
          <div className="status-radio-group">
            <label className="status-radio-option">
              <input
                type="radio"
                name="targetScopeMode"
                value="DEFAULT"
                checked={scopeMode === 'DEFAULT'}
                disabled={submitting}
                onChange={() => {
                  setScopeMode('DEFAULT');
                  setPeriodError(null);
                }}
              />
              Default target
            </label>
            <label className="status-radio-option">
              <input
                type="radio"
                name="targetScopeMode"
                value="PERIOD"
                checked={scopeMode === 'PERIOD'}
                disabled={submitting}
                onChange={() => setScopeMode('PERIOD')}
              />
              Period-specific target
            </label>
          </div>
          <p className="catalog-field-hint">
            {scopeMode === 'DEFAULT'
              ? 'Default targets apply across all queries unless overridden by a period-specific target.'
              : 'Period-specific targets override the default target whenever this planning period is selected.'}
          </p>
        </fieldset>

        {scopeMode === 'PERIOD' ? (
          <div className="catalog-field">
            <label htmlFor={periodInputId} className="catalog-label">
              Planning Period
            </label>
            <input
              id={periodInputId}
              type="text"
              className="catalog-input"
              value={periodInput}
              disabled={submitting}
              placeholder="e.g. Diwali, Summer, Wedding Season"
              aria-invalid={periodError ? 'true' : undefined}
              onChange={(event) => {
                setPeriodInput(event.target.value);
                setPeriodError(null);
              }}
            />
            {periodError ? (
              <p className="catalog-field-error" role="alert">
                {periodError}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="catalog-field">
          <label htmlFor={qtyInputId} className="catalog-label">
            Target Stock Quantity (pieces)
          </label>
          <input
            id={qtyInputId}
            type="text"
            inputMode="numeric"
            className="catalog-input"
            value={targetRaw}
            disabled={submitting}
            placeholder="e.g. 30 (enter 0 to keep target at zero)"
            aria-invalid={qtyError ? 'true' : undefined}
            onChange={(event) => {
              setTargetRaw(event.target.value);
              setQtyError(null);
            }}
          />
          {qtyError ? (
            <p className="catalog-field-error" role="alert">
              {qtyError}
            </p>
          ) : null}
        </div>

        {submitError ? (
          <div className="alert-banner alert-banner--error" role="alert">
            <div className="alert-banner__content">
              <p>{submitError.message}</p>
              {submitError.requestId ? (
                <p className="alert-banner__meta">Request ID: {submitError.requestId}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="catalog-modal-actions">
          <button type="button" className="btn-secondary" disabled={submitting} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Saving Target…' : 'Save Target'}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
