import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Link } from 'react-router-dom';
import { isAbortError, isApiClientError } from '../api/errors.ts';
import { catalogApi, type CatalogApi } from '../catalog/catalogApi.ts';
import type { SkuListItem } from '../catalog/types.ts';
import { BarcodeScannerPanel } from '../inventory/components/BarcodeScannerPanel.tsx';
import { inventoryApi, type InventoryApi } from '../inventory/inventoryApi.ts';
import type { EligibleBatch } from '../inventory/types.ts';
import { SkuPickerModal } from '../purchasing/components/SkuPickerModal.tsx';
import { triggerBrowserBlobDownload } from '../utils/blobDownload.ts';
import {
  formatInrDisplay,
  formatPaiseToInr,
  normalizeInrPriceInput,
  parseInrToPaise,
} from '../utils/inrPrice.ts';
import { billingApi, type BillingApi } from './billingApi.ts';
import {
  findMergeableCartLineIndex,
  generateBillIdempotencyKey,
  parsePositiveWholeQuantity,
  parseTotalsSnapshot,
  validateCartLine,
  type CartLine,
  type PriceTotalsSnapshot,
} from './cartUtils.ts';
import {
  BatchSelectionModal,
  type BatchSelectionTarget,
} from './components/BatchSelectionModal.tsx';
import { BillPrintPreviewModal } from './components/BillPrintPreviewModal.tsx';
import { CustomerPickerModal } from './components/CustomerPickerModal.tsx';
import { getBillStatusDisplay } from './statusLabels.ts';
import type {
  BillPaymentInput,
  BillPreviewResponse,
  CreateBillInput,
  CreateBillResponse,
  Customer,
  PaymentMode,
} from './types.ts';
import '../catalog/ProductsPage.css';
import '../purchasing/Purchasing.css';
import '../inventory/Inventory.css';
import './Billing.css';

export interface BillingCounterPageProps {
  billing?: BillingApi;
  inventory?: InventoryApi;
  catalog?: CatalogApi;
}

interface PaymentDraftRow {
  localId: number;
  mode: PaymentMode;
  amountRaw: string;
  referenceRaw: string;
}

interface BatchSelectionModalState {
  kind: 'add' | 'assign-line';
  assignLocalId?: number;
  pendingAdd?: {
    skuId: string;
    skuCode: string;
    productName: string;
    size: string | null;
    defaultSellingPrice: string;
  };
  target: BatchSelectionTarget;
}

interface PendingBillSubmit {
  payloadKey: string;
  payload: CreateBillInput;
  idempotencyKey: string;
}

function isCashierEditingOtherField(
  active: Element | null,
  barcodeInput: HTMLInputElement | null,
  barcodeSection: HTMLElement | null,
): boolean {
  if (!active || active === document.body || active === document.documentElement) {
    return false;
  }
  if (active === barcodeInput || barcodeSection?.contains(active)) {
    return false;
  }
  if (active.closest('dialog') !== null) {
    return false;
  }
  const tag = active.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (active instanceof HTMLElement && active.isContentEditable)
  );
}

