import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { isApiClientError } from '../../api/errors.ts';
import { formatInrDisplay, formatPaiseToInr, parseInrToPaise } from '../../utils/inrPrice.ts';
import type { BillingApi } from '../billingApi.ts';
import { generateBillIdempotencyKey, parsePositiveWholeQuantity } from '../cartUtils.ts';
import {
  computeReturnCreditPaise,
  validateSettlementEntries,
  type SettlementDraftRow,
} from '../correctionUtils.ts';
import type {
  BillDetail,
  ReturnBillInput,
  ReturnBillResponse,
  ReturnLineInput,
  StockCondition,
} from '../types.ts';
import { SettlementEntriesEditor } from './SettlementEntriesEditor.tsx';
import { StockEffectsList } from './StockEffectsList.tsx';

export interface BillReturnWorkflowProps {
  bill: BillDetail;
  api: BillingApi;
  onReloadBill: () => Promise<BillDetail | null>;
  onSuccess: (info: {
    message: string;
    result: ReturnBillResponse;
    stockChanged: boolean;
  }) => void;
  onCancelWorkflow: () => void;
}

interface ReturnLineDraft {
  logicalLineId: string;
  skuCode: string;
  productName: string;
  size: string | null;
  maxReturnable: number;
  quantityRaw: string;
  disposition: StockCondition;
}

interface PendingReturnSubmit {
  payloadKey: string;
  payload: ReturnBillInput;
  idempotencyKey: string;
}

