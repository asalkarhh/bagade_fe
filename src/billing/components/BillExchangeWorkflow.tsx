import { useCallback, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { isApiClientError } from '../../api/errors.ts';
import type { CatalogApi } from '../../catalog/catalogApi.ts';
import type { SkuListItem } from '../../catalog/types.ts';
import { BarcodeScannerPanel } from '../../inventory/components/BarcodeScannerPanel.tsx';
import type { InventoryApi } from '../../inventory/inventoryApi.ts';
import type { EligibleBatch } from '../../inventory/types.ts';
import { SkuPickerModal } from '../../purchasing/components/SkuPickerModal.tsx';
import {
  formatInrDisplay,
  formatPaiseToInr,
  normalizeInrPriceInput,
  parseInrToPaise,
} from '../../utils/inrPrice.ts';
import type { BillingApi } from '../billingApi.ts';
import { generateBillIdempotencyKey, parsePositiveWholeQuantity } from '../cartUtils.ts';
import {
  computeReturnCreditPaise,
  parseSelectableBatches,
  validateSettlementEntries,
  type SettlementDraftRow,
} from '../correctionUtils.ts';
import {
  mapBarcodeLookupToResolvedItem,
  resolveSkuSelectionForBilling,
  type ResolvedSkuItem,
} from '../skuLookupHelper.ts';
import type {
  BillDetail,
  BillLineInput,
  ExchangeBillInput,
  ExchangeBillResponse,
  ReturnLineInput,
  StockCondition,
} from '../types.ts';
import { BatchSelectionModal, type BatchSelectionTarget } from './BatchSelectionModal.tsx';
import { SettlementEntriesEditor } from './SettlementEntriesEditor.tsx';
import { StockEffectsList } from './StockEffectsList.tsx';

export interface BillExchangeWorkflowProps {
  bill: BillDetail;
  billing: BillingApi;
  inventory: InventoryApi;
  catalog: CatalogApi;
  onReloadBill: () => Promise<BillDetail | null>;
  onSuccess: (info: {
    message: string;
    result: ExchangeBillResponse;
    stockChanged: boolean;
  }) => void;
  onCancelWorkflow: () => void;
}

interface ExchangeReturnDraft {
  logicalLineId: string;
  skuCode: string;
  productName: string;
  size: string | null;
  maxReturnable: number;
  quantityRaw: string;
  disposition: StockCondition;
}

interface ReplacementDraftLine {
  localId: number;
  skuId: string;
  skuCode: string;
  productName: string;
  size: string | null;
  defaultSellingPrice: string;
  quantityRaw: string;
  priceOverrideRaw: string;
  discountRaw: string;
  batchId: string | null;
  printedMrp: string | null;
  internalBarcode: string | null;
  batchLockedByTag: boolean;
  availableBatches: EligibleBatch[];
}

interface BatchModalState {
  kind: 'add' | 'assign-line';
  assignLocalId?: number;
  pendingItem?: ResolvedSkuItem;
  target: BatchSelectionTarget;
}

interface PendingExchangeSubmit {
  payloadKey: string;
  payload: ExchangeBillInput;
  idempotencyKey: string;
}

export function BillExchangeWorkflow({
  bill,
  billing,
  inventory,
  catalog,
  onReloadBill,
  onSuccess,
  onCancelWorkflow,
}: BillExchangeWorkflowProps) {
  const headingId = useId();
  const reasonId = useId();
  const reasonErrorId = useId();
  const nextRepIdRef = useRef(1);
  const reviewHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const submittingRef = useRef(false);

  const [returnDrafts, setReturnDrafts] = useState<ExchangeReturnDraft[]>(() =>
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
  const [replacementLines, setReplacementLines] = useState<ReplacementDraftLine[]>([]);
  const [settlementRows, setSettlementRows] = useState<SettlementDraftRow[]>([]);
  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [showValidation, setShowValidation] = useState(false);

  const [isLookingUpBarcode, setIsLookingUpBarcode] = useState(false);
  const [barcodeLookupError, setBarcodeLookupError] = useState<{
    message: string;
    requestId?: string | null;
  } | null>(null);
  const [isResolvingSku, setIsResolvingSku] = useState(false);
  const [isSkuPickerOpen, setIsSkuPickerOpen] = useState(false);
  const [skuPickerQuery, setSkuPickerQuery] = useState('');
  const [batchModal, setBatchModal] = useState<BatchModalState | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<PendingExchangeSubmit | null>(null);
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

  const invalidatePending = useCallback(() => {
    setPendingSubmit(null);
    setSubmitError(null);
    setStaleNotice(null);
  }, []);

  const addReplacementItem = useCallback(
    (item: ResolvedSkuItem, selectedBatch: EligibleBatch | null) => {
      invalidatePending();
      const localId = nextRepIdRef.current++;
      setReplacementLines((prev) => [
        ...prev,
        {
          localId,
          skuId: item.skuId,
          skuCode: item.skuCode,
          productName: item.productName,
          size: item.size,
          defaultSellingPrice: item.defaultSellingPrice,
          quantityRaw: '1',
          priceOverrideRaw: '',
          discountRaw: '',
          batchId: selectedBatch ? selectedBatch.batchId : item.batchId,
          printedMrp: selectedBatch ? selectedBatch.printedMrp : item.printedMrp,
          internalBarcode: selectedBatch?.internalBarcode ?? item.internalBarcode,
          batchLockedByTag: item.batchLockedByTag,
          availableBatches: item.eligibleBatches,
        },
      ]);
    },
    [invalidatePending],
  );

  const handleLookupBarcode = useCallback(
    async (rawCode: string): Promise<boolean> => {
      setBarcodeLookupError(null);
      setIsLookingUpBarcode(true);
      try {
        const result = await inventory.lookupBarcode(rawCode);
        const resolved = mapBarcodeLookupToResolvedItem(result);
        if (resolved.requiresBatchSelection) {
          setBatchModal({
            kind: 'add',
            pendingItem: resolved,
            target: {
              productName: resolved.productName,
              size: resolved.size,
              skuCode: resolved.skuCode,
              defaultSellingPrice: resolved.defaultSellingPrice,
              batches: resolved.eligibleBatches,
            },
          });
          return true;
        }
        addReplacementItem(resolved, null);
        return true;
      } catch (error) {
        setBarcodeLookupError(
          isApiClientError(error)
            ? { message: error.message, requestId: error.requestId }
            : { message: 'Unable to look up barcode.' },
        );
        if (isApiClientError(error) && error.code === 'BARCODE_NOT_FOUND') {
          setSkuPickerQuery(rawCode);
        }
        return false;
      } finally {
        setIsLookingUpBarcode(false);
      }
    },
    [addReplacementItem, inventory],
  );

  const handleSelectSku = async (sku: SkuListItem) => {
    setIsSkuPickerOpen(false);
    setBarcodeLookupError(null);
    setIsResolvingSku(true);
    try {
      const resolved = await resolveSkuSelectionForBilling(inventory, sku);
      if (resolved.requiresBatchSelection) {
        setBatchModal({
          kind: 'add',
          pendingItem: resolved,
          target: {
            productName: resolved.productName,
            size: resolved.size,
            skuCode: resolved.skuCode,
            defaultSellingPrice: resolved.defaultSellingPrice,
            batches: resolved.eligibleBatches,
          },
        });
        return;
      }
      addReplacementItem(resolved, null);
    } finally {
      setIsResolvingSku(false);
    }
  };

  const returnChecks = useMemo(
    () =>
      returnDrafts.map((draft) => {
        const trimmed = draft.quantityRaw.trim();
        const billLine = billLinesByLogicalId.get(draft.logicalLineId);
        const liveMax = billLine ? billLine.returnableQuantity : draft.maxReturnable;

        if (!trimmed || trimmed === '0') {
          return { qty: 0, error: undefined, creditPaise: 0 };
        }
        const parsed = parsePositiveWholeQuantity(trimmed);
        if (parsed === null) {
          return { qty: 0, error: 'Enter 0 or a positive integer.', creditPaise: 0 };
        }
        if (parsed > liveMax) {
          return {
            qty: parsed,
            error: `Cannot return ${parsed}; max returnable is ${liveMax}.`,
            creditPaise: 0,
          };
        }
        const credit = billLine ? computeReturnCreditPaise(billLine, parsed).netAbsPaise : 0;
        return { qty: parsed, error: undefined, creditPaise: credit };
      }),
    [returnDrafts, billLinesByLogicalId],
  );

  const selectedReturns = returnDrafts
    .map((draft, i) => ({ draft, check: returnChecks[i] }))
    .filter((entry) => entry.check.qty > 0 && !entry.check.error);

  const replacementChecks = useMemo(
    () =>
      replacementLines.map((line) => {
        let quantityError: string | undefined;
        let priceError: string | undefined;
        let discountError: string | undefined;

        const qty = parsePositiveWholeQuantity(line.quantityRaw);
        if (qty === null) {
          quantityError = 'Enter a whole quantity of 1 or more.';
        }

        let normalizedPrice: string | null = null;
        let effectivePrice = line.defaultSellingPrice;
        if (line.priceOverrideRaw.trim().length > 0) {
          const parsed = normalizeInrPriceInput(line.priceOverrideRaw);
          if (!parsed.ok) {
            priceError = parsed.error;
          } else {
            normalizedPrice = parsed.value;
            effectivePrice = parsed.value;
          }
        }

        let normalizedDiscount: string | null = null;
        let effectiveDisc = '0.00';
        if (line.discountRaw.trim().length > 0) {
          const parsed = normalizeInrPriceInput(line.discountRaw);
          if (!parsed.ok) {
            discountError = parsed.error;
          } else {
            normalizedDiscount = parsed.value;
            effectiveDisc = parsed.value;
          }
        }

        const unitPaise = parseInrToPaise(effectivePrice) ?? 0;
        const discPaise = parseInrToPaise(effectiveDisc) ?? 0;
        if (!discountError && qty !== null && discPaise > qty * unitPaise) {
          discountError = 'Line discount cannot exceed line subtotal.';
        }
        const lineTotalPaise =
          qty !== null && !priceError && !discountError
            ? Math.max(0, qty * unitPaise - discPaise)
            : 0;

        const valid = !quantityError && !priceError && !discountError && qty !== null;
        const apiLine: BillLineInput | null =
          valid && qty !== null
            ? {
                skuId: line.skuId,
                quantity: qty,
                ...(line.batchId ? { batchId: line.batchId } : {}),
                ...(normalizedDiscount !== null ? { discountAmount: normalizedDiscount } : {}),
                ...(normalizedPrice !== null ? { unitPriceOverride: normalizedPrice } : {}),
              }
            : null;

        return {
          valid,
          quantityError,
          priceError,
          discountError,
          qty: qty ?? 0,
          lineTotalPaise,
          apiLine,
        };
      }),
    [replacementLines],
  );

  const returnedCreditPaise = selectedReturns.reduce(
    (sum, item) => sum + item.check.creditPaise,
    0,
  );
  const replacementTotalPaise = replacementChecks.reduce(
    (sum, item) => sum + item.lineTotalPaise,
    0,
  );
  const priceDifferencePaise = replacementTotalPaise - returnedCreditPaise;

  const currentTotalPaise = parseInrToPaise(bill.total) ?? 0;
  const currentPaidPaise = parseInrToPaise(bill.paid) ?? 0;
  const adjustedTotalPaise = Math.max(0, currentTotalPaise + priceDifferencePaise);

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

  const hasReturnError = returnChecks.some((c) => Boolean(c.error));
  const hasReplacementError = replacementChecks.some((c) => !c.valid);
  const missingSelectionError =
    selectedReturns.length === 0
      ? 'Select at least one returned piece.'
      : replacementLines.length === 0
        ? 'Add at least one replacement item.'
        : null;

  const reasonError =
    reason.trim().length === 0
      ? 'Enter an exchange reason.'
      : reason.trim().length > 500
        ? 'Reason must not exceed 500 characters.'
        : null;

  const handleReviewClick = () => {
    setShowValidation(true);
    setReasonTouched(true);
    setSubmitError(null);
    if (
      hasReturnError ||
      hasReplacementError ||
      missingSelectionError ||
      reasonError ||
      !settlementValidation.valid
    ) {
      return;
    }
    setStep('review');
    window.setTimeout(() => {
      reviewHeadingRef.current?.focus();
    }, 0);
  };

  const executeExchange = async (attempt: PendingExchangeSubmit) => {
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    setStaleNotice(null);

    try {
      const response = await billing.exchangeItems(
        bill.billId,
        attempt.payload,
        attempt.idempotencyKey,
      );
      setPendingSubmit(null);
      onSuccess({
        message: `Exchange posted on ${bill.billNumber}. Price difference: ${formatInrDisplay(response.priceDifference)}, Updated balance due: ${formatInrDisplay(response.balanceDue)}.`,
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
              ? `${error.message} Reloaded ${refreshed.billNumber} (Rev ${refreshed.currentRevisionNumber}, Version ${refreshed.version}, Balance due ${formatInrDisplay(refreshed.balanceDue)}). Review quantities before resubmitting.`
              : `${error.message} Reloaded latest bill; review and resubmit.`,
          );
        } else if (error.code === 'INSUFFICIENT_STOCK') {
          setPendingSubmit(null);
          setStep('edit');
          setSubmitError({
            message: `${error.message} No stock or bill changes were applied. Update or remove the unavailable replacement item below and try again.`,
            requestId: error.requestId,
          });
        } else if (error.code === 'BATCH_SELECTION_REQUIRED') {
          setPendingSubmit(null);
          const batches = parseSelectableBatches(error.details?.selectableBatches);
          if (batches.length > 0) {
            const targetLine = replacementLines.find(
              (line) => !line.batchId && batches.some((b) => !b.skuId || b.skuId === line.skuId),
            );
            if (targetLine) {
              setReplacementLines((prev) =>
                prev.map((l) =>
                  l.localId === targetLine.localId
                    ? {
                        ...l,
                        availableBatches: batches.filter(
                          (b) => !b.skuId || b.skuId === targetLine.skuId,
                        ),
                      }
                    : l,
                ),
              );
            }
          }
          setStep('edit');
          setSubmitError({
            message: `${error.message} Select the replacement printed-MRP batch below and resubmit.`,
            requestId: error.requestId,
          });
        } else if (error.kind === 'network' || error.kind === 'server') {
          setPendingSubmit(attempt);
          setSubmitError({
            message:
              'Connection lost before exchange confirmation. Click Retry exchange to reuse the exact Idempotency-Key.',
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
            message: fieldSummary || error.message || 'Unable to process exchange.',
            requestId: error.requestId,
          });
        }
      } else {
        setPendingSubmit(attempt);
        setSubmitError({
          message: 'Unexpected error while submitting exchange. Retry cleanly below.',
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

    if (
      hasReturnError ||
      hasReplacementError ||
      missingSelectionError ||
      reasonError ||
      !settlementValidation.valid
    ) {
      return;
    }

    const returnedLines: ReturnLineInput[] = selectedReturns.map((entry) => ({
      lineId: entry.draft.logicalLineId,
      quantity: entry.check.qty,
      disposition: entry.draft.disposition,
    }));

    const preparedReplacements = replacementChecks
      .map((entry) => entry.apiLine)
      .filter((item): item is BillLineInput => item !== null);

    const payload: ExchangeBillInput = {
      expectedVersion: bill.version,
      reason: reason.trim(),
      returnedLines,
      replacementLines: preparedReplacements,
      settlement: settlementValidation.apiEntries,
    };
    const payloadKey = JSON.stringify(payload);
    const attempt: PendingExchangeSubmit =
      pendingSubmit && pendingSubmit.payloadKey === payloadKey
        ? pendingSubmit
        : {
            payloadKey,
            payload,
            idempotencyKey: generateBillIdempotencyKey(),
          };

    void executeExchange(attempt);
  };

  return (
    <section className="surface-card billing-workflow-panel" aria-labelledby={headingId}>
      <div className="billing-workflow-header">
        <div>
          <h2 id={headingId}>Exchange Items — {bill.billNumber}</h2>
          <div className="billing-workflow-billref">
            <span>Revision {bill.currentRevisionNumber}</span>
            <span>·</span>
            <span>Version {bill.version}</span>
            <span>·</span>
            <span>Current total {formatInrDisplay(bill.total)}</span>
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
            <div className="billing-exchange-grid">
              <div className="billing-counter-panel">
                <h3>1. Items Returned by Customer</h3>
                <div className="billing-cart-list">
                  {returnDrafts.map((line, index) => {
                    const liveLine = billLinesByLogicalId.get(line.logicalLineId);
                    const maxReturnable = liveLine ? liveLine.returnableQuantity : line.maxReturnable;
                    const check = returnChecks[index];
                    const qtyId = `exch-ret-qty-${line.logicalLineId}`;
                    const radioName = `exch-ret-disp-${line.logicalLineId}`;

                    return (
                      <article key={line.logicalLineId} className="billing-cart-item">
                        <div className="billing-cart-item__top">
                          <div className="billing-cart-item__title">
                            <span className="billing-cart-item__name">
                              {line.productName} {line.size ? `(Size ${line.size})` : '(Unsized)'}
                            </span>
                            <div className="billing-cart-item__meta">
                              <span>
                                SKU: <code>{line.skuCode}</code>
                              </span>
                              <span>
                                Returnable: <strong>{maxReturnable}</strong>
                              </span>
                            </div>
                          </div>
                          <div className="billing-cart-item__total">
                            {check.qty > 0 && !check.error ? (
                              <span>-{formatInrDisplay(formatPaiseToInr(check.creditPaise))}</span>
                            ) : (
                              <span>₹0.00</span>
                            )}
                          </div>
                        </div>

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
                              setReturnDrafts((prev) =>
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
                                  setReturnDrafts((prev) =>
                                    prev.map((item, idx) =>
                                      idx === index ? { ...item, disposition: 'SELLABLE' } : item,
                                    ),
                                  );
                                }}
                              />
                              <span>
                                <strong>Sellable</strong> — returns to available stock
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
                                  setReturnDrafts((prev) =>
                                    prev.map((item, idx) =>
                                      idx === index
                                        ? { ...item, disposition: 'NON_SELLABLE' }
                                        : item,
                                    ),
                                  );
                                }}
                              />
                              <span>
                                <strong>Non-sellable / damaged</strong> — out of sellable stock
                              </span>
                            </label>
                          </div>
                        </fieldset>
                      </article>
                    );
                  })}
                </div>
              </div>

              <div className="billing-counter-panel">
                <h3>2. Replacement Items</h3>
                <BarcodeScannerPanel
                  isLookingUp={isLookingUpBarcode}
                  lookupError={barcodeLookupError}
                  disabled={isSubmitting || isResolvingSku}
                  onLookupCode={handleLookupBarcode}
                />
                <div>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={isSubmitting || isResolvingSku}
                    onClick={() => setIsSkuPickerOpen(true)}
                  >
                    {isResolvingSku ? 'Checking batches…' : 'Search Replacement Product'}
                  </button>
                </div>

                {replacementLines.length === 0 ? (
                  <p className="catalog-field-hint">
                    Scan or search a replacement SKU (e.g. Size 34 replacement).
                  </p>
                ) : (
                  <div className="billing-cart-list">
                    {replacementLines.map((line, index) => {
                      const check = replacementChecks[index];
                      const qtyId = `exch-rep-qty-${line.localId}`;
                      const priceId = `exch-rep-price-${line.localId}`;
                      const discId = `exch-rep-disc-${line.localId}`;

                      return (
                        <article key={line.localId} className="billing-cart-item">
                          <div className="billing-cart-item__top">
                            <div className="billing-cart-item__title">
                              <span className="billing-cart-item__name">
                                {line.productName}{' '}
                                {line.size ? `(Size ${line.size})` : '(Unsized)'}
                              </span>
                              <div className="billing-cart-item__meta">
                                <span>
                                  SKU: <code>{line.skuCode}</code>
                                </span>
                                <span>Price: {formatInrDisplay(line.defaultSellingPrice)}</span>
                                {line.printedMrp ? (
                                  <span>Printed MRP: {formatInrDisplay(line.printedMrp)}</span>
                                ) : null}
                                {line.batchId ? (
                                  <span className="billing-cart-badge">
                                    {line.internalBarcode
                                      ? `Tag: ${line.internalBarcode}`
                                      : 'Batch selected'}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <div className="billing-cart-item__total">
                              <span>
                                +{formatInrDisplay(formatPaiseToInr(check.lineTotalPaise))}
                              </span>
                            </div>
                          </div>

                          <div className="billing-cart-item__controls">
                            <div className="catalog-field">
                              <label htmlFor={qtyId} className="catalog-label">
                                Replacement qty ({line.productName})
                              </label>
                              <input
                                id={qtyId}
                                type="text"
                                inputMode="numeric"
                                className="catalog-input"
                                value={line.quantityRaw}
                                disabled={isSubmitting}
                                onChange={(event) => {
                                  invalidatePending();
                                  setReplacementLines((prev) =>
                                    prev.map((item, idx) =>
                                      idx === index
                                        ? { ...item, quantityRaw: event.target.value }
                                        : item,
                                    ),
                                  );
                                }}
                                aria-invalid={check.quantityError ? 'true' : 'false'}
                              />
                              {check.quantityError ? (
                                <p className="catalog-field-error" role="alert">
                                  {check.quantityError}
                                </p>
                              ) : null}
                            </div>

                            <div className="catalog-field">
                              <label htmlFor={priceId} className="catalog-label">
                                Price override (₹)
                              </label>
                              <input
                                id={priceId}
                                type="text"
                                inputMode="decimal"
                                className="catalog-input"
                                placeholder={line.defaultSellingPrice}
                                value={line.priceOverrideRaw}
                                disabled={isSubmitting}
                                onChange={(event) => {
                                  invalidatePending();
                                  setReplacementLines((prev) =>
                                    prev.map((item, idx) =>
                                      idx === index
                                        ? { ...item, priceOverrideRaw: event.target.value }
                                        : item,
                                    ),
                                  );
                                }}
                                aria-invalid={check.priceError ? 'true' : 'false'}
                              />
                              {check.priceError ? (
                                <p className="catalog-field-error" role="alert">
                                  {check.priceError}
                                </p>
                              ) : null}
                            </div>

                            <div className="catalog-field">
                              <label htmlFor={discId} className="catalog-label">
                                Discount (₹)
                              </label>
                              <input
                                id={discId}
                                type="text"
                                inputMode="decimal"
                                className="catalog-input"
                                placeholder="0.00"
                                value={line.discountRaw}
                                disabled={isSubmitting}
                                onChange={(event) => {
                                  invalidatePending();
                                  setReplacementLines((prev) =>
                                    prev.map((item, idx) =>
                                      idx === index
                                        ? { ...item, discountRaw: event.target.value }
                                        : item,
                                    ),
                                  );
                                }}
                                aria-invalid={check.discountError ? 'true' : 'false'}
                              />
                              {check.discountError ? (
                                <p className="catalog-field-error" role="alert">
                                  {check.discountError}
                                </p>
                              ) : null}
                            </div>
                          </div>

                          <div className="billing-cart-item__actions">
                            <div>
                              {!line.batchLockedByTag && line.availableBatches.length > 0 ? (
                                <button
                                  type="button"
                                  className="btn-table-action"
                                  disabled={isSubmitting}
                                  onClick={() =>
                                    setBatchModal({
                                      kind: 'assign-line',
                                      assignLocalId: line.localId,
                                      target: {
                                        productName: line.productName,
                                        size: line.size,
                                        skuCode: line.skuCode,
                                        defaultSellingPrice: line.defaultSellingPrice,
                                        batches: line.availableBatches,
                                      },
                                    })
                                  }
                                >
                                  {line.batchId ? 'Change batch' : 'Select batch'}
                                </button>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              className="btn-table-action btn-table-action--danger"
                              disabled={isSubmitting}
                              onClick={() => {
                                invalidatePending();
                                setReplacementLines((prev) =>
                                  prev.filter((item) => item.localId !== line.localId),
                                );
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {showValidation && missingSelectionError ? (
              <div className="alert-banner alert-banner--error" role="alert">
                <div className="alert-banner__content">
                  <p>{missingSelectionError}</p>
                </div>
              </div>
            ) : null}

            <div className="billing-totals-box" aria-live="polite">
              <div className="billing-total-row">
                <span>Returned credit</span>
                <span>-{formatInrDisplay(formatPaiseToInr(returnedCreditPaise))}</span>
              </div>
              <div className="billing-total-row">
                <span>Replacement items value</span>
                <span>+{formatInrDisplay(formatPaiseToInr(replacementTotalPaise))}</span>
              </div>
              <div className="billing-total-row billing-total-row--grand">
                <span>Exchange price difference</span>
                <span>
                  {priceDifferencePaise > 0
                    ? `+${formatInrDisplay(formatPaiseToInr(priceDifferencePaise))} (Extra charge)`
                    : priceDifferencePaise < 0
                      ? `-${formatInrDisplay(formatPaiseToInr(Math.abs(priceDifferencePaise)))} (Credit / Refund)`
                      : '₹0.00 (Even exchange)'}
                </span>
              </div>
            </div>

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
              idPrefix="exchange"
            />

            <div className="catalog-field">
              <label htmlFor={reasonId} className="catalog-label">
                Exchange reason <span aria-hidden="true">*</span>
              </label>
              <textarea
                id={reasonId}
                className="billing-reason-textarea"
                maxLength={500}
                required
                placeholder="e.g. Exchanged size 32 for size 34"
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
                type="button"
                className="btn-primary"
                disabled={isSubmitting}
                onClick={handleReviewClick}
              >
                Review Exchange
              </button>
            </div>
          </>
        ) : (
          <div className="billing-review-box">
            <h3 ref={reviewHeadingRef} tabIndex={-1}>
              Review exchange on {bill.billNumber}
            </h3>

            <ul className="po-recent-list" aria-label="Expected stock and item changes">
              {selectedReturns.map((entry) => (
                <li key={`ret-${entry.draft.logicalLineId}`}>
                  <strong>Returned</strong>: {entry.draft.productName}{' '}
                  {entry.draft.size ? `Size ${entry.draft.size} ` : ''}(
                  <code>{entry.draft.skuCode}</code>) × {entry.check.qty} →{' '}
                  {entry.draft.disposition === 'SELLABLE'
                    ? `+${entry.check.qty} back to SELLABLE stock`
                    : `+${entry.check.qty} as NON_SELLABLE (kept out of sellable stock)`}
                </li>
              ))}
              {replacementLines.map((line, index) => (
                <li key={`rep-${line.localId}`}>
                  <strong>Replacement</strong>: {line.productName}{' '}
                  {line.size ? `Size ${line.size} ` : ''}(<code>{line.skuCode}</code>) ×{' '}
                  {replacementChecks[index].qty} → -{replacementChecks[index].qty} deducted from
                  SELLABLE stock
                </li>
              ))}
            </ul>

            <div className="billing-totals-box">
              <div className="billing-total-row">
                <span>Price difference</span>
                <span>
                  {priceDifferencePaise > 0
                    ? `+${formatInrDisplay(formatPaiseToInr(priceDifferencePaise))}`
                    : priceDifferencePaise < 0
                      ? `-${formatInrDisplay(formatPaiseToInr(Math.abs(priceDifferencePaise)))}`
                      : '₹0.00'}
                </span>
              </div>
              <div className="billing-total-row">
                <span>New bill total</span>
                <span>{formatInrDisplay(formatPaiseToInr(adjustedTotalPaise))}</span>
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
                Reason: {reason.trim()} · Stock updates are confirmed only after the API succeeds.
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
                          void executeExchange(pendingSubmit);
                        }}
                      >
                        Retry exchange
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
                {isSubmitting ? 'Posting exchange…' : 'Confirm & Post Exchange'}
              </button>
            </div>
          </div>
        )}
      </form>

      <SkuPickerModal
        open={isSkuPickerOpen}
        api={catalog}
        initialQuery={skuPickerQuery}
        onClose={() => setIsSkuPickerOpen(false)}
        onSelect={(sku) => {
          void handleSelectSku(sku);
        }}
      />

      <BatchSelectionModal
        open={batchModal !== null}
        target={batchModal?.target ?? null}
        onClose={() => setBatchModal(null)}
        onSelectBatch={(batch) => {
          const modal = batchModal;
          setBatchModal(null);
          if (!modal) return;
          if (modal.kind === 'add' && modal.pendingItem) {
            addReplacementItem(modal.pendingItem, batch);
            return;
          }
          if (modal.kind === 'assign-line' && modal.assignLocalId !== undefined) {
            invalidatePending();
            setReplacementLines((prev) =>
              prev.map((item) =>
                item.localId === modal.assignLocalId
                  ? { ...item, batchId: batch.batchId, printedMrp: batch.printedMrp }
                  : item,
              ),
            );
          }
        }}
      />
    </section>
  );
}

export function ExchangeConfirmationBanner({
  message,
  result,
}: {
  message: string;
  result: ExchangeBillResponse;
}) {
  return (
    <div className="surface-card alert-banner--success billing-counter-panel" role="status">
      <p>
        <strong>{message}</strong> (Exchange ID: <code>{result.exchangeId}</code> · New version:{' '}
        {result.version})
      </p>
      <StockEffectsList effects={result.stockEffects} />
    </div>
  );
}
