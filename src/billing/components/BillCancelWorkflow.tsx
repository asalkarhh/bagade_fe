import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { isApiClientError } from '../../api/errors.ts';
import { formatInrDisplay, parseInrToPaise } from '../../utils/inrPrice.ts';
import type { BillingApi } from '../billingApi.ts';
import { generateBillIdempotencyKey } from '../cartUtils.ts';
import { validateSettlementEntries, type SettlementDraftRow } from '../correctionUtils.ts';
import type { BillDetail, CancelBillInput, CancelBillResponse } from '../types.ts';
import { SettlementEntriesEditor } from './SettlementEntriesEditor.tsx';

export interface BillCancelWorkflowProps {
  bill: BillDetail;
  api: BillingApi;
  onReloadBill: () => Promise<BillDetail | null>;
  onSuccess: (info: {
    message: string;
    result: CancelBillResponse;
    stockChanged: boolean;
  }) => void;
  onCancelWorkflow: () => void;
}

interface PendingCancelSubmit {
  payloadKey: string;
  payload: CancelBillInput;
  idempotencyKey: string;
}

export function BillCancelWorkflow({
  bill,
  api,
  onReloadBill,
  onSuccess,
  onCancelWorkflow,
}: BillCancelWorkflowProps) {
  const headingId = useId();
  const reasonId = useId();
  const reasonErrorId = useId();
  const submittingRef = useRef(false);

  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  const [settlementRows, setSettlementRows] = useState<SettlementDraftRow[]>([]);
  const [showValidation, setShowValidation] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<PendingCancelSubmit | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<{
    message: string;
    requestId?: string | null;
    isUnknownOutcome?: boolean;
  } | null>(null);

  const remainingLines = useMemo(
    () => bill.lines.filter((line) => line.returnableQuantity > 0),
    [bill.lines],
  );
  const currentPaidPaise = parseInrToPaise(bill.paid) ?? 0;

  const settlementValidation = useMemo(
    () =>
      validateSettlementEntries(
        settlementRows,
        currentPaidPaise,
        0,
        Boolean(bill.customerId),
        ['REFUND'],
      ),
    [settlementRows, currentPaidPaise, bill.customerId],
  );

  const exactRefundMismatchError =
    currentPaidPaise > 0 && settlementValidation.totalRefundsPaise !== currentPaidPaise
      ? `Cancelling ${bill.billNumber} requires refunding the exact collected net amount of ${formatInrDisplay(bill.paid)}.`
      : currentPaidPaise === 0 && settlementRows.length > 0
        ? 'No collected payment exists on this bill; remove settlement rows before cancelling.'
        : null;

  const reasonError =
    reason.trim().length === 0
      ? 'Enter a cancellation reason.'
      : reason.trim().length > 500
        ? 'Reason must not exceed 500 characters.'
        : null;

  const invalidatePending = () => {
    setPendingSubmit(null);
    setSubmitError(null);
    setStaleNotice(null);
  };

  const executeCancel = async (attempt: PendingCancelSubmit) => {
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    setStaleNotice(null);

    try {
      const result = await api.cancelBill(bill.billId, attempt.payload, attempt.idempotencyKey);
      setPendingSubmit(null);
      onSuccess({
        message: `${bill.billNumber} has been marked ${result.status}. Remaining unreturned stock was reversed cleanly.`,
        result,
        stockChanged: remainingLines.length > 0,
      });
    } catch (error) {
      if (isApiClientError(error)) {
        if (error.code === 'STALE_VERSION') {
          setPendingSubmit(null);
          const refreshed = await onReloadBill();
          setStaleNotice(
            refreshed
              ? `${error.message} Reloaded ${refreshed.billNumber} (Rev ${refreshed.currentRevisionNumber}, Version ${refreshed.version}, Paid ${formatInrDisplay(refreshed.paid)}). Review remaining effects before confirming cancellation.`
              : `${error.message} Reloaded latest bill details. Please review before confirming.`,
          );
        } else if (error.kind === 'network' || error.kind === 'server') {
          setPendingSubmit(attempt);
          setSubmitError({
            message:
              'Network or server error while cancelling bill. Click Retry cancellation to reuse the exact Idempotency-Key.',
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
            message: fieldSummary || error.message || 'Unable to cancel bill.',
            requestId: error.requestId,
          });
        }
      } else {
        setPendingSubmit(attempt);
        setSubmitError({
          message: 'Unexpected error while cancelling bill. Retry cleanly below.',
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
    setReasonTouched(true);
    if (reasonError || !settlementValidation.valid || exactRefundMismatchError) {
      return;
    }

    const payload: CancelBillInput = {
      expectedVersion: bill.version,
      reason: reason.trim(),
      settlement: settlementValidation.apiEntries,
    };
    const payloadKey = JSON.stringify(payload);
    const attempt: PendingCancelSubmit =
      pendingSubmit && pendingSubmit.payloadKey === payloadKey
        ? pendingSubmit
        : {
            payloadKey,
            payload,
            idempotencyKey: generateBillIdempotencyKey(),
          };

    void executeCancel(attempt);
  };

  return (
    <section className="surface-card billing-workflow-panel" aria-labelledby={headingId}>
      <div className="billing-workflow-header">
        <div>
          <h2 id={headingId}>Cancel Bill — {bill.billNumber}</h2>
          <div className="billing-workflow-billref">
            <span>Status: {bill.status}</span>
            <span>·</span>
            <span>Revision {bill.currentRevisionNumber}</span>
            <span>·</span>
            <span>Version {bill.version}</span>
            <span>·</span>
            <span>Remaining total: {formatInrDisplay(bill.total)}</span>
          </div>
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={isSubmitting}
          onClick={onCancelWorkflow}
        >
          Close workflow
        </button>
      </div>

      {staleNotice ? (
        <div className="alert-banner alert-banner--warning" role="alert">
          <div className="alert-banner__content">
            <p>{staleNotice}</p>
          </div>
        </div>
      ) : null}

      <div className="billing-review-box">
        <h3>Remaining effects to be reversed on {bill.billNumber}</h3>
        {remainingLines.length === 0 ? (
          <p className="catalog-field-hint">
            All units on this bill were already returned. Cancelling finalizes status to CANCELLED.
          </p>
        ) : (
          <ul className="po-recent-list" aria-label="Remaining unreturned units">
            {remainingLines.map((line) => (
              <li key={line.logicalLineId}>
                <strong>{line.productName}</strong> {line.size ? `[${line.size}] ` : ''}(
                <code>{line.skuCode}</code>): returning remaining{' '}
                <strong>{line.returnableQuantity}</strong> of {line.quantity} piece
                {line.quantity === 1 ? '' : 's'} to <strong>SELLABLE</strong> stock
                {line.returnedQuantity > 0
                  ? ` (${line.returnedQuantity} previously returned untouched)`
                  : ''}
              </li>
            ))}
          </ul>
        )}
        <p className="catalog-field-hint">
          Remaining sales amount reversed: <strong>-{formatInrDisplay(bill.total)}</strong> ·
          Collected payment requiring refund: <strong>{formatInrDisplay(bill.paid)}</strong>
          {parseInrToPaise(bill.balanceDue)! > 0
            ? ` · Open credit balance (${formatInrDisplay(bill.balanceDue)}) will be cleared`
            : ''}
        </p>
      </div>

      <form className="po-form" onSubmit={handleSubmit} noValidate>
        <SettlementEntriesEditor
          entries={settlementRows}
          onChange={(next) => {
            invalidatePending();
            setSettlementRows(next);
          }}
          allowedDirections={['REFUND']}
          currentPaidPaise={currentPaidPaise}
          adjustedTotalPaise={0}
          hasCustomer={Boolean(bill.customerId)}
          exactRefundRequiredPaise={currentPaidPaise}
          disabled={isSubmitting}
          showValidation={showValidation}
          idPrefix="cancel"
        />

        {showValidation && exactRefundMismatchError ? (
          <div className="alert-banner alert-banner--error" role="alert">
            <div className="alert-banner__content">
              <p>{exactRefundMismatchError}</p>
            </div>
          </div>
        ) : null}

        <div className="catalog-field">
          <label htmlFor={reasonId} className="catalog-label">
            Cancellation reason <span aria-hidden="true">*</span>
          </label>
          <textarea
            id={reasonId}
            className="billing-reason-textarea"
            maxLength={500}
            required
            placeholder="e.g. Customer cancelled order before pickup"
            value={reason}
            disabled={isSubmitting}
            onBlur={() => setReasonTouched(true)}
            onChange={(event) => {
              invalidatePending();
              setReason(event.target.value);
            }}
            aria-invalid={(showValidation || reasonTouched) && reasonError ? 'true' : 'false'}
            aria-describedby={reasonErrorId}
          />
          {(showValidation || reasonTouched) && reasonError ? (
            <p id={reasonErrorId} className="catalog-field-error" role="alert">
              {reasonError}
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
                      void executeCancel(pendingSubmit);
                    }}
                  >
                    Retry cancellation
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
            Keep bill
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Cancelling bill…' : `Confirm & Cancel ${bill.billNumber}`}
          </button>
        </div>
      </form>
    </section>
  );
}
