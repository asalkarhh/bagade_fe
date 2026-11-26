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
import {
  generateBillIdempotencyKey,
  parsePositiveWholeQuantity,
  parseTotalsSnapshot,
  type PriceTotalsSnapshot,
} from '../cartUtils.ts';
import {
  computeRevisionActiveNetPaise,
  parseSelectableBatches,
  validateSettlementEntries,
  type SettlementDraftRow,
} from '../correctionUtils.ts';
import {
  mapBarcodeLookupToResolvedItem,
  resolveSkuSelectionForBilling,
  type ResolvedSkuItem,
} from '../skuLookupHelper.ts';
import type { BillDetail, EditBillLineInput, EditBillResponse, ReviseBillInput } from '../types.ts';
import { BatchSelectionModal, type BatchSelectionTarget } from './BatchSelectionModal.tsx';
import { SettlementEntriesEditor } from './SettlementEntriesEditor.tsx';

export interface BillEditWorkflowProps {
  bill: BillDetail;
  billing: BillingApi;
  inventory: InventoryApi;
  catalog: CatalogApi;
  onReloadBill: () => Promise<BillDetail | null>;
  onSuccess: (info: {
    message: string;
    result: EditBillResponse;
    stockChanged: boolean;
  }) => void;
  onCancelWorkflow: () => void;
}

