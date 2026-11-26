import { useId, useRef, useState, type FormEvent } from 'react';
import { isApiClientError } from '../../api/errors.ts';
import {
  formatInrDisplay,
  formatPaiseToInr,
  normalizeInrPriceInput,
  parseInrToPaise,
} from '../../utils/inrPrice.ts';
import type { BillingApi } from '../billingApi.ts';
import { generateBillIdempotencyKey } from '../cartUtils.ts';
import type {
  BillDetail,
  CollectBillPaymentInput,
  CollectBillPaymentResponse,
  PaymentMode,
} from '../types.ts';

export interface CollectCreditPaymentWorkflowProps {
  bill: BillDetail;
  api: BillingApi;
  onReloadBill: () => Promise<BillDetail | null>;
  onSuccess: (info: {
    message: string;
    result: CollectBillPaymentResponse;
    stockChanged: boolean;
  }) => void;
  onCancelWorkflow: () => void;
}

interface PendingPaymentSubmit {
  payloadKey: string;
  payload: CollectBillPaymentInput;
  idempotencyKey: string;
}

export function CollectCreditPaymentWorkflow({
  bill,
  api,
  onReloadBill,
  onSuccess,
  onCancelWorkflow,
}: CollectCreditPaymentWorkflowProps) {
  const headingId = useId();
  const amountId = useId();
  const amountErrorId = useId();
  const referenceId = useId();
  const submittingRef = useRef(false);

  const [mode, setMode] = useState<PaymentMode>('CASH');
  const [amountRaw, setAmountRaw] = useState(bill.balanceDue);
  const [amountTouched, setAmountTouched] = useState(false);
  const [referenceRaw, setReferenceRaw] = useState('');
  const [showValidation, setShowValidation] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<PendingPaymentSubmit | null>(null);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<{
    message: string;
    requestId?: string | null;
    isUnknownOutcome?: boolean;
  } | null>(null);

  const currentBalancePaise = parseInrToPaise(bill.balanceDue) ?? 0;

  let amountError: string | null = null;
  let normalizedAmount: string | null = null;
  const trimmedAmount = amountRaw.trim();
  if (!trimmedAmount) {
    amountError = 'Enter the payment amount collected.';
  } else {
    const parsed = normalizeInrPriceInput(trimmedAmount);
    if (!parsed.ok) {
      amountError = parsed.error;
    } else {
      const paise = parseInrToPaise(parsed.value);
      if (paise === null || paise <= 0) {
        amountError = 'Payment amount must be greater than ₹0.00.';
      } else if (paise > currentBalancePaise) {
        amountError = `Payment (${formatInrDisplay(parsed.value)}) exceeds current balance due (${formatInrDisplay(bill.balanceDue)}).`;
      } else {
        normalizedAmount = parsed.value;
      }
    }
  }

  const refError =
    referenceRaw.trim().length > 150 ? 'Reference must not exceed 150 characters.' : null;

  const invalidatePending = () => {
    setPendingSubmit(null);
    setSubmitError(null);
    setConflictNotice(null);
  };

  const executePayment = async (attempt: PendingPaymentSubmit) => {
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    setConflictNotice(null);

    try {
      const result = await api.collectPayment(
        bill.billId,
        attempt.payload,
        attempt.idempotencyKey,
      );
      setPendingSubmit(null);
      onSuccess({
        message: `Payment of ${formatInrDisplay(attempt.payload.amount)} (${attempt.payload.mode}) recorded on ${bill.billNumber}. Remaining balance due: ${formatInrDisplay(result.balanceDue)}.`,
        result,
        stockChanged: false,
      });
    } catch (error) {
      if (isApiClientError(error)) {
        if (error.code === 'PAYMENT_EXCEEDS_BALANCE' || error.code === 'STALE_VERSION') {
          setPendingSubmit(null);
          const refreshed = await onReloadBill();
          setConflictNotice(
            refreshed
              ? `${error.message} Current outstanding balance on ${refreshed.billNumber} (Version ${refreshed.version}): ${formatInrDisplay(refreshed.balanceDue)}. Review and adjust your payment before submitting again.`
              : `${error.message} Reloaded bill balance; please review and adjust your payment.`,
          );
        } else if (error.kind === 'network' || error.kind === 'server') {
          setPendingSubmit(attempt);
          setSubmitError({
            message:
              'Network or server error while recording credit payment. Click Retry payment to reuse the exact Idempotency-Key so the customer is not charged twice.',
            requestId: error.requestId,
            isUnknownOutcome: true,
          });
        } else {
          setPendingSubmit(null);
          const fieldSummary =
            error.fieldErrors.length > 0
              ? error.fieldErrors.map((f) => f.message).join(' ')
              : '';
          setSubmitError({
            message: fieldSummary || error.message || 'Unable to record credit payment.',
            requestId: error.requestId,
          });
        }
      } else {
        setPendingSubmit(attempt);
        setSubmitError({
          message: 'Unexpected error while recording payment. Retry cleanly below.',
          isUnknownOutcome: true,
        });
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }

    setShowValidation(true);
    setAmountTouched(true);
    if (amountError || refError || !normalizedAmount) {
      return;
    }

    const payload: CollectBillPaymentInput = {
      expectedVersion: bill.version,
      mode,
      amount: normalizedAmount,
      ...(referenceRaw.trim() ? { reference: referenceRaw.trim() } : {}),
    };
    const payloadKey = JSON.stringify(payload);
    const attempt: PendingPaymentSubmit =
      pendingSubmit && pendingSubmit.payloadKey === payloadKey
        ? pendingSubmit
        : {
            payloadKey,
            payload,
            idempotencyKey: generateBillIdempotencyKey(),
          };

    void executePayment(attempt);
  };

  return (
    <section className="surface-card billing-workflow-panel" aria-labelledby={headingId}>
      <div className="billing-workflow-header">
        <div>
          <h2 id={headingId}>Record Credit Payment — {bill.billNumber}</h2>
          <div className="billing-workflow-billref">
            <span>
              Customer:{' '}
              <strong>
                {bill.customerName
                  ? `${bill.customerName}${bill.customerContact ? ` (${bill.customerContact})` : ''}`
                  : 'Walk-in customer'}
              </strong>
            </span>
            <span>·</span>
            <span>
              Current balance due: <strong>{formatInrDisplay(bill.balanceDue)}</strong>
            </span>
            <span>·</span>
            <span>Version {bill.version}</span>
          </div>
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={isSubmitting}
          onClick={onCancelWorkflow}
        >
          Close
        </button>
      </div>

      {conflictNotice ? (
        <div className="alert-banner alert-banner--warning" role="alert">
          <div className="alert-banner__content">
            <p>{conflictNotice}</p>
          </div>
        </div>
      ) : null}

      <form className="po-form" onSubmit={handleSubmit} noValidate>
        <fieldset className="billing-disposition-fieldset">
          <legend>Payment mode</legend>
          <div className="billing-payment-presets">
            <label className="billing-radio-card">
              <input
                type="radio"
                name="credit-payment-mode"
                value="CASH"
                checked={mode === 'CASH'}
                disabled={isSubmitting}
                onChange={() => {
                  invalidatePending();
                  setMode('CASH');
                }}
              />
              <span>Cash</span>
            </label>
            <label className="billing-radio-card">
              <input
                type="radio"
                name="credit-payment-mode"
                value="UPI"
                checked={mode === 'UPI'}
                disabled={isSubmitting}
                onChange={() => {
                  invalidatePending();
                  setMode('UPI');
                }}
              />
              <span>UPI</span>
            </label>
          </div>
        </fieldset>

        <div className="catalog-field">
          <div className="catalog-label-row">
            <label htmlFor={amountId} className="catalog-label">
              Payment amount (₹) <span aria-hidden="true">*</span>
            </label>
            <button
              type="button"
              className="catalog-inline-link"
              disabled={isSubmitting || currentBalancePaise <= 0}
              onClick={() => {
                invalidatePending();
                setAmountRaw(formatPaiseToInr(currentBalancePaise));
              }}
            >
              Fill full balance ({formatInrDisplay(bill.balanceDue)})
            </button>
          </div>
          <input
            id={amountId}
            type="text"
            inputMode="decimal"
            className="catalog-input"
            required
            placeholder="0.00"
            value={amountRaw}
            disabled={isSubmitting}
            onBlur={() => setAmountTouched(true)}
            onChange={(event) => {
              invalidatePending();
              setAmountRaw(event.target.value);
            }}
            aria-invalid={(showValidation || amountTouched) && amountError ? 'true' : 'false'}
            aria-describedby={amountErrorId}
          />
          {(showValidation || amountTouched) && amountError ? (
            <p id={amountErrorId} className="catalog-field-error" role="alert">
              {amountError}
            </p>
          ) : null}
        </div>

        <div className="catalog-field">
          <label htmlFor={referenceId} className="catalog-label">
            Payment reference (optional)
          </label>
          <input
            id={referenceId}
            type="text"
            className="catalog-input"
            maxLength={150}
            placeholder="e.g. UPI transaction ID or receipt note"
            value={referenceRaw}
            disabled={isSubmitting}
            onChange={(event) => {
              invalidatePending();
              setReferenceRaw(event.target.value);
            }}
            aria-invalid={refError ? 'true' : 'false'}
          />
          {refError ? (
            <p className="catalog-field-error" role="alert">
              {refError}
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
              {submitError.isUnknownOutcome && pendingSubmit ? (
                <div className="alert-banner__actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={isSubmitting}
                    onClick={() => {
                      void executePayment(pendingSubmit);
                    }}
                  >
                    Retry payment
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="po-form-footer">
          <button
            type="button"
            className="btn-secondary"
            disabled={isSubmitting}
            onClick={onCancelWorkflow}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Recording payment…' : 'Record Payment'}
          </button>
        </div>
      </form>
    </section>
  );
}