export function BillReturnWorkflow({
  bill,
  api,
  onReloadBill,
  onSuccess,
  onCancelWorkflow,
}: BillReturnWorkflowProps) {
  const workflowHeadingId = useId();
  const reasonId = useId();
  const reasonErrorId = useId();
  const reviewHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const submittingRef = useRef(false);

  const [draftLines, setDraftLines] = useState<ReturnLineDraft[]>(() =>
    bill.lines
      .filter((line) => line.returnableQuantity > 0)
      .map((line) => ({
        logicalLineId: line.logicalLineId,
        skuCode: line.skuCode,
        productName: line.productName,
        size: line.size,
        maxReturnable: line.returnableQuantity,
        quantityRaw: '0',
        disposition: 'SELLABLE',
      })),
  );
  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  const [settlementRows, setSettlementRows] = useState<SettlementDraftRow[]>([]);
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [showValidation, setShowValidation] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<PendingReturnSubmit | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<{
    message: string;
    requestId?: string | null;
    isUnknownOutcome?: boolean;
  } | null>(null);

  const billLinesByLogicalId = useMemo(
    () => new Map(bill.lines.map((line) => [line.logicalLineId, line])),
    [bill.lines],
  );

  const lineChecks = useMemo(
    () =>
      draftLines.map((draft) => {
        const trimmed = draft.quantityRaw.trim();
        const billLine = billLinesByLogicalId.get(draft.logicalLineId);
        const liveMax = billLine ? billLine.returnableQuantity : draft.maxReturnable;

        if (!trimmed || trimmed === '0') {
          return { qty: 0, error: undefined, creditPaise: 0 };
        }
        const parsed = parsePositiveWholeQuantity(trimmed);
        if (parsed === null) {
          return {
            qty: 0,
            error: 'Enter 0 or a positive whole number of pieces.',
            creditPaise: 0,
          };
        }
        if (parsed > liveMax) {
          return {
            qty: parsed,
            error: `Cannot return ${parsed}; remaining returnable quantity is ${liveMax}.`,
            creditPaise: 0,
          };
        }
        const credit = billLine
          ? computeReturnCreditPaise(billLine, parsed).netAbsPaise
          : 0;
        return { qty: parsed, error: undefined, creditPaise: credit };
      }),
    [draftLines, billLinesByLogicalId],
  );

  const selectedReturnLines: {
    draft: ReturnLineDraft;
    qty: number;
    creditPaise: number;
  }[] = [];
  for (let i = 0; i < draftLines.length; i += 1) {
    if (lineChecks[i].qty > 0 && !lineChecks[i].error) {
      selectedReturnLines.push({
        draft: draftLines[i],
        qty: lineChecks[i].qty,
        creditPaise: lineChecks[i].creditPaise,
      });
    }
  }

  const totalReturnCreditPaise = selectedReturnLines.reduce(
    (sum, item) => sum + item.creditPaise,
    0,
  );
  const currentTotalPaise = parseInrToPaise(bill.total) ?? 0;
  const currentPaidPaise = parseInrToPaise(bill.paid) ?? 0;
  const adjustedTotalPaise = Math.max(0, currentTotalPaise - totalReturnCreditPaise);

  const settlementValidation = useMemo(
    () =>
      validateSettlementEntries(
        settlementRows,
        currentPaidPaise,
        adjustedTotalPaise,
        Boolean(bill.customerId),
        ['PAYMENT', 'REFUND'],
      ),
    [settlementRows, currentPaidPaise, adjustedTotalPaise, bill.customerId],
  );

  const hasLineError = lineChecks.some((c) => Boolean(c.error));
  const noItemsSelectedError =
    selectedReturnLines.length === 0 ? 'Select at least one piece to return.' : null;
  const reasonError =
    reason.trim().length === 0
      ? 'Enter a reason for this return.'
      : reason.trim().length > 500
        ? 'Reason must not exceed 500 characters.'
        : null;

  const invalidatePending = () => {
    setPendingSubmit(null);
    setSubmitError(null);
    setStaleNotice(null);
  };

  const handleReviewClick = () => {
    setShowValidation(true);
    setReasonTouched(true);
    setSubmitError(null);

    if (hasLineError || noItemsSelectedError || reasonError || !settlementValidation.valid) {
      return;
    }

    setStep('review');
    window.setTimeout(() => {
      reviewHeadingRef.current?.focus();
    }, 0);
  };

  const executeReturnSubmit = async (attempt: PendingReturnSubmit) => {
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    setStaleNotice(null);

    try {
      const response = await api.returnItems(bill.billId, attempt.payload, attempt.idempotencyKey);
      setPendingSubmit(null);
      onSuccess({
        message: `Return posted on ${bill.billNumber}. Updated balance due: ${formatInrDisplay(response.balanceDue)}.`,
        result: response,
        stockChanged: true,
      });
    } catch (error) {
      if (isApiClientError(error)) {
        if (error.code === 'STALE_VERSION' || error.code === 'RETURN_QUANTITY_EXCEEDED') {
          setPendingSubmit(null);
          const refreshed = await onReloadBill();
          setStep('edit');
          setStaleNotice(
            refreshed
              ? `${error.message} Reloaded bill ${refreshed.billNumber} (Rev ${refreshed.currentRevisionNumber}, Version ${refreshed.version}, Balance due ${formatInrDisplay(refreshed.balanceDue)}). Review remaining returnable quantities before resubmitting.`
              : `${error.message} Reloaded latest bill details. Review and try again.`,
          );
        } else if (error.kind === 'network' || error.kind === 'server') {
          setPendingSubmit(attempt);
          setSubmitError({
            message:
              'Connection lost before return confirmation. Click Retry return to reuse the same Idempotency-Key without reversing stock twice.',
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
            message: fieldSummary || error.message || 'Unable to process return.',
            requestId: error.requestId,
          });
        }
      } else {
        setPendingSubmit(attempt);
        setSubmitError({
          message: 'Unexpected error while submitting return. Retry cleanly below.',
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

    if (hasLineError || noItemsSelectedError || reasonError || !settlementValidation.valid) {
      return;
    }

    const returnedLines: ReturnLineInput[] = selectedReturnLines.map((item) => ({
      lineId: item.draft.logicalLineId,
      quantity: item.qty,
      disposition: item.draft.disposition,
    }));

    const payload: ReturnBillInput = {
      expectedVersion: bill.version,
      reason: reason.trim(),
      returnedLines,
      settlement: settlementValidation.apiEntries,
    };
    const payloadKey = JSON.stringify(payload);
    const attempt: PendingReturnSubmit =
      pendingSubmit && pendingSubmit.payloadKey === payloadKey
        ? pendingSubmit
        : {
            payloadKey,
            payload,
            idempotencyKey: generateBillIdempotencyKey(),
          };

    void executeReturnSubmit(attempt);
  };

  return (
    <section
      className="surface-card billing-workflow-panel"
      aria-labelledby={workflowHeadingId}
    >
      <div className="billing-workflow-header">
        <div>
          <h2 id={workflowHeadingId}>Return Items — {bill.billNumber}</h2>
          <div className="billing-workflow-billref">
            <span>Revision {bill.currentRevisionNumber}</span>
            <span>·</span>
            <span>Version {bill.version}</span>
            <span>·</span>
            <span>Current total {formatInrDisplay(bill.total)}</span>
            <span>·</span>
            <span>Balance due {formatInrDisplay(bill.balanceDue)}</span>
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

      <form className="po-form" onSubmit={handleSubmit} noValidate>
        {step === 'edit' ? (
          <>
            <div className="billing-cart-list">
              {draftLines.map((line, index) => {
                const liveLine = billLinesByLogicalId.get(line.logicalLineId);
                const maxReturnable = liveLine ? liveLine.returnableQuantity : line.maxReturnable;
                const check = lineChecks[index];
                const qtyId = `ret-qty-${line.logicalLineId}`;
                const radioName = `ret-disp-${line.logicalLineId}`;

                return (
                  <article key={line.logicalLineId} className="billing-cart-item">
                    <div className="billing-cart-item__top">
                      <div className="billing-cart-item__title">
                        <span className="billing-cart-item__name">
                          {line.productName} {line.size ? `(${line.size})` : '(Unsized)'}
                        </span>
                        <div className="billing-cart-item__meta">
                          <span>
                            SKU: <code>{line.skuCode}</code>
                          </span>
                          <span>
                            Remaining returnable: <strong>{maxReturnable}</strong>
                          </span>
                          {liveLine ? (
                            <span>
                              Unit selling price: {formatInrDisplay(liveLine.unitSellingPrice)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="billing-cart-item__total">
                        {check.qty > 0 && !check.error ? (
                          <span>Credit: -{formatInrDisplay(formatPaiseToInr(check.creditPaise))}</span>
                        ) : (
                          <span>No return</span>
                        )}
                      </div>
                    </div>

                    <div className="billing-cart-item__controls">
                      <div className="catalog-field">
                        <label htmlFor={qtyId} className="catalog-label">
                          Return qty (0 to {maxReturnable})
                        </label>
                        <input
                          id={qtyId}
                          type="text"
                          inputMode="numeric"
                          className="catalog-input"
                          value={line.quantityRaw}
                          disabled={isSubmitting || maxReturnable <= 0}
                          onChange={(event) => {
                            invalidatePending();
                            setDraftLines((prev) =>
                              prev.map((item, idx) =>
                                idx === index
                                  ? { ...item, quantityRaw: event.target.value }
                                  : item,
                              ),
                            );
                          }}
                          aria-invalid={check.error ? 'true' : 'false'}
                        />
                        {check.error ? (
                          <p className="catalog-field-error" role="alert">
                            {check.error}
                          </p>
                        ) : null}
                      </div>

                      <fieldset className="billing-disposition-fieldset">
                        <legend>Stock condition upon return</legend>
                        <div className="billing-disposition-options">
                          <label className="billing-radio-card">
                            <input
                              type="radio"
                              name={radioName}
                              value="SELLABLE"
                              checked={line.disposition === 'SELLABLE'}
                              disabled={isSubmitting}
                              onChange={() => {
                                invalidatePending();
                                setDraftLines((prev) =>
                                  prev.map((item, idx) =>
                                    idx === index ? { ...item, disposition: 'SELLABLE' } : item,
                                  ),
                                );
                              }}
                            />
                            <span>
                              <strong>Sellable</strong> — returns to available sellable stock
                            </span>
                          </label>
                          <label className="billing-radio-card">
                            <input
                              type="radio"
                              name={radioName}
                              value="NON_SELLABLE"
                              checked={line.disposition === 'NON_SELLABLE'}
                              disabled={isSubmitting}
                              onChange={() => {
                                invalidatePending();
                                setDraftLines((prev) =>
                                  prev.map((item, idx) =>
                                    idx === index
                                      ? { ...item, disposition: 'NON_SELLABLE' }
                                      : item,
                                  ),
                                );
                              }}
                            />
                            <span>
                              <strong>Non-sellable / damaged</strong> — stays out of sellable stock
                            </span>
                          </label>
                        </div>
                      </fieldset>
                    </div>
                  </article>
                );
              })}
            </div>

            {showValidation && noItemsSelectedError ? (
              <div className="alert-banner alert-banner--error" role="alert">
                <div className="alert-banner__content">
                  <p>{noItemsSelectedError}</p>
                </div>
              </div>
            ) : null}

            <SettlementEntriesEditor
              entries={settlementRows}
              onChange={(next) => {
                invalidatePending();
                setSettlementRows(next);
              }}
              allowedDirections={['PAYMENT', 'REFUND']}
              currentPaidPaise={currentPaidPaise}
              adjustedTotalPaise={adjustedTotalPaise}
              hasCustomer={Boolean(bill.customerId)}
              disabled={isSubmitting}
              showValidation={showValidation}
              idPrefix="return"
            />

            <div className="catalog-field">
              <label htmlFor={reasonId} className="catalog-label">
                Return reason <span aria-hidden="true">*</span>
              </label>
              <textarea
                id={reasonId}
                className="billing-reason-textarea"
                maxLength={500}
                required
                placeholder="e.g. Size did not fit, defective zip, customer returned within exchange window"
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
                type="button"
                className="btn-primary"
                disabled={isSubmitting}
                onClick={handleReviewClick}
              >
                Review Return
              </button>
            </div>
          </>
        ) : (
          <div className="billing-review-box">
            <h3 ref={reviewHeadingRef} tabIndex={-1}>
              Review return on {bill.billNumber}
            </h3>

            <ul className="po-recent-list" aria-label="Items to return">
              {selectedReturnLines.map((item) => (
                <li key={item.draft.logicalLineId}>
                  <strong>{item.draft.productName}</strong>{' '}
                  {item.draft.size ? `[${item.draft.size}] ` : ''}(<code>{item.draft.skuCode}</code>
                  ): returning <strong>{item.qty}</strong> piece{item.qty === 1 ? '' : 's'} —{' '}
                  <strong>
                    {item.draft.disposition === 'SELLABLE'
                      ? 'will go back into SELLABLE stock'
                      : 'will be recorded as NON_SELLABLE (stays OUT of sellable stock)'}
                  </strong>{' '}
                  (Credit: -{formatInrDisplay(formatPaiseToInr(item.creditPaise))})
                </li>
              ))}
            </ul>

            <div className="billing-totals-box">
              <div className="billing-total-row">
                <span>Return credit</span>
                <span>-{formatInrDisplay(formatPaiseToInr(totalReturnCreditPaise))}</span>
              </div>
              <div className="billing-total-row">
                <span>New bill total</span>
                <span>{formatInrDisplay(formatPaiseToInr(adjustedTotalPaise))}</span>
              </div>
              <div className="billing-total-row">
                <span>Refund recorded</span>
                <span>
                  {formatInrDisplay(formatPaiseToInr(settlementValidation.totalRefundsPaise))}
                </span>
              </div>
              <div className="billing-total-row billing-total-row--grand">
                <span>Projected balance due</span>
                <span>
                  {formatInrDisplay(
                    formatPaiseToInr(Math.max(0, settlementValidation.balanceDueAfterPaise)),
                  )}
                </span>
              </div>
              <p className="catalog-field-hint">
                Reason: {reason.trim()} · Stock updates are finalized only after posting succeeds.
              </p>
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
                          void executeReturnSubmit(pendingSubmit);
                        }}
                      >
                        Retry return
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
                onClick={() => setStep('edit')}
              >
                ← Back to edit
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
              >
                {isSubmitting ? 'Posting return…' : 'Confirm & Post Return'}
              </button>
            </div>
          </div>
        )}
      </form>
    </section>
  );
}

export function ReturnConfirmationBanner({
  message,
  result,
}: {
  message: string;
  result: ReturnBillResponse;
}) {
  return (
    <div className="surface-card alert-banner--success billing-counter-panel" role="status">
      <p>
        <strong>{message}</strong> (Return ID: <code>{result.returnId}</code> · New version:{' '}
        {result.version})
      </p>
      <StockEffectsList effects={result.stockEffects} />
    </div>
  );
}