export function BillingCounterPage({
  billing = billingApi,
  inventory = inventoryApi,
  catalog = catalogApi,
}: BillingCounterPageProps) {
  const customerErrorId = useId();
  const nextCartLineIdRef = useRef(1);
  const nextPaymentRowIdRef = useRef(1);
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const barcodeSectionRef = useRef<HTMLDivElement | null>(null);
  const pendingScanFocusRef = useRef(false);
  const previewSeqRef = useRef(0);
  const submittingRef = useRef(false);

  const [cartLines, setCartLines] = useState<CartLine[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [paymentRows, setPaymentRows] = useState<PaymentDraftRow[]>([]);

  const [isLookingUpBarcode, setIsLookingUpBarcode] = useState(false);
  const [barcodeLookupError, setBarcodeLookupError] = useState<{
    message: string;
    requestId?: string | null;
  } | null>(null);
  const [notFoundBarcode, setNotFoundBarcode] = useState<string | null>(null);
  const [isResolvingSkuBatches, setIsResolvingSkuBatches] = useState(false);
  const [focusReturnTick, setFocusReturnTick] = useState(0);

  const [isSkuPickerOpen, setIsSkuPickerOpen] = useState(false);
  const [skuPickerInitialQuery, setSkuPickerInitialQuery] = useState('');
  const [batchModalState, setBatchModalState] = useState<BatchSelectionModalState | null>(null);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);

  const [previewRetryTick, setPreviewRetryTick] = useState(0);
  const [previewState, setPreviewState] = useState<{
    key: string;
    response: BillPreviewResponse | null;
    error: { message: string; requestId?: string | null } | null;
  } | null>(null);

  const [showCheckoutValidation, setShowCheckoutValidation] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<PendingBillSubmit | null>(null);
  const [submitError, setSubmitError] = useState<{
    message: string;
    requestId?: string | null;
    isUnknownOutcome?: boolean;
  } | null>(null);
  const [priceChangeNotice, setPriceChangeNotice] = useState<{
    message: string;
    currentTotals: PriceTotalsSnapshot | null;
  } | null>(null);

  const [completedBill, setCompletedBill] = useState<CreateBillResponse | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [completedPdfError, setCompletedPdfError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Billing Counter | Bagade Clothing';
  }, []);

  const requestFocusReturnToScan = useCallback(() => {
    pendingScanFocusRef.current = true;
    setFocusReturnTick((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!pendingScanFocusRef.current) {
      return;
    }
    if (
      isLookingUpBarcode ||
      batchModalState !== null ||
      isSkuPickerOpen ||
      isCustomerModalOpen ||
      isPrintModalOpen
    ) {
      return;
    }
    pendingScanFocusRef.current = false;
    const active = document.activeElement;
    if (!isCashierEditingOtherField(active, barcodeInputRef.current, barcodeSectionRef.current)) {
      barcodeInputRef.current?.focus();
    }
  }, [
    focusReturnTick,
    isLookingUpBarcode,
    batchModalState,
    isSkuPickerOpen,
    isCustomerModalOpen,
    isPrintModalOpen,
  ]);

  const clearPendingAndErrors = useCallback(() => {
    setPendingSubmit(null);
    setSubmitError(null);
    setPriceChangeNotice(null);
    setShowCheckoutValidation(false);
  }, []);

  const addOrMergeCartItem = useCallback(
    (item: {
      skuId: string;
      skuCode: string;
      productName: string;
      size: string | null;
      defaultSellingPrice: string;
      batchId: string | null;
      printedMrp: string | null;
      internalBarcode: string | null;
      batchLockedByTag: boolean;
      availableBatches: EligibleBatch[];
    }) => {
      setCompletedBill(null);
      setCompletedPdfError(null);
      clearPendingAndErrors();

      setCartLines((prev) => {
        const mergeIdx = findMergeableCartLineIndex(prev, {
          skuId: item.skuId,
          batchId: item.batchId,
          discountAmount: null,
          unitPriceOverride: null,
        });

        if (mergeIdx >= 0) {
          return prev.map((line, idx) => {
            if (idx !== mergeIdx) {
              return line;
            }
            const currentQty = parsePositiveWholeQuantity(line.quantityRaw) ?? 0;
            return {
              ...line,
              quantityRaw: String(currentQty + 1),
              availableBatches:
                item.availableBatches.length > 0 ? item.availableBatches : line.availableBatches,
            };
          });
        }

        const localId = nextCartLineIdRef.current++;
        return [
          ...prev,
          {
            localId,
            skuId: item.skuId,
            skuCode: item.skuCode,
            productName: item.productName,
            size: item.size,
            defaultSellingPrice: item.defaultSellingPrice,
            batchId: item.batchId,
            printedMrp: item.printedMrp,
            internalBarcode: item.internalBarcode,
            batchLockedByTag: item.batchLockedByTag,
            availableBatches: item.availableBatches,
            quantityRaw: '1',
            discountRaw: '',
            priceOverrideRaw: '',
          },
        ];
      });
    },
    [clearPendingAndErrors],
  );

  const handleLookupBarcode = useCallback(
    async (rawCode: string): Promise<boolean> => {
      setBarcodeLookupError(null);
      setNotFoundBarcode(null);
      setIsLookingUpBarcode(true);

      try {
        const result = await inventory.lookupBarcode(rawCode);
        if (result.mappingType === 'INTERNAL' && result.batchId) {
          addOrMergeCartItem({
            skuId: result.skuId,
            skuCode: result.code,
            productName: result.name,
            size: result.size,
            defaultSellingPrice: result.defaultSellingPrice,
            batchId: result.batchId,
            printedMrp: result.printedMrp,
            internalBarcode: result.code,
            batchLockedByTag: true,
            availableBatches: [
              {
                batchId: result.batchId,
                receivedDate: '',
                printedMrp: result.printedMrp,
                sellableQuantity: result.batchSellableQuantity ?? result.sellableQuantity,
                internalBarcode: result.code,
              },
            ],
          });
          requestFocusReturnToScan();
          return true;
        }

        if (result.requiresBatchSelection && result.eligibleBatches.length > 0) {
          setBatchModalState({
            kind: 'add',
            pendingAdd: {
              skuId: result.skuId,
              skuCode: result.code,
              productName: result.name,
              size: result.size,
              defaultSellingPrice: result.defaultSellingPrice,
            },
            target: {
              productName: result.name,
              size: result.size,
              skuCode: result.code,
              defaultSellingPrice: result.defaultSellingPrice,
              batches: result.eligibleBatches,
            },
          });
          return true;
        }

        addOrMergeCartItem({
          skuId: result.skuId,
          skuCode: result.code,
          productName: result.name,
          size: result.size,
          defaultSellingPrice: result.defaultSellingPrice,
          batchId: result.batchId,
          printedMrp: result.printedMrp,
          internalBarcode: null,
          batchLockedByTag: false,
          availableBatches: result.eligibleBatches,
        });
        requestFocusReturnToScan();
        return true;
      } catch (error) {
        if (isApiClientError(error)) {
          setBarcodeLookupError({
            message: error.message,
            requestId: error.requestId,
          });
          if (error.code === 'BARCODE_NOT_FOUND') {
            setNotFoundBarcode(rawCode);
          }
        } else {
          setBarcodeLookupError({
            message: 'Unable to look up barcode. Please retry or use product search.',
          });
        }
        return false;
      } finally {
        setIsLookingUpBarcode(false);
      }
    },
    [addOrMergeCartItem, inventory, requestFocusReturnToScan],
  );

  const openSkuPickerWithQuery = (initialQuery: string) => {
    setSkuPickerInitialQuery(initialQuery);
    setIsSkuPickerOpen(true);
  };

  const handleSelectSkuFromPicker = useCallback(
    async (sku: SkuListItem) => {
      setIsSkuPickerOpen(false);
      setBarcodeLookupError(null);
      setNotFoundBarcode(null);
      setIsResolvingSkuBatches(true);

      let sellableBatches: EligibleBatch[] = [];
      try {
        const invPage = await inventory.listInventory({
          skuId: sku.skuId,
          page: 0,
          size: 5,
        });
        const matched = invPage.items.find((entry) => entry.skuId === sku.skuId);
        if (matched) {
          sellableBatches = matched.batches
            .filter((batch) => batch.sellableQuantity > 0)
            .map((batch) => ({
              batchId: batch.batchId,
              receivedDate: batch.receivedDate,
              printedMrp: batch.printedMrp,
              sellableQuantity: batch.sellableQuantity,
              internalBarcode: batch.internalBarcode,
            }));
        }
      } catch {
        // Non-blocking fallback: backend preview will still check batch selection.
      } finally {
        setIsResolvingSkuBatches(false);
      }

      const distinctMrps = new Set(sellableBatches.map((batch) => batch.printedMrp ?? null));
      if (sellableBatches.length > 0 && distinctMrps.size > 1) {
        setBatchModalState({
          kind: 'add',
          pendingAdd: {
            skuId: sku.skuId,
            skuCode: sku.skuCode,
            productName: sku.productName,
            size: sku.size,
            defaultSellingPrice: sku.defaultSellingPrice,
          },
          target: {
            productName: sku.productName,
            size: sku.size,
            skuCode: sku.skuCode,
            defaultSellingPrice: sku.defaultSellingPrice,
            batches: sellableBatches,
          },
        });
        return;
      }

      addOrMergeCartItem({
        skuId: sku.skuId,
        skuCode: sku.skuCode,
        productName: sku.productName,
        size: sku.size,
        defaultSellingPrice: sku.defaultSellingPrice,
        batchId: null,
        printedMrp: sellableBatches.length === 1 ? sellableBatches[0].printedMrp : null,
        internalBarcode: null,
        batchLockedByTag: false,
        availableBatches: sellableBatches,
      });
      requestFocusReturnToScan();
    },
    [addOrMergeCartItem, inventory, requestFocusReturnToScan],
  );

  const handleBatchSelected = (batch: EligibleBatch) => {
    const modal = batchModalState;
    if (!modal) {
      return;
    }
    setBatchModalState(null);

    if (modal.kind === 'add' && modal.pendingAdd) {
      addOrMergeCartItem({
        skuId: modal.pendingAdd.skuId,
        skuCode: modal.pendingAdd.skuCode,
        productName: modal.pendingAdd.productName,
        size: modal.pendingAdd.size,
        defaultSellingPrice: modal.pendingAdd.defaultSellingPrice,
        batchId: batch.batchId,
        printedMrp: batch.printedMrp,
        internalBarcode: batch.internalBarcode,
        batchLockedByTag: false,
        availableBatches: modal.target.batches,
      });
      requestFocusReturnToScan();
      return;
    }

    if (modal.kind === 'assign-line' && modal.assignLocalId !== undefined) {
      clearPendingAndErrors();
      setCartLines((prev) =>
        prev.map((line) =>
          line.localId === modal.assignLocalId
            ? {
                ...line,
                batchId: batch.batchId,
                printedMrp: batch.printedMrp,
                availableBatches:
                  modal.target.batches.length > 0 ? modal.target.batches : line.availableBatches,
              }
            : line,
        ),
      );
      requestFocusReturnToScan();
    }
  };

  const updateCartLine = (localId: number, patch: Partial<CartLine>) => {
    clearPendingAndErrors();
    setCartLines((prev) =>
      prev.map((line) => (line.localId === localId ? { ...line, ...patch } : line)),
    );
  };

  const removeCartLine = (localId: number) => {
    clearPendingAndErrors();
    setCartLines((prev) => prev.filter((line) => line.localId !== localId));
  };

  const lineValidations = useMemo(() => cartLines.map((line) => validateCartLine(line)), [cartLines]);

  const hasLineValidationError = useMemo(
    () => lineValidations.some((entry) => !entry.valid),
    [lineValidations],
  );

  const apiPreviewLines = useMemo(
    () =>
      !hasLineValidationError
        ? lineValidations
            .map((entry) => entry.apiLine)
            .filter((item): item is NonNullable<typeof item> => item !== null)
        : [],
    [hasLineValidationError, lineValidations],
  );

  const previewRequestKey = useMemo(
    () =>
      cartLines.length > 0 && !hasLineValidationError
        ? JSON.stringify({ lines: apiPreviewLines, retry: previewRetryTick })
        : '',
    [cartLines.length, hasLineValidationError, apiPreviewLines, previewRetryTick],
  );

  useEffect(() => {
    if (!previewRequestKey || apiPreviewLines.length === 0) {
      return;
    }

    const controller = new AbortController();
    const seq = ++previewSeqRef.current;

    billing
      .previewBill(apiPreviewLines, controller.signal)
      .then((response) => {
        if (seq !== previewSeqRef.current || controller.signal.aborted) {
          return;
        }
        setPreviewState({
          key: previewRequestKey,
          response,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (
          isAbortError(error) ||
          controller.signal.aborted ||
          seq !== previewSeqRef.current
        ) {
          return;
        }
        setPreviewState({
          key: previewRequestKey,
          response: null,
          error: isApiClientError(error)
            ? { message: error.message, requestId: error.requestId }
            : { message: 'Unable to calculate bill preview.' },
        });
      });

    return () => {
      controller.abort();
    };
  }, [billing, previewRequestKey, apiPreviewLines]);

  const isPreviewLoading =
    cartLines.length > 0 && !hasLineValidationError && previewState?.key !== previewRequestKey;
  const activePreview =
    cartLines.length > 0 && !hasLineValidationError && previewState?.key === previewRequestKey
      ? previewState.response
      : null;
  const previewError =
    cartLines.length > 0 && !hasLineValidationError && previewState?.key === previewRequestKey
      ? previewState.error
      : null;
  const isPreviewFresh = activePreview !== null;

  // Payment calculations using integer paise
  const paymentRowValidations = useMemo(
    () =>
      paymentRows.map((row) => {
        let amountError: string | undefined;
        let referenceError: string | undefined;
        let paise: number | null = null;
        let normalizedAmount: string | null = null;

        const trimmedAmount = row.amountRaw.trim();
        if (!trimmedAmount) {
          amountError = 'Enter a positive payment amount or remove this row.';
        } else {
          const parsed = normalizeInrPriceInput(trimmedAmount);
          if (!parsed.ok) {
            amountError = parsed.error;
          } else {
            const p = parseInrToPaise(parsed.value);
            if (p === null || p <= 0) {
              amountError = 'Payment amount must be greater than ₹0.00.';
            } else {
              paise = p;
              normalizedAmount = parsed.value;
            }
          }
        }

        if (row.referenceRaw.trim().length > 150) {
          referenceError = 'Payment reference must not exceed 150 characters.';
        }

        return {
          localId: row.localId,
          valid: !amountError && !referenceError,
          amountError,
          referenceError,
          paise,
          apiPayment:
            !amountError && !referenceError && normalizedAmount !== null
              ? ({
                  mode: row.mode,
                  amount: normalizedAmount,
                  ...(row.referenceRaw.trim() ? { reference: row.referenceRaw.trim() } : {}),
                } satisfies BillPaymentInput)
              : null,
        };
      }),
    [paymentRows],
  );

  const hasInvalidPaymentRow = useMemo(
    () => paymentRowValidations.some((entry) => !entry.valid),
    [paymentRowValidations],
  );

  const paidPaise = useMemo(
    () => paymentRowValidations.reduce((sum, entry) => sum + (entry.paise ?? 0), 0),
    [paymentRowValidations],
  );

  const previewTotalPaise = activePreview ? parseInrToPaise(activePreview.total) : null;
  const isOverpaid = previewTotalPaise !== null && paidPaise > previewTotalPaise;
  const balanceDuePaise =
    previewTotalPaise !== null ? Math.max(0, previewTotalPaise - paidPaise) : null;
  const requiresCustomerForCredit = balanceDuePaise !== null && balanceDuePaise > 0;
  const missingCustomerForCredit = requiresCustomerForCredit && !selectedCustomer;

  const applyPaymentPreset = (preset: 'CASH_FULL' | 'UPI_FULL' | 'SPLIT' | 'FULL_CREDIT') => {
    clearPendingAndErrors();
    if (preset === 'FULL_CREDIT') {
      setPaymentRows([]);
      return;
    }
    if (preset === 'SPLIT') {
      const firstId = nextPaymentRowIdRef.current++;
      const secondId = nextPaymentRowIdRef.current++;
      setPaymentRows([
        { localId: firstId, mode: 'CASH', amountRaw: '', referenceRaw: '' },
        { localId: secondId, mode: 'UPI', amountRaw: '', referenceRaw: '' },
      ]);
      return;
    }
    const mode: PaymentMode = preset === 'CASH_FULL' ? 'CASH' : 'UPI';
    const fullAmount = previewTotalPaise !== null ? formatPaiseToInr(previewTotalPaise) : '';
    const rowId = nextPaymentRowIdRef.current++;
    setPaymentRows([{ localId: rowId, mode, amountRaw: fullAmount, referenceRaw: '' }]);
  };

  const addPaymentRow = () => {
    clearPendingAndErrors();
    const rowId = nextPaymentRowIdRef.current++;
    const nextMode: PaymentMode = paymentRows.some((row) => row.mode === 'CASH') ? 'UPI' : 'CASH';
    setPaymentRows((prev) => [
      ...prev,
      { localId: rowId, mode: nextMode, amountRaw: '', referenceRaw: '' },
    ]);
  };

  const updatePaymentRow = (localId: number, patch: Partial<PaymentDraftRow>) => {
    clearPendingAndErrors();
    setPaymentRows((prev) =>
      prev.map((row) => (row.localId === localId ? { ...row, ...patch } : row)),
    );
  };

  const removePaymentRow = (localId: number) => {
    clearPendingAndErrors();
    setPaymentRows((prev) => prev.filter((row) => row.localId !== localId));
  };

  const fillRemainingInPaymentRow = (localId: number) => {
    if (previewTotalPaise === null) {
      return;
    }
    const otherPaid = paymentRowValidations.reduce(
      (sum, entry) => (entry.localId === localId ? sum : sum + (entry.paise ?? 0)),
      0,
    );
    const remaining = Math.max(0, previewTotalPaise - otherPaid);
    updatePaymentRow(localId, {
      amountRaw: remaining > 0 ? formatPaiseToInr(remaining) : '',
    });
  };

  const executeCheckout = async (attempt: PendingBillSubmit) => {
    if (submittingRef.current) {
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    setPriceChangeNotice(null);

    try {
      const created = await billing.createBill(attempt.payload, attempt.idempotencyKey);
      setPendingSubmit(null);
      setCartLines([]);
      setPaymentRows([]);
      setSelectedCustomer(null);
      setShowCheckoutValidation(false);
      setBarcodeLookupError(null);
      setNotFoundBarcode(null);
      setCompletedBill(created);

      // Non-blocking refresh of catalog stock, inventory balances, and recent bill history.
      void Promise.resolve(catalog.listSkus({ status: 'ACTIVE', page: 0, size: 25 })).catch(
        () => undefined,
      );
      void Promise.resolve(inventory.listInventory({ page: 0, size: 25 })).catch(() => undefined);
      void Promise.resolve(billing.listBills({ page: 0, size: 10 })).catch(() => undefined);
    } catch (error) {
      if (isApiClientError(error)) {
        if (error.code === 'PRICE_CHANGED') {
          setPendingSubmit(null);
          const currentTotals = parseTotalsSnapshot(error.details?.currentTotals);
          setPriceChangeNotice({
            message:
              'Catalog prices changed while this bill was open. Review the updated totals and adjust payments if needed before submitting again.',
            currentTotals,
          });
          setPreviewRetryTick((prev) => prev + 1);
        } else if (
          error.code === 'BATCH_SELECTION_REQUIRED' ||
          error.code === 'INSUFFICIENT_STOCK' ||
          error.kind === 'conflict'
        ) {
          setPendingSubmit(null);
          setSubmitError({
            message: `${error.message} Availability and batch details have been refreshed below without clearing your cart.`,
            requestId: error.requestId,
          });
          setPreviewRetryTick((prev) => prev + 1);
        } else if (error.kind === 'network' || error.kind === 'server') {
          setPendingSubmit(attempt);
          setSubmitError({
            message:
              'Connection dropped or server error while completing the bill — outcome is unknown. Retry with the same Idempotency-Key so the bill is not created twice.',
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
            message: fieldSummary || error.message || 'Unable to complete checkout.',
            requestId: error.requestId,
          });
        }
      } else {
        setPendingSubmit(attempt);
        setSubmitError({
          message:
            'Unexpected error while completing the bill. Click Retry checkout to safely retry with the same submission.',
          isUnknownOutcome: true,
        });
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleCheckoutSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }

    setShowCheckoutValidation(true);

    if (cartLines.length === 0) {
      setSubmitError({ message: 'Add at least one item to the cart before checking out.' });
      return;
    }

    if (hasLineValidationError || hasInvalidPaymentRow) {
      setSubmitError({ message: 'Please fix the highlighted cart or payment fields.' });
      return;
    }

    if (!isPreviewFresh || !activePreview) {
      setSubmitError({
        message: 'Waiting for backend bill preview to complete before posting.',
      });
      return;
    }

    if (!activePreview.canCheckout) {
      setSubmitError({
        message:
          'Resolve highlighted stock availability or batch selection issues in the cart before checkout.',
      });
      return;
    }

    if (isOverpaid) {
      setSubmitError({
        message: `Payments (${formatInrDisplay(formatPaiseToInr(paidPaise))}) exceed bill total (${formatInrDisplay(activePreview.total)}). Overpayment is not allowed.`,
      });
      return;
    }

    if (missingCustomerForCredit) {
      setSubmitError({
        message: 'Select or create a customer when a credit balance remains due.',
      });
      return;
    }

    const preparedPayments: BillPaymentInput[] = paymentRowValidations
      .map((entry) => entry.apiPayment)
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const payload: CreateBillInput = {
      lines: apiPreviewLines,
      expectedTotal: activePreview.total,
      ...(selectedCustomer ? { customerId: selectedCustomer.customerId } : {}),
      payments: preparedPayments,
    };
    const payloadKey = JSON.stringify(payload);

    const attempt: PendingBillSubmit =
      pendingSubmit && pendingSubmit.payloadKey === payloadKey
        ? pendingSubmit
        : {
            payloadKey,
            payload,
            idempotencyKey: generateBillIdempotencyKey(),
          };

    void executeCheckout(attempt);
  };

  const handleDownloadCompletedPdf = async () => {
    if (!completedBill || isDownloadingPdf) {
      return;
    }
    setIsDownloadingPdf(true);
    setCompletedPdfError(null);
    try {
      const { blob, filename } = await billing.downloadBillPdf(completedBill.billId);
      triggerBrowserBlobDownload(blob, filename || `${completedBill.billNumber}.pdf`);
    } catch (error) {
      setCompletedPdfError(
        isApiClientError(error)
          ? error.message
          : 'Unable to download bill PDF. Open Print Preview or View Bill Detail to retry.',
      );
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const startNewBill = () => {
    setCompletedBill(null);
    setCompletedPdfError(null);
    clearPendingAndErrors();
    requestFocusReturnToScan();
  };

  return (
    <div className="products-page">
      <div className="products-header">
        <div className="products-header__title-group">
          <h1 id="main-content" tabIndex={-1}>
            Billing
          </h1>
          <p className="products-header__subtitle">
            Scan barcodes or search products, review backend totals, collect Cash/UPI or credit,
            and print 80 mm receipts.
          </p>
        </div>

        <div className="products-header__actions">
          <Link to="/billing/history" className="btn-secondary">
            Bill History
          </Link>
        </div>
      </div>

      {completedBill ? (
        <section
          className="surface-card alert-banner--success billing-counter-panel"
          aria-label="Completed bill confirmation"
          role="status"
        >
          <div className="po-line-card__top">
            <div>
              <h2>Bill issued: {completedBill.billNumber}</h2>
              <p className="catalog-field-hint">
                Issued on {completedBill.issueDate} · Total {formatInrDisplay(completedBill.total)}{' '}
                · Paid {formatInrDisplay(completedBill.paid)} · Balance due{' '}
                {formatInrDisplay(completedBill.balanceDue)}
              </p>
            </div>
            <span
              className={`bill-status-pill bill-status-pill--${getBillStatusDisplay(completedBill.status).variant}`}
            >
              <span aria-hidden="true">{getBillStatusDisplay(completedBill.status).symbol}</span>
              <span>{getBillStatusDisplay(completedBill.status).label}</span>
            </span>
          </div>

          {completedPdfError ? (
            <div className="alert-banner alert-banner--error" role="alert">
              <div className="alert-banner__content">
                <p>{completedPdfError}</p>
              </div>
            </div>
          ) : null}

          <div className="billing-completed-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => setIsPrintModalOpen(true)}
            >
              Print Receipt (80 mm)
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={isDownloadingPdf}
              aria-busy={isDownloadingPdf}
              onClick={() => {
                void handleDownloadCompletedPdf();
              }}
            >
              {isDownloadingPdf ? 'Downloading PDF…' : 'Download PDF'}
            </button>
            <Link to={`/billing/${completedBill.billId}`} className="btn-secondary">
              View Bill Detail
            </Link>
            <button type="button" className="btn-secondary" onClick={startNewBill}>
              New Bill
            </button>
          </div>
        </section>
      ) : null}

      <div className="billing-counter-layout">
        <div className="billing-main-column">
          <section
            ref={barcodeSectionRef}
            className="surface-card billing-counter-panel"
            aria-label="Barcode scan and product lookup"
          >
            <BarcodeScannerPanel
              isLookingUp={isLookingUpBarcode}
              lookupError={barcodeLookupError}
              disabled={isSubmitting || isResolvingSkuBatches}
              inputRef={barcodeInputRef}
              onLookupCode={handleLookupBarcode}
            />

            {notFoundBarcode ? (
              <div className="billing-not-found-bar" role="status">
                <span>
                  Code <code>{notFoundBarcode}</code> was not found. Your current cart was kept
                  intact.
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => openSkuPickerWithQuery(notFoundBarcode)}
                >
                  Search product catalog
                </button>
              </div>
            ) : null}

            <div className="billing-scan-actions">
              <button
                type="button"
                className="btn-secondary"
                disabled={isSubmitting || isResolvingSkuBatches}
                onClick={() => openSkuPickerWithQuery('')}
              >
                {isResolvingSkuBatches ? 'Checking stock batches…' : 'Search / Browse Products'}
              </button>
            </div>
          </section>

          <section className="surface-card billing-counter-panel" aria-label="Billing cart">
            <div className="po-lines-header">
              <h2>
                Cart ({cartLines.length} line{cartLines.length === 1 ? '' : 's'})
              </h2>
              {cartLines.length > 0 ? (
                <button
                  type="button"
                  className="btn-table-action btn-table-action--danger"
                  disabled={isSubmitting}
                  onClick={() => {
                    clearPendingAndErrors();
                    setCartLines([]);
                    setPaymentRows([]);
                  }}
                >
                  Clear cart
                </button>
              ) : null}
            </div>

            {cartLines.length === 0 ? (
              <div className="catalog-empty-state">
                <p>
                  Cart is empty. Scan a supplier or internal barcode, or use{' '}
                  <strong>Search / Browse Products</strong> to add items.
                </p>
              </div>
            ) : (
              <div className="billing-cart-list">
                {cartLines.map((line, index) => {
                  const previewLine =
                    activePreview && activePreview.lines[index]?.skuId === line.skuId
                      ? activePreview.lines[index]
                      : null;
                  const validation = lineValidations[index];
                  const batchOptions =
                    previewLine && previewLine.selectableBatches.length > 0
                      ? previewLine.selectableBatches
                      : line.availableBatches;
                  const hasBatchIssue = Boolean(previewLine?.requiresBatchSelection);
                  const hasStockIssue = Boolean(previewLine && !previewLine.sufficientStock);
                  const hasRowIssue =
                    hasBatchIssue ||
                    hasStockIssue ||
                    Boolean(
                      showCheckoutValidation &&
                        (validation?.errors.quantity ||
                          validation?.errors.discount ||
                          validation?.errors.priceOverride),
                    );

                  const qtyInputId = `cart-qty-${line.localId}`;
                  const overrideInputId = `cart-override-${line.localId}`;
                  const discountInputId = `cart-discount-${line.localId}`;
                  const qtyNum = parsePositiveWholeQuantity(line.quantityRaw) ?? 1;

                  return (
                    <article
                      key={line.localId}
                      className={`billing-cart-item${hasRowIssue ? ' billing-cart-item--issue' : ''}`}
                      aria-label={`${line.productName} cart line ${index + 1}`}
                    >
                      <div className="billing-cart-item__top">
                        <div className="billing-cart-item__title">
                          <span className="billing-cart-item__name">{line.productName}</span>
                          <div className="billing-cart-item__meta">
                            <span>Size: {line.size ?? '—'}</span>
                            <span>
                              Code: <code>{line.skuCode}</code>
                            </span>
                            <span>
                              Default selling price: {formatInrDisplay(line.defaultSellingPrice)}
                            </span>
                            {line.printedMrp !== null ? (
                              <span>Printed MRP: {formatInrDisplay(line.printedMrp)}</span>
                            ) : null}
                            {line.batchId ? (
                              <span className="billing-cart-badge">
                                {line.internalBarcode
                                  ? `Internal tag: ${line.internalBarcode}`
                                  : `Batch selected`}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="billing-cart-item__total">
                          {previewLine ? (
                            <span>{formatInrDisplay(previewLine.lineTotal)}</span>
                          ) : (
                            <span>Pending preview…</span>
                          )}
                        </div>
                      </div>

                      {hasBatchIssue ? (
                        <div className="billing-line-warning" role="alert">
                          <span>
                            Batch selection required: sellable batches carry differing printed MRPs.
                          </span>
                          <button
                            type="button"
                            className="btn-table-action"
                            onClick={() =>
                              setBatchModalState({
                                kind: 'assign-line',
                                assignLocalId: line.localId,
                                target: {
                                  productName: line.productName,
                                  size: line.size,
                                  skuCode: line.skuCode,
                                  defaultSellingPrice: line.defaultSellingPrice,
                                  batches: batchOptions,
                                },
                              })
                            }
                          >
                            Select batch
                          </button>
                        </div>
                      ) : null}

                      {hasStockIssue && previewLine ? (
                        <div className="billing-line-warning" role="alert">
                          <span>
                            Insufficient stock: only {previewLine.availableQuantity} sellable unit
                            {previewLine.availableQuantity === 1 ? '' : 's'} available (availability
                            is also re-checked when posting).
                          </span>
                        </div>
                      ) : null}

                      <div className="billing-cart-item__controls">
                        <div className="catalog-field">
                          <label htmlFor={qtyInputId} className="catalog-label">
                            Quantity ({line.productName})
                          </label>
                          <div className="billing-qty-stepper">
                            <button
                              type="button"
                              className="btn-table-action"
                              aria-label={`Decrease quantity for ${line.productName}`}
                              disabled={isSubmitting || qtyNum <= 1}
                              onClick={() =>
                                updateCartLine(line.localId, {
                                  quantityRaw: String(Math.max(1, qtyNum - 1)),
                                })
                              }
                            >
                              -
                            </button>
                            <input
                              id={qtyInputId}
                              type="text"
                              inputMode="numeric"
                              className="catalog-input"
                              value={line.quantityRaw}
                              disabled={isSubmitting}
                              onChange={(event) =>
                                updateCartLine(line.localId, { quantityRaw: event.target.value })
                              }
                              aria-invalid={validation?.errors.quantity ? 'true' : 'false'}
                            />
                            <button
                              type="button"
                              className="btn-table-action"
                              aria-label={`Increase quantity for ${line.productName}`}
                              disabled={isSubmitting}
                              onClick={() =>
                                updateCartLine(line.localId, { quantityRaw: String(qtyNum + 1) })
                              }
                            >
                              +
                            </button>
                          </div>
                          {validation?.errors.quantity ? (
                            <p className="catalog-field-error" role="alert">
                              {validation.errors.quantity}
                            </p>
                          ) : null}
                        </div>

                        <div className="catalog-field">
                          <label htmlFor={overrideInputId} className="catalog-label">
                            Unit price override (₹)
                          </label>
                          <input
                            id={overrideInputId}
                            type="text"
                            inputMode="decimal"
                            className="catalog-input"
                            placeholder={line.defaultSellingPrice}
                            value={line.priceOverrideRaw}
                            disabled={isSubmitting}
                            onChange={(event) =>
                              updateCartLine(line.localId, { priceOverrideRaw: event.target.value })
                            }
                            aria-invalid={validation?.errors.priceOverride ? 'true' : 'false'}
                          />
                          {validation?.errors.priceOverride ? (
                            <p className="catalog-field-error" role="alert">
                              {validation.errors.priceOverride}
                            </p>
                          ) : null}
                        </div>

                        <div className="catalog-field">
                          <label htmlFor={discountInputId} className="catalog-label">
                            Line discount (₹)
                          </label>
                          <input
                            id={discountInputId}
                            type="text"
                            inputMode="decimal"
                            className="catalog-input"
                            placeholder="0.00"
                            value={line.discountRaw}
                            disabled={isSubmitting}
                            onChange={(event) =>
                              updateCartLine(line.localId, { discountRaw: event.target.value })
                            }
                            aria-invalid={validation?.errors.discount ? 'true' : 'false'}
                          />
                          {validation?.errors.discount ? (
                            <p className="catalog-field-error" role="alert">
                              {validation.errors.discount}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <div className="billing-cart-item__actions">
                        <div>
                          {!line.batchLockedByTag && batchOptions.length > 0 && !hasBatchIssue ? (
                            <button
                              type="button"
                              className="btn-table-action"
                              disabled={isSubmitting}
                              onClick={() =>
                                setBatchModalState({
                                  kind: 'assign-line',
                                  assignLocalId: line.localId,
                                  target: {
                                    productName: line.productName,
                                    size: line.size,
                                    skuCode: line.skuCode,
                                    defaultSellingPrice: line.defaultSellingPrice,
                                    batches: batchOptions,
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
                          disabled={isSubmitting}
                          onClick={() => removeCartLine(line.localId)}
                        >
                          Remove line
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="billing-checkout-column" aria-label="Checkout summary and payments">
          <form
            className="surface-card billing-counter-panel"
            onSubmit={handleCheckoutSubmit}
            noValidate
          >
            <h2>Checkout &amp; Payment</h2>

            {priceChangeNotice ? (
              <div className="alert-banner alert-banner--warning" role="alert">
                <div className="alert-banner__content">
                  <p>{priceChangeNotice.message}</p>
                  {priceChangeNotice.currentTotals ? (
                    <p>
                      Revised totals: Subtotal{' '}
                      <strong>{formatInrDisplay(priceChangeNotice.currentTotals.subtotal)}</strong>{' '}
                      · Discount{' '}
                      <strong>
                        -{formatInrDisplay(priceChangeNotice.currentTotals.discountTotal)}
                      </strong>{' '}
                      · Total{' '}
                      <strong>{formatInrDisplay(priceChangeNotice.currentTotals.total)}</strong>
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {previewError ? (
              <div className="alert-banner alert-banner--error" role="alert">
                <div className="alert-banner__content">
                  <p>{previewError.message}</p>
                  {previewError.requestId ? (
                    <p className="alert-banner__meta">Request ID: {previewError.requestId}</p>
                  ) : null}
                  <div className="alert-banner__actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setPreviewRetryTick((prev) => prev + 1)}
                    >
                      Retry preview
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="billing-totals-box" aria-live="polite">
              <div className="billing-total-row">
                <span>Subtotal</span>
                <span>{activePreview ? formatInrDisplay(activePreview.subtotal) : '—'}</span>
              </div>
              <div className="billing-total-row">
                <span>Discount</span>
                <span>
                  {activePreview ? `-${formatInrDisplay(activePreview.discountTotal)}` : '—'}
                </span>
              </div>
              <div className="billing-total-row billing-total-row--grand">
                <span>Bill Total</span>
                <span>{activePreview ? formatInrDisplay(activePreview.total) : '—'}</span>
              </div>
              <div className="billing-total-row">
                <span>Amount received</span>
                <span>{formatInrDisplay(formatPaiseToInr(paidPaise))}</span>
              </div>
              <div className="billing-total-row">
                <span>Balance due</span>
                <span>
                  {balanceDuePaise !== null
                    ? formatInrDisplay(formatPaiseToInr(balanceDuePaise))
                    : '—'}
                </span>
              </div>
              {isPreviewLoading ? (
                <p className="catalog-field-hint">Calculating backend preview totals…</p>
              ) : (
                <p className="catalog-field-hint">
                  Prices and stock availability are verified again when the bill is posted.
                </p>
              )}
            </div>

            <div className="billing-customer-box">
              <div className="po-line-card__top">
                <span className="catalog-label">Customer (for receipt or credit)</span>
                <div className="cell-actions__group">
                  <button
                    type="button"
                    className="btn-table-action"
                    disabled={isSubmitting}
                    onClick={() => setIsCustomerModalOpen(true)}
                  >
                    {selectedCustomer ? 'Change customer' : 'Select / Create customer'}
                  </button>
                  {selectedCustomer ? (
                    <button
                      type="button"
                      className="btn-table-action"
                      disabled={isSubmitting}
                      onClick={() => {
                        clearPendingAndErrors();
                        setSelectedCustomer(null);
                      }}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>

              <p id={customerErrorId} className="catalog-field-hint">
                {selectedCustomer ? (
                  <>
                    Selected: <strong>{selectedCustomer.name}</strong>
                    {selectedCustomer.contact ? ` (${selectedCustomer.contact})` : ''}
                  </>
                ) : requiresCustomerForCredit ? (
                  <span className="catalog-field-error">
                    Customer is required whenever a credit balance remains due.
                  </span>
                ) : (
                  'Optional for fully paid bills; required for partial or full credit.'
                )}
              </p>
            </div>

            <div className="po-lines-section">
              <div className="po-line-card__top">
                <span className="catalog-label">Payments</span>
                <button
                  type="button"
                  className="btn-table-action"
                  disabled={isSubmitting}
                  onClick={addPaymentRow}
                >
                  + Add payment
                </button>
              </div>

              <div className="billing-payment-presets" aria-label="Quick payment presets">
                <button
                  type="button"
                  className="btn-table-action"
                  disabled={isSubmitting || previewTotalPaise === null}
                  onClick={() => applyPaymentPreset('CASH_FULL')}
                >
                  Cash (Full)
                </button>
                <button
                  type="button"
                  className="btn-table-action"
                  disabled={isSubmitting || previewTotalPaise === null}
                  onClick={() => applyPaymentPreset('UPI_FULL')}
                >
                  UPI (Full)
                </button>
                <button
                  type="button"
                  className="btn-table-action"
                  disabled={isSubmitting || previewTotalPaise === null}
                  onClick={() => applyPaymentPreset('SPLIT')}
                >
                  Split Cash + UPI
                </button>
                <button
                  type="button"
                  className="btn-table-action"
                  disabled={isSubmitting}
                  onClick={() => applyPaymentPreset('FULL_CREDIT')}
                >
                  Full Credit
                </button>
              </div>

              {paymentRows.length === 0 ? (
                <p className="catalog-field-hint">
                  No payments entered ({cartLines.length > 0 ? 'full credit balance' : 'awaiting items'}).
                </p>
              ) : (
                paymentRows.map((row, idx) => {
                  const rowCheck = paymentRowValidations[idx];
                  const modeId = `payment-mode-${row.localId}`;
                  const amountId = `payment-amount-${row.localId}`;
                  const refId = `payment-ref-${row.localId}`;

                  return (
                    <div key={row.localId} className="billing-payment-row">
                      <div className="po-line-card__top">
                        <span className="catalog-label">Payment #{idx + 1}</span>
                        <div className="cell-actions__group">
                          <button
                            type="button"
                            className="btn-table-action"
                            disabled={isSubmitting || previewTotalPaise === null}
                            onClick={() => fillRemainingInPaymentRow(row.localId)}
                          >
                            Fill remaining
                          </button>
                          <button
                            type="button"
                            className="btn-table-action btn-table-action--danger"
                            disabled={isSubmitting}
                            onClick={() => removePaymentRow(row.localId)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>

                      <div className="billing-payment-row__fields">
                        <div className="catalog-field">
                          <label htmlFor={modeId} className="catalog-label">
                            Mode ({idx + 1})
                          </label>
                          <select
                            id={modeId}
                            className="catalog-select"
                            value={row.mode}
                            disabled={isSubmitting}
                            onChange={(event) =>
                              updatePaymentRow(row.localId, {
                                mode: event.target.value as PaymentMode,
                              })
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
                            disabled={isSubmitting}
                            onChange={(event) =>
                              updatePaymentRow(row.localId, { amountRaw: event.target.value })
                            }
                            aria-invalid={
                              (showCheckoutValidation || row.amountRaw.trim().length > 0) &&
                              rowCheck?.amountError
                                ? 'true'
                                : 'false'
                            }
                          />
                        </div>
                      </div>

                      {(showCheckoutValidation || row.amountRaw.trim().length > 0) &&
                      rowCheck?.amountError ? (
                        <p className="catalog-field-error" role="alert">
                          {rowCheck.amountError}
                        </p>
                      ) : null}

                      <div className="catalog-field">
                        <label htmlFor={refId} className="catalog-label">
                          Payment reference (optional)
                        </label>
                        <input
                          id={refId}
                          type="text"
                          className="catalog-input"
                          maxLength={150}
                          placeholder="e.g. UPI transaction ID"
                          value={row.referenceRaw}
                          disabled={isSubmitting}
                          onChange={(event) =>
                            updatePaymentRow(row.localId, { referenceRaw: event.target.value })
                          }
                          aria-invalid={rowCheck?.referenceError ? 'true' : 'false'}
                        />
                        {rowCheck?.referenceError ? (
                          <p className="catalog-field-error" role="alert">
                            {rowCheck.referenceError}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {isOverpaid && activePreview ? (
              <div className="alert-banner alert-banner--error" role="alert">
                <div className="alert-banner__content">
                  <p>
                    Payments ({formatInrDisplay(formatPaiseToInr(paidPaise))}) exceed the bill total (
                    {formatInrDisplay(activePreview.total)}). Overpayment is not allowed.
                  </p>
                </div>
              </div>
            ) : null}

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
                          void executeCheckout(pendingSubmit);
                        }}
                      >
                        Retry checkout
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <button
              type="submit"
              className="btn-primary"
              disabled={isSubmitting || cartLines.length === 0}
              aria-busy={isSubmitting}
              aria-describedby={customerErrorId}
            >
              {isSubmitting ? 'Completing bill…' : 'Complete Bill'}
            </button>
          </form>
        </aside>
      </div>

      <SkuPickerModal
        open={isSkuPickerOpen}
        api={catalog}
        initialQuery={skuPickerInitialQuery}
        onClose={() => setIsSkuPickerOpen(false)}
        onSelect={(sku) => {
          void handleSelectSkuFromPicker(sku);
        }}
      />

      <BatchSelectionModal
        open={batchModalState !== null}
        target={batchModalState?.target ?? null}
        onClose={() => setBatchModalState(null)}
        onSelectBatch={handleBatchSelected}
      />

      <CustomerPickerModal
        open={isCustomerModalOpen}
        api={billing}
        allowCreate
        onClose={() => setIsCustomerModalOpen(false)}
        onSelectCustomer={(customer) => {
          clearPendingAndErrors();
          setSelectedCustomer(customer);
        }}
      />

      <BillPrintPreviewModal
        open={isPrintModalOpen && completedBill !== null}
        billId={completedBill?.billId ?? null}
        api={billing}
        onClose={() => setIsPrintModalOpen(false)}
      />
    </div>
  );
}