interface EditDraftLine {
  localId: number;
  lineId: string | null;
  skuId: string;
  skuCode: string;
  productName: string;
  size: string | null;
  originalQuantity: number;
  returnedQuantity: number;
  originalUnitSellingPrice: string;
  defaultUnitSellingPrice: string;
  quantityRaw: string;
  unitPriceRaw: string;
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

interface PendingEditSubmit {
  payloadKey: string;
  payload: ReviseBillInput;
  idempotencyKey: string;
  stockChanged: boolean;
}

export function BillEditWorkflow({
  bill,
  billing,
  inventory,
  catalog,
  onReloadBill,
  onSuccess,
  onCancelWorkflow,
}: BillEditWorkflowProps) {
  const headingId = useId();
  const reasonId = useId();
  const reasonErrorId = useId();
  const nextLocalIdRef = useRef(bill.lines.length + 1);
  const reviewHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const submittingRef = useRef(false);

  const [draftLines, setDraftLines] = useState<EditDraftLine[]>(() =>
    bill.lines.map((line, index) => ({
      localId: index + 1,
      lineId: line.logicalLineId,
      skuId: line.skuId,
      skuCode: line.skuCode,
      productName: line.productName,
      size: line.size,
      originalQuantity: line.quantity,
      returnedQuantity: line.returnedQuantity,
      originalUnitSellingPrice: line.unitSellingPrice,
      defaultUnitSellingPrice: line.unitSellingPrice,
      quantityRaw: String(line.quantity),
      unitPriceRaw: line.unitSellingPrice,
      discountRaw: line.discountAmount === '0.00' ? '' : line.discountAmount,
      batchId: null,
      printedMrp: null,
      internalBarcode: null,
      batchLockedByTag: false,
      availableBatches: [],
    })),
  );

  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  const [settlementRows, setSettlementRows] = useState<SettlementDraftRow[]>([]);
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
  const [pendingSubmit, setPendingSubmit] = useState<PendingEditSubmit | null>(null);
  const [serverTotalsOverride, setServerTotalsOverride] = useState<PriceTotalsSnapshot | null>(
    null,
  );
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
    setServerTotalsOverride(null);
  }, []);

  const appendResolvedItem = useCallback(
    (item: ResolvedSkuItem, selectedBatch: EligibleBatch | null) => {
      invalidatePending();
      const localId = nextLocalIdRef.current++;
      setDraftLines((prev) => [
        ...prev,
        {
          localId,
          lineId: null,
          skuId: item.skuId,
          skuCode: item.skuCode,
          productName: item.productName,
          size: item.size,
          originalQuantity: 0,
          returnedQuantity: 0,
          originalUnitSellingPrice: item.defaultSellingPrice,
          defaultUnitSellingPrice: item.defaultSellingPrice,
          quantityRaw: '1',
          unitPriceRaw: '',
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
        appendResolvedItem(resolved, null);
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
    [appendResolvedItem, inventory],
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
      appendResolvedItem(resolved, null);
    } finally {
      setIsResolvingSku(false);
    }
  };

  const lineValidations = useMemo(
    () =>
      draftLines.map((line) => {
        const liveOriginal = line.lineId ? billLinesByLogicalId.get(line.lineId) : undefined;
        const returnedQty = liveOriginal ? liveOriginal.returnedQuantity : line.returnedQuantity;
        const origQty = liveOriginal ? liveOriginal.quantity : line.originalQuantity;

        let quantityError: string | undefined;
        let priceError: string | undefined;
        let discountError: string | undefined;

        const qty = parsePositiveWholeQuantity(line.quantityRaw);
        if (qty === null) {
          quantityError = 'Enter a whole quantity of 1 or more.';
        } else if (returnedQty > 0 && qty < returnedQty) {
          quantityError = `Quantity cannot be below already returned units (${returnedQty}).`;
        }

        let normalizedPriceOverride: string | null = null;
        let effectivePriceStr = line.defaultUnitSellingPrice;
        if (line.unitPriceRaw.trim().length > 0) {
          const parsed = normalizeInrPriceInput(line.unitPriceRaw);
          if (!parsed.ok) {
            priceError = parsed.error;
          } else {
            effectivePriceStr = parsed.value;
            if (line.lineId === null || parsed.value !== line.originalUnitSellingPrice) {
              normalizedPriceOverride = parsed.value;
            }
          }
        }

        let normalizedDiscount: string | null = null;
        let effectiveDiscountStr = '0.00';
        if (line.discountRaw.trim().length > 0) {
          const parsed = normalizeInrPriceInput(line.discountRaw);
          if (!parsed.ok) {
            discountError = parsed.error;
          } else {
            normalizedDiscount = parsed.value;
            effectiveDiscountStr = parsed.value;
          }
        }

        const unitPaise = parseInrToPaise(effectivePriceStr) ?? 0;
        const discPaise = parseInrToPaise(effectiveDiscountStr) ?? 0;
        if (!discountError && qty !== null && discPaise > qty * unitPaise) {
          discountError = 'Line discount cannot exceed line subtotal.';
        }

        const activeNetPaise =
          qty !== null && !priceError && !discountError
            ? computeRevisionActiveNetPaise({
                quantity: qty,
                returnedQuantity: returnedQty,
                originalQuantity: origQty,
                unitPricePaise: unitPaise,
                discountPaise: discPaise,
              })
            : 0;

        const valid = !quantityError && !priceError && !discountError && qty !== null;
        const apiLine: EditBillLineInput | null =
          valid && qty !== null
            ? {
                ...(line.lineId ? { lineId: line.lineId } : {}),
                skuId: line.skuId,
                quantity: qty,
                ...(line.batchId ? { batchId: line.batchId } : {}),
                ...(normalizedDiscount !== null ? { discountAmount: normalizedDiscount } : {}),
                ...(normalizedPriceOverride !== null
                  ? { unitPriceOverride: normalizedPriceOverride }
                  : {}),
              }
            : null;

        return {
          valid,
          quantityError,
          priceError,
          discountError,
          qty: qty ?? 0,
          origQty,
          activeNetPaise,
          apiLine,
        };
      }),
    [draftLines, billLinesByLogicalId],
  );

  const computedTotalPaise = useMemo(
    () => lineValidations.reduce((sum, entry) => sum + entry.activeNetPaise, 0),
    [lineValidations],
  );
  const authoritativeTotalPaise = serverTotalsOverride
    ? (parseInrToPaise(serverTotalsOverride.total) ?? computedTotalPaise)
    : computedTotalPaise;

  const currentPaidPaise = parseInrToPaise(bill.paid) ?? 0;
  const settlementValidation = useMemo(
    () =>
      validateSettlementEntries(
        settlementRows,
        currentPaidPaise,
        authoritativeTotalPaise,
        Boolean(bill.customerId),
        ['PAYMENT', 'REFUND'],
      ),
    [settlementRows, currentPaidPaise, authoritativeTotalPaise, bill.customerId],
  );

  const removedOriginalLines = useMemo(() => {
    const keptIds = new Set(draftLines.map((l) => l.lineId).filter(Boolean));
    return bill.lines.filter((line) => !keptIds.has(line.logicalLineId));
  }, [bill.lines, draftLines]);

  const hasStockMovementExpected = useMemo(() => {
    if (removedOriginalLines.length > 0) {
      return true;
    }
    return draftLines.some((line, index) => {
      if (line.lineId === null) {
        return true;
      }
      return lineValidations[index].qty !== lineValidations[index].origQty;
    });
  }, [removedOriginalLines.length, draftLines, lineValidations]);

  const hasLineError = lineValidations.some((l) => !l.valid);
  const reasonError =
    reason.trim().length === 0
      ? 'Enter a reason for editing this bill.'
      : reason.trim().length > 500
        ? 'Reason must not exceed 500 characters.'
        : null;

  const handleReviewClick = () => {
    setShowValidation(true);
    setReasonTouched(true);
    setSubmitError(null);
    if (draftLines.length === 0 || hasLineError || reasonError || !settlementValidation.valid) {
      return;
    }
    setStep('review');
    window.setTimeout(() => {
      reviewHeadingRef.current?.focus();
    }, 0);
  };

  const executeRevise = async (attempt: PendingEditSubmit) => {
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    setStaleNotice(null);

    try {
      const result = await billing.reviseBill(bill.billId, attempt.payload, attempt.idempotencyKey);
      setPendingSubmit(null);
      onSuccess({
        message: `Revision ${result.revision} saved for ${bill.billNumber}. Updated total: ${formatInrDisplay(result.total)}, Balance due: ${formatInrDisplay(result.balanceDue)}.`,
        result,
        stockChanged: attempt.stockChanged,
      });
    } catch (error) {
      if (isApiClientError(error)) {
        if (error.code === 'PRICE_CHANGED') {
          setPendingSubmit(null);
          const revised = parseTotalsSnapshot(error.details?.currentTotals);
          setServerTotalsOverride(revised);
          setStep('edit');
          setStaleNotice(
            revised
              ? `Catalog prices changed while editing. Backend revised total is ${formatInrDisplay(revised.total)}. Review lines and settlement before confirming.`
              : `${error.message} Review the updated amount before submitting again.`,
          );
        } else if (error.code === 'STALE_VERSION') {
          setPendingSubmit(null);
          const refreshed = await onReloadBill();
          setStep('edit');
          setStaleNotice(
            refreshed
              ? `${error.message} Reloaded ${refreshed.billNumber} (Rev ${refreshed.currentRevisionNumber}, Version ${refreshed.version}, Balance due ${formatInrDisplay(refreshed.balanceDue)}). Review changes and resubmit.`
              : `${error.message} Reloaded latest bill details; review before resubmitting.`,
          );
        } else if (error.code === 'BATCH_SELECTION_REQUIRED') {
          setPendingSubmit(null);
          const batches = parseSelectableBatches(error.details?.selectableBatches);
          if (batches.length > 0) {
            const targetLine = draftLines.find(
              (line) => !line.batchId && batches.some((b) => !b.skuId || b.skuId === line.skuId),
            );
            if (targetLine) {
              setDraftLines((prev) =>
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
            message: `${error.message} Choose a batch on the newly added or increased line and try again.`,
            requestId: error.requestId,
          });
        } else if (error.kind === 'network' || error.kind === 'server') {
          setPendingSubmit(attempt);
          setSubmitError({
            message:
              'Connection lost before revision was confirmed. Click Retry revision to reuse the exact Idempotency-Key safely.',
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
            message: fieldSummary || error.message || 'Unable to save bill revision.',
            requestId: error.requestId,
          });
        }
      } else {
        setPendingSubmit(attempt);
        setSubmitError({
          message: 'Unexpected error while saving revision. Retry cleanly below.',
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

    if (draftLines.length === 0 || hasLineError || reasonError || !settlementValidation.valid) {
      return;
    }

    const lines = lineValidations
      .map((v) => v.apiLine)
      .filter((item): item is EditBillLineInput => item !== null);

    const expectedTotal = serverTotalsOverride
      ? serverTotalsOverride.total
      : formatPaiseToInr(computedTotalPaise);

    const payload: ReviseBillInput = {
      expectedVersion: bill.version,
      reason: reason.trim(),
      lines,
      expectedTotal,
      settlement: settlementValidation.apiEntries,
    };
    const payloadKey = JSON.stringify(payload);
    const attempt: PendingEditSubmit =
      pendingSubmit && pendingSubmit.payloadKey === payloadKey
        ? pendingSubmit
        : {
            payloadKey,
            payload,
            idempotencyKey: generateBillIdempotencyKey(),
            stockChanged: hasStockMovementExpected,
          };

    void executeRevise(attempt);
  };

  return (
    <section className="surface-card billing-workflow-panel" aria-labelledby={headingId}>
      <div className="billing-workflow-header">
        <div>
          <h2 id={headingId}>Edit Bill — {bill.billNumber}</h2>
          <div className="billing-workflow-billref">
            <span>Current revision {bill.currentRevisionNumber}</span>
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
            <div className="billing-cart-list">
              {draftLines.map((line, index) => {
                const check = lineValidations[index];
                const isLockedByReturn = line.returnedQuantity > 0;
                const canPickBatch =
                  !line.batchLockedByTag &&
                  (line.lineId === null || check.qty > check.origQty) &&
                  line.availableBatches.length > 0;
                const qtyId = `edit-qty-${line.localId}`;
                const priceId = `edit-price-${line.localId}`;
                const discId = `edit-disc-${line.localId}`;

                return (
                  <article key={line.localId} className="billing-cart-item">
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
                            {line.lineId ? `Original qty: ${check.origQty}` : 'Added item'}
                          </span>
                          {isLockedByReturn ? (
                            <span className="billing-cart-badge">
                              Returned: {line.returnedQuantity} (price &amp; discount locked)
                            </span>
                          ) : null}
                          {line.batchId ? (
                            <span className="billing-cart-badge">
                              {line.internalBarcode
                                ? `Tag: ${line.internalBarcode}`
                                : `Batch selected`}
                            </span>
                          ) : null}
                          {line.printedMrp ? (
                            <span>Printed MRP: {formatInrDisplay(line.printedMrp)}</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="billing-cart-item__total">
                        <span>{formatInrDisplay(formatPaiseToInr(check.activeNetPaise))}</span>
                      </div>
                    </div>

                    <div className="billing-cart-item__controls">
                      <div className="catalog-field">
                        <label htmlFor={qtyId} className="catalog-label">
                          Quantity ({line.productName})
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
                            setDraftLines((prev) =>
                              prev.map((item, idx) =>
                                idx === index ? { ...item, quantityRaw: event.target.value } : item,
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
                          Unit selling price (₹)
                        </label>
                        <input
                          id={priceId}
                          type="text"
                          inputMode="decimal"
                          className="catalog-input"
                          placeholder={line.defaultUnitSellingPrice}
                          value={line.unitPriceRaw}
                          disabled={isSubmitting || isLockedByReturn}
                          onChange={(event) => {
                            invalidatePending();
                            setDraftLines((prev) =>
                              prev.map((item, idx) =>
                                idx === index ? { ...item, unitPriceRaw: event.target.value } : item,
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
                          Line discount (₹)
                        </label>
                        <input
                          id={discId}
                          type="text"
                          inputMode="decimal"
                          className="catalog-input"
                          placeholder="0.00"
                          value={line.discountRaw}
                          disabled={isSubmitting || isLockedByReturn}
                          onChange={(event) => {
                            invalidatePending();
                            setDraftLines((prev) =>
                              prev.map((item, idx) =>
                                idx === index ? { ...item, discountRaw: event.target.value } : item,
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
                        {canPickBatch ? (
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
                                  defaultSellingPrice: line.defaultUnitSellingPrice,
                                  batches: line.availableBatches,
                                },
                              })
                            }
                          >
                            {line.batchId ? 'Change batch' : 'Choose batch'}
                          </button>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="btn-table-action btn-table-action--danger"
                        disabled={isSubmitting || isLockedByReturn || draftLines.length <= 1}
                        onClick={() => {
                          invalidatePending();
                          setDraftLines((prev) => prev.filter((item) => item.localId !== line.localId));
                        }}
                      >
                        Remove line
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="surface-card billing-counter-panel">
              <h3>Add product to revision</h3>
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
                  {isResolvingSku ? 'Checking batches…' : 'Search / Add SKU'}
                </button>
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
              adjustedTotalPaise={authoritativeTotalPaise}
              hasCustomer={Boolean(bill.customerId)}
              disabled={isSubmitting}
              showValidation={showValidation}
              idPrefix="edit"
            />

            <div className="catalog-field">
              <label htmlFor={reasonId} className="catalog-label">
                Revision reason <span aria-hidden="true">*</span>
              </label>
              <textarea
                id={reasonId}
                className="billing-reason-textarea"
                maxLength={500}
                required
                placeholder="e.g. Agreed festival price discount or added matching blouse"
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
                Review Revision
              </button>
            </div>
          </>
        ) : (
          <div className="billing-review-box">
            <h3 ref={reviewHeadingRef} tabIndex={-1}>
              Review revision for {bill.billNumber}
            </h3>

            <ul className="po-recent-list" aria-label="Affected lines">
              {removedOriginalLines.map((rem) => (
                <li key={rem.logicalLineId}>
                  <strong>Removed</strong>: {rem.productName} ({rem.skuCode}) — {rem.returnableQuantity}{' '}
                  units return to SELLABLE stock
                </li>
              ))}
              {draftLines.map((line, index) => {
                const check = lineValidations[index];
                const qtyDiff = check.qty - check.origQty;
                return (
                  <li key={line.localId}>
                    <strong>{line.productName}</strong> (<code>{line.skuCode}</code>): Qty{' '}
                    {line.lineId ? `${check.origQty} → ${check.qty}` : `${check.qty} (new)`}{' '}
                    {qtyDiff !== 0
                      ? qtyDiff > 0
                        ? `(-${qtyDiff} from sellable stock)`
                        : `(+${Math.abs(qtyDiff)} returned to sellable stock)`
                      : '(no stock quantity change)'}{' '}
                    — Net {formatInrDisplay(formatPaiseToInr(check.activeNetPaise))}
                  </li>
                );
              })}
            </ul>

            <div className="billing-totals-box">
              <div className="billing-total-row">
                <span>Stock effect</span>
                <span>
                  {hasStockMovementExpected
                    ? 'Expected sellable quantity adjustments listed above'
                    : 'No stock changes (price/discount-only revision)'}
                </span>
              </div>
              <div className="billing-total-row">
                <span>Previous total</span>
                <span>{formatInrDisplay(bill.total)}</span>
              </div>
              <div className="billing-total-row billing-total-row--grand">
                <span>Revised total</span>
                <span>{formatInrDisplay(formatPaiseToInr(authoritativeTotalPaise))}</span>
              </div>
              <div className="billing-total-row">
                <span>Projected balance due</span>
                <span>
                  {formatInrDisplay(
                    formatPaiseToInr(Math.max(0, settlementValidation.balanceDueAfterPaise)),
                  )}
                </span>
              </div>
              <p className="catalog-field-hint">Reason: {reason.trim()}</p>
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
                          void executeRevise(pendingSubmit);
                        }}
                      >
                        Retry revision
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
                {isSubmitting ? 'Posting revision…' : 'Confirm & Post Revision'}
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
            appendResolvedItem(modal.pendingItem, batch);
            return;
          }
          if (modal.kind === 'assign-line' && modal.assignLocalId !== undefined) {
            invalidatePending();
            setDraftLines((prev) =>
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
