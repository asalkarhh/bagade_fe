import { useMemo, useRef, useState } from 'react';
import { formatInrDisplay, formatPaiseToInr } from '../../utils/inrPrice.ts';
import {
  computeSettlementGuidance,
  validateSettlementEntries,
  type SettlementDraftRow,
} from '../correctionUtils.ts';
import type { PaymentDirection, PaymentMode } from '../types.ts';

export interface SettlementEntriesEditorProps {
  entries: SettlementDraftRow[];
  onChange: (next: SettlementDraftRow[]) => void;
  allowedDirections: readonly PaymentDirection[];
  currentPaidPaise: number;
  adjustedTotalPaise: number;
  hasCustomer: boolean;
  exactRefundRequiredPaise?: number | null;
  disabled?: boolean;
  showValidation?: boolean;
  idPrefix: string;
}

export function SettlementEntriesEditor({
  entries,
  onChange,
  allowedDirections,
  currentPaidPaise,
  adjustedTotalPaise,
  hasCustomer,
  exactRefundRequiredPaise = null,
  disabled = false,
  showValidation = false,
  idPrefix,
}: SettlementEntriesEditorProps) {
  const nextRowIdRef = useRef(100);
  const [touchedRows, setTouchedRows] = useState<Record<number, boolean>>({});

  const guidance = useMemo(
    () => computeSettlementGuidance(currentPaidPaise, adjustedTotalPaise, hasCustomer),
    [currentPaidPaise, adjustedTotalPaise, hasCustomer],
  );

  const summary = useMemo(
    () =>
      validateSettlementEntries(
        entries,
        currentPaidPaise,
        adjustedTotalPaise,
        hasCustomer,
        allowedDirections,
      ),
    [entries, currentPaidPaise, adjustedTotalPaise, hasCustomer, allowedDirections],
  );

  const applySinglePreset = (direction: PaymentDirection, mode: PaymentMode, paise: number) => {
    if (paise <= 0) {
      onChange([]);
      return;
    }
    const id = nextRowIdRef.current++;
    onChange([
      {
        localId: id,
        direction,
        mode,
        amountRaw: formatPaiseToInr(paise),
        referenceRaw: '',
      },
    ]);
  };

  const addRow = () => {
    const id = nextRowIdRef.current++;
    const defaultDirection: PaymentDirection = allowedDirections.includes('PAYMENT')
      ? guidance.requiredRefundPaise > 0 && allowedDirections.includes('REFUND')
        ? 'REFUND'
        : 'PAYMENT'
      : allowedDirections[0];

    onChange([
      ...entries,
      {
        localId: id,
        direction: defaultDirection,
        mode: entries.some((r) => r.mode === 'CASH') ? 'UPI' : 'CASH',
        amountRaw: '',
        referenceRaw: '',
      },
    ]);
  };

  const updateRow = (localId: number, patch: Partial<SettlementDraftRow>) => {
    onChange(entries.map((row) => (row.localId === localId ? { ...row, ...patch } : row)));
  };

  const removeRow = (localId: number) => {
    onChange(entries.filter((row) => row.localId !== localId));
  };

  const targetRefundPaise =
    exactRefundRequiredPaise !== null ? exactRefundRequiredPaise : guidance.requiredRefundPaise;

  return (
    <div className="po-lines-section">
      <div className="po-line-card__top">
        <span className="catalog-label">Settlement (Collections &amp; Refunds)</span>
        <button
          type="button"
          className="btn-table-action"
          disabled={disabled}
          onClick={addRow}
        >
          + Add settlement
        </button>
      </div>

      <div className="billing-totals-box" aria-live="polite">
        <div className="billing-total-row">
          <span>Previously collected (net paid)</span>
          <span>{formatInrDisplay(formatPaiseToInr(currentPaidPaise))}</span>
        </div>
        <div className="billing-total-row">
          <span>Adjusted bill total</span>
          <span>{formatInrDisplay(formatPaiseToInr(adjustedTotalPaise))}</span>
        </div>
        {targetRefundPaise > 0 ? (
          <div className="billing-total-row billing-total-row--grand">
            <span>Refund required</span>
            <span>{formatInrDisplay(formatPaiseToInr(targetRefundPaise))}</span>
          </div>
        ) : guidance.additionalDuePaise > 0 ? (
          <div className="billing-total-row billing-total-row--grand">
            <span>
              {hasCustomer ? 'Additional amount / credit' : 'Additional collection required'}
            </span>
            <span>{formatInrDisplay(formatPaiseToInr(guidance.additionalDuePaise))}</span>
          </div>
        ) : null}
        <div className="billing-total-row">
          <span>Projected remaining balance due</span>
          <span>{formatInrDisplay(formatPaiseToInr(Math.max(0, summary.balanceDueAfterPaise)))}</span>
        </div>
      </div>

      <div className="billing-payment-presets" aria-label="Quick settlement actions">
        {targetRefundPaise > 0 && allowedDirections.includes('REFUND') ? (
          <>
            <button
              type="button"
              className="btn-table-action"
              disabled={disabled}
              onClick={() => applySinglePreset('REFUND', 'CASH', targetRefundPaise)}
            >
              Refund {formatInrDisplay(formatPaiseToInr(targetRefundPaise))} (Cash)
            </button>
            <button
              type="button"
              className="btn-table-action"
              disabled={disabled}
              onClick={() => applySinglePreset('REFUND', 'UPI', targetRefundPaise)}
            >
              Refund {formatInrDisplay(formatPaiseToInr(targetRefundPaise))} (UPI)
            </button>
          </>
        ) : null}

        {guidance.additionalDuePaise > 0 && allowedDirections.includes('PAYMENT') ? (
          <>
            <button
              type="button"
              className="btn-table-action"
              disabled={disabled}
              onClick={() => applySinglePreset('PAYMENT', 'CASH', guidance.additionalDuePaise)}
            >
              Collect {formatInrDisplay(formatPaiseToInr(guidance.additionalDuePaise))} (Cash)
            </button>
            <button
              type="button"
              className="btn-table-action"
              disabled={disabled}
              onClick={() => applySinglePreset('PAYMENT', 'UPI', guidance.additionalDuePaise)}
            >
              Collect {formatInrDisplay(formatPaiseToInr(guidance.additionalDuePaise))} (UPI)
            </button>
            {hasCustomer ? (
              <button
                type="button"
                className="btn-table-action"
                disabled={disabled}
                onClick={() => onChange([])}
              >
                Keep balance on customer credit
              </button>
            ) : null}
          </>
        ) : null}

        {entries.length > 0 && targetRefundPaise === 0 ? (
          <button
            type="button"
            className="btn-table-action"
            disabled={disabled}
            onClick={() => onChange([])}
          >
            Clear settlement rows
          </button>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <p className="catalog-field-hint">
          No settlement entries added.
        </p>
      ) : (
        entries.map((row, idx) => {
          const check = summary.rows[idx];
          const shouldShowRowError = Boolean(showValidation || touchedRows[row.localId]);
          const dirId = `${idPrefix}-settle-dir-${row.localId}`;
          const modeId = `${idPrefix}-settle-mode-${row.localId}`;
          const amountId = `${idPrefix}-settle-amt-${row.localId}`;
          const refId = `${idPrefix}-settle-ref-${row.localId}`;

          return (
            <div key={row.localId} className="billing-payment-row">
              <div className="po-line-card__top">
                <span className="catalog-label">Settlement #{idx + 1}</span>
                <button
                  type="button"
                  className="btn-table-action btn-table-action--danger"
                  disabled={disabled}
                  onClick={() => removeRow(row.localId)}
                >
                  Remove
                </button>
              </div>

              <div className="billing-settlement-row__fields">
                <div className="catalog-field">
                  <label htmlFor={dirId} className="catalog-label">
                    Direction ({idx + 1})
                  </label>
                  <select
                    id={dirId}
                    className="catalog-select"
                    value={row.direction}
                    disabled={disabled || allowedDirections.length === 1}
                    onChange={(event) =>
                      updateRow(row.localId, {
                        direction: event.target.value as PaymentDirection,
                      })
                    }
                  >
                    {allowedDirections.includes('PAYMENT') ? (
                      <option value="PAYMENT">Payment (Collect)</option>
                    ) : null}
                    {allowedDirections.includes('REFUND') ? (
                      <option value="REFUND">Refund (Return cash/UPI)</option>
                    ) : null}
                  </select>
                </div>

                <div className="catalog-field">
                  <label htmlFor={modeId} className="catalog-label">
                    Mode ({idx + 1})
                  </label>
                  <select
                    id={modeId}
                    className="catalog-select"
                    value={row.mode}
                    disabled={disabled}
                    onChange={(event) =>
                      updateRow(row.localId, { mode: event.target.value as PaymentMode })
                    }
                  >
                    <option value="CASH">Cash</option>
                    <option value="UPI">UPI</option>
                  </select>
                </div>

                <div className="catalog-field">
                  <label htmlFor={amountId} className="catalog-label">
                    Amount (₹) ({idx + 1})
                  </label>
                  <input
                    id={amountId}
                    type="text"
                    inputMode="decimal"
                    className="catalog-input"
                    placeholder="0.00"
                    value={row.amountRaw}
                    disabled={disabled}
                    onBlur={() =>
                      setTouchedRows((prev) => ({ ...prev, [row.localId]: true }))
                    }
                    onChange={(event) => updateRow(row.localId, { amountRaw: event.target.value })}
                    aria-invalid={shouldShowRowError && check?.amountError ? 'true' : 'false'}
                  />
                </div>
              </div>

              {shouldShowRowError && check?.amountError ? (
                <p className="catalog-field-error" role="alert">
                  {check.amountError}
                </p>
              ) : null}

              <div className="catalog-field">
                <label htmlFor={refId} className="catalog-label">
                  Reference ({idx + 1}) (optional)
                </label>
                <input
                  id={refId}
                  type="text"
                  className="catalog-input"
                  maxLength={150}
                  placeholder="Receipt or UPI reference"
                  value={row.referenceRaw}
                  disabled={disabled}
                  onChange={(event) => updateRow(row.localId, { referenceRaw: event.target.value })}
                  aria-invalid={check?.referenceError ? 'true' : 'false'}
                />
                {check?.referenceError ? (
                  <p className="catalog-field-error" role="alert">
                    {check.referenceError}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })
      )}

      {showValidation && summary.bannerError ? (
        <div className="alert-banner alert-banner--error" role="alert">
          <div className="alert-banner__content">
            <p>{summary.bannerError}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
