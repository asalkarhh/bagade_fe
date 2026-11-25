import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { isAbortError, isApiClientError } from '../api/errors.ts';
import { catalogApi, type CatalogApi } from '../catalog/catalogApi.ts';
import type { SkuListItem } from '../catalog/types.ts';
import { ModalDialog } from '../components/ModalDialog.tsx';
import { SkuPickerModal } from '../purchasing/components/SkuPickerModal.tsx';
import { VendorFormModal } from '../purchasing/components/VendorFormModal.tsx';
import { purchasingApi, type PurchasingApi } from '../purchasing/purchasingApi.ts';
import { getPoStatusDisplay } from '../purchasing/statusLabels.ts';
import type { PurchaseOrderDetail, PurchaseOrderLine, Vendor } from '../purchasing/types.ts';
import { formatInrDisplay, normalizeInrPriceInput } from '../utils/inrPrice.ts';
import { getShopLocalDateIso, isValidIsoDate } from '../utils/shopDate.ts';
import { BarcodeLinkModal } from './components/BarcodeLinkModal.tsx';
import { BarcodeScannerPanel } from './components/BarcodeScannerPanel.tsx';
import { inventoryApi, type InventoryApi } from './inventoryApi.ts';
import { recordSessionReceipt } from './sessionReceipts.ts';
import type { BarcodeLookupResult, CreateStockReceiptInput } from './types.ts';
import '../catalog/ProductsPage.css';
import './Inventory.css';

export interface ReceiveStockPageProps {
  inventory?: InventoryApi;
  purchasing?: PurchasingApi;
  catalog?: CatalogApi;
}

interface DraftReceiptLine {
  localId: number;
  poLineId: string | null;
  skuId: string;
  skuCode: string | null;
  productName: string;
  size: string | null;
  defaultSellingPrice: string | null;
  quantityRaw: string;
  unitCostRaw: string;
  printedMrpRaw: string;
  generateInternalTag: boolean;
}

interface LineFieldErrors {
  skuId?: string;
  quantity?: string;
  unitCost?: string;
  printedMrp?: string;
}

interface PendingReceiptSubmit {
  idempotencyKey: string;
  payload: CreateStockReceiptInput;
}

const VENDOR_PAGE_SIZE = 25;

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `rcp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parsePositiveInteger(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    return null;
  }
  const num = Number(trimmed);
  if (!Number.isSafeInteger(num) || num < 1 || num > 1_000_000) {
    return null;
  }
  return num;
}

export function ReceiveStockPage({
  inventory = inventoryApi,
  purchasing = purchasingApi,
  catalog = catalogApi,
}: ReceiveStockPageProps) {
  const { poId } = useParams<{ poId?: string }>();
  const isPoMode = Boolean(poId);
  const navigate = useNavigate();

  const vendorSearchId = useId();
  const vendorSelectId = useId();
  const vendorErrorId = useId();
  const receivedDateId = useId();
  const receivedDateErrorId = useId();
  const invoiceRefId = useId();
  const invoiceErrorId = useId();

  // PO data state (only used when receiving against a PO)
  const [poState, setPoState] = useState<{
    poId: string;
    po: PurchaseOrderDetail | null;
    error: { message: string; code?: string; requestId?: string | null } | null;
  } | null>(null);
  const [poRefreshTick, setPoRefreshTick] = useState(0);
  const initializedPoIdRef = useRef<string | null>(null);

  // Catalog selling price cache so existing selling price always displays separately from cost & MRP
  const [skuPriceMap, setSkuPriceMap] = useState<Record<string, string>>({});

  // Active vendor selector state (direct receipt mode)
  const [vendorSearchInput, setVendorSearchInput] = useState('');
  const [debouncedVendorQuery, setDebouncedVendorQuery] = useState('');
  const [vendorPage, setVendorPage] = useState(0);
  const [vendorRefreshTick, setVendorRefreshTick] = useState(0);
  const [vendorListState, setVendorListState] = useState<{
    key: string;
    items: Vendor[];
    total: number;
    error: string | null;
  } | null>(null);
  const vendorRequestSeqRef = useRef(0);

  // Receipt header state
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [selectedVendorRecord, setSelectedVendorRecord] = useState<Vendor | null>(null);
  const [receivedDate, setReceivedDate] = useState(() => getShopLocalDateIso());
  const [vendorInvoiceRef, setVendorInvoiceRef] = useState('');

  // Receipt draft lines
  const nextLineIdRef = useRef(2);
  const [lines, setLines] = useState<DraftReceiptLine[]>(() =>
    isPoMode
      ? []
      : [
          {
            localId: 1,
            poLineId: null,
            skuId: '',
            skuCode: null,
            productName: '',
            size: null,
            defaultSellingPrice: null,
            quantityRaw: '1',
            unitCostRaw: '',
            printedMrpRaw: '',
            generateInternalTag: false,
          },
        ],
  );

  // Barcode scan & linking state
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const [isLookingUpBarcode, setIsLookingUpBarcode] = useState(false);
  const [barcodeLookupError, setBarcodeLookupError] = useState<{
    message: string;
    requestId?: string | null;
  } | null>(null);
  const [barcodeStatusNotice, setBarcodeStatusNotice] = useState<string | null>(null);
  const [unknownBarcodeToLink, setUnknownBarcodeToLink] = useState<string | null>(null);
  const [pendingPoLineDisambiguation, setPendingPoLineDisambiguation] = useState<{
    barcode: string;
    skuName: string;
    defaultSellingPrice: string | null;
    matchingPoLines: PurchaseOrderLine[];
  } | null>(null);

  // Modals
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [pickingLineLocalId, setPickingLineLocalId] = useState<number | null>(null);

  // Validation & submission state
  const [vendorError, setVendorError] = useState<string | undefined>(undefined);
  const [receivedDateError, setReceivedDateError] = useState<string | undefined>(undefined);
  const [invoiceRefError, setInvoiceRefError] = useState<string | undefined>(undefined);
  const [linesBannerError, setLinesBannerError] = useState<string | undefined>(undefined);
  const [lineErrors, setLineErrors] = useState<Record<number, LineFieldErrors>>({});
  const [submitError, setSubmitError] = useState<{
    message: string;
    requestId?: string | null;
    isUnknownOutcome?: boolean;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<PendingReceiptSubmit | null>(null);

  const submittingRef = useRef(false);

  const invalidatePendingSubmit = useCallback(() => {
    setPendingSubmit(null);
  }, []);

  useEffect(() => {
    document.title = isPoMode
      ? 'Receive Purchase Order Stock | Bagade Clothing'
      : 'Direct Stock Receipt | Bagade Clothing';
  }, [isPoMode]);

  // Load PO when receiving against a purchase order
  useEffect(() => {
    if (!poId) {
      return;
    }

    const controller = new AbortController();
    purchasing
      .getPurchaseOrder(poId, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) {
          return;
        }
        document.title = `Receive ${loaded.poNumber} | Bagade Clothing`;
        setPoState({ poId, po: loaded, error: null });
        setSelectedVendorId(loaded.vendorId);

        if (initializedPoIdRef.current !== poId) {
          initializedPoIdRef.current = poId;
          const openLines = loaded.lines.filter((line) => line.openQuantity > 0);
          const initialDraft: DraftReceiptLine[] = openLines.map((line, index) => ({
            localId: index + 1,
            poLineId: line.poLineId,
            skuId: line.skuId,
            skuCode: line.skuCode,
            productName: line.productName,
            size: line.size,
            defaultSellingPrice: null,
            quantityRaw: String(line.openQuantity),
            unitCostRaw: line.agreedUnitCost ?? '',
            printedMrpRaw: '',
            generateInternalTag: false,
          }));
          nextLineIdRef.current = initialDraft.length + 1;
          setLines(initialDraft);
        }
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || controller.signal.aborted) {
          return;
        }
        setPoState({
          poId,
          po: null,
          error: isApiClientError(error)
            ? { message: error.message, code: error.code, requestId: error.requestId }
            : { message: 'Unable to load purchase order.' },
        });
      });

    return () => {
      controller.abort();
    };
  }, [poId, poRefreshTick, purchasing]);

  // Populate selling prices for PO line SKUs so current selling price displays separately
  const currentPo = poId && poState?.poId === poId ? poState.po : null;
  useEffect(() => {
    if (!currentPo || currentPo.lines.length === 0) {
      return;
    }
    const controller = new AbortController();
    catalog
      .listSkus({ status: 'ACTIVE', page: 0, size: 100 }, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) {
          return;
        }
        const priceEntries: Record<string, string> = {};
        for (const sku of res.items) {
          priceEntries[sku.skuId] = sku.defaultSellingPrice;
        }
        setSkuPriceMap((prev) => ({ ...priceEntries, ...prev }));
      })
      .catch(() => {
        // Non-blocking: missing cached price displays dash if lookup fails.
      });

    return () => {
      controller.abort();
    };
  }, [catalog, currentPo]);

  const refreshLinkedPo = useCallback(async (): Promise<PurchaseOrderDetail | null> => {
    if (!poId) {
      return null;
    }
    try {
      const latest = await purchasing.getPurchaseOrder(poId);
      setPoState({ poId, po: latest, error: null });
      return latest;
    } catch {
      return null;
    }
  }, [poId, purchasing]);

  // Vendor search debounce & loading for Direct Receipt mode
  useEffect(() => {
    if (isPoMode) {
      return;
    }
    const trimmed = vendorSearchInput.trim();
    if (trimmed === debouncedVendorQuery) {
      return;
    }
    const timer = window.setTimeout(() => {
      setDebouncedVendorQuery(trimmed);
      setVendorPage(0);
    }, 220);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isPoMode, vendorSearchInput, debouncedVendorQuery]);

  const vendorQueryKey = useMemo(
    () => JSON.stringify({ q: debouncedVendorQuery, page: vendorPage, vendorRefreshTick }),
    [debouncedVendorQuery, vendorPage, vendorRefreshTick],
  );

  useEffect(() => {
    if (isPoMode) {
      return;
    }
    const controller = new AbortController();
    const seq = ++vendorRequestSeqRef.current;

    purchasing
      .listVendors(
        {
          q: debouncedVendorQuery || undefined,
          status: 'ACTIVE',
          page: vendorPage,
          size: VENDOR_PAGE_SIZE,
        },
        controller.signal,
      )
      .then((res) => {
        if (seq !== vendorRequestSeqRef.current || controller.signal.aborted) {
          return;
        }
        setVendorListState({
          key: vendorQueryKey,
          items: res.items,
          total: res.total,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (
          isAbortError(error) ||
          controller.signal.aborted ||
          seq !== vendorRequestSeqRef.current
        ) {
          return;
        }
        setVendorListState({
          key: vendorQueryKey,
          items: [],
          total: 0,
          error: isApiClientError(error) ? error.message : 'Unable to load active vendors.',
        });
      });

    return () => {
      controller.abort();
    };
  }, [isPoMode, purchasing, debouncedVendorQuery, vendorPage, vendorQueryKey]);

  const availableVendors = useMemo(() => {
    const list = vendorListState?.items ?? [];
    if (
      selectedVendorRecord &&
      selectedVendorRecord.active &&
      !list.some((item) => item.vendorId === selectedVendorRecord.vendorId)
    ) {
      return [selectedVendorRecord, ...list];
    }
    return list;
  }, [vendorListState, selectedVendorRecord]);

  const totalVendors = vendorListState?.total ?? 0;
  const vendorLoadError = vendorListState?.error ?? null;
  const isLoadingVendors = !isPoMode && vendorListState?.key !== vendorQueryKey;
  const totalVendorPages = Math.max(1, Math.ceil(totalVendors / VENDOR_PAGE_SIZE));

  // Combined requested quantities per PO line (for live open-quantity validation)
  const draftQtyByPoLineId = useMemo(() => {
    const totals = new Map<string, number>();
    for (const line of lines) {
      if (!line.poLineId) {
        continue;
      }
      const parsed = parsePositiveInteger(line.quantityRaw);
      if (parsed !== null) {
        totals.set(line.poLineId, (totals.get(line.poLineId) ?? 0) + parsed);
      }
    }
    return totals;
  }, [lines]);

  const appendOrFillDirectSku = useCallback(
    (sku: {
      skuId: string;
      skuCode: string | null;
      productName: string;
      size: string | null;
      defaultSellingPrice: string | null;
    }) => {
      invalidatePendingSubmit();
      setLinesBannerError(undefined);
      if (sku.defaultSellingPrice) {
        setSkuPriceMap((prev) => ({
          ...prev,
          [sku.skuId]: sku.defaultSellingPrice!,
        }));
      }

      setLines((prev) => {
        if (prev.length === 1 && !prev[0]!.skuId) {
          const first = prev[0]!;
          setLineErrors((errPrev) => ({
            ...errPrev,
            [first.localId]: { ...errPrev[first.localId], skuId: undefined },
          }));
          return [
            {
              ...first,
              skuId: sku.skuId,
              skuCode: sku.skuCode,
              productName: sku.productName,
              size: sku.size,
              defaultSellingPrice: sku.defaultSellingPrice,
            },
          ];
        }
        const newId = nextLineIdRef.current++;
        return [
          ...prev,
          {
            localId: newId,
            poLineId: null,
            skuId: sku.skuId,
            skuCode: sku.skuCode,
            productName: sku.productName,
            size: sku.size,
            defaultSellingPrice: sku.defaultSellingPrice,
            quantityRaw: '1',
            unitCostRaw: '',
            printedMrpRaw: '',
            generateInternalTag: false,
          },
        ];
      });
    },
    [invalidatePendingSubmit],
  );

  const addDraftLineForPoLine = useCallback(
    (poLine: PurchaseOrderLine, sellingPriceOverride?: string | null, initialQty?: number) => {
      invalidatePendingSubmit();
      setLinesBannerError(undefined);
      const alreadyRequested = lines.reduce((sum, item) => {
        if (item.poLineId !== poLine.poLineId) {
          return sum;
        }
        const q = parsePositiveInteger(item.quantityRaw);
        return sum + (q ?? 0);
      }, 0);
      const remainingToAllocate = Math.max(1, poLine.openQuantity - alreadyRequested);
      const qtyToUse = initialQty ?? remainingToAllocate;

      const newId = nextLineIdRef.current++;
      setLines((prev) => [
        ...prev,
        {
          localId: newId,
          poLineId: poLine.poLineId,
          skuId: poLine.skuId,
          skuCode: poLine.skuCode,
          productName: poLine.productName,
          size: poLine.size,
          defaultSellingPrice: sellingPriceOverride ?? skuPriceMap[poLine.skuId] ?? null,
          quantityRaw: String(qtyToUse),
          unitCostRaw: poLine.agreedUnitCost ?? '',
          printedMrpRaw: '',
          generateInternalTag: false,
        },
      ]);
    },
    [invalidatePendingSubmit, lines, skuPriceMap],
  );

  const applyResolvedSkuFromBarcode = useCallback(
    (matched: {
      code: string;
      skuId: string;
      skuCode: string | null;
      productName: string;
      size: string | null;
      defaultSellingPrice: string | null;
    }) => {
      if (matched.defaultSellingPrice) {
        setSkuPriceMap((prev) => ({
          ...prev,
          [matched.skuId]: matched.defaultSellingPrice!,
        }));
      }

      if (!isPoMode) {
        appendOrFillDirectSku(matched);
        setBarcodeStatusNotice(
          `Added ${matched.productName}${matched.size ? ` (Size ${matched.size})` : ''} from barcode ${matched.code} for a new stock batch.`,
        );
        return true;
      }

      if (!currentPo) {
        return false;
      }

      const openMatches = currentPo.lines.filter(
        (line) => line.skuId === matched.skuId && line.openQuantity > 0,
      );

      if (openMatches.length === 0) {
        setBarcodeLookupError({
          message: `Barcode ${matched.code} matched ${matched.productName}${matched.size ? ` (${matched.size})` : ''}, which has no open quantity on ${currentPo.poNumber}.`,
        });
        return false;
      }

      if (openMatches.length > 1) {
        setPendingPoLineDisambiguation({
          barcode: matched.code,
          skuName: matched.productName,
          defaultSellingPrice: matched.defaultSellingPrice,
          matchingPoLines: openMatches,
        });
        return true;
      }

      const targetPoLine = openMatches[0]!;
      const existingDraft = lines.find((line) => line.poLineId === targetPoLine.poLineId);
      if (existingDraft) {
        setBarcodeStatusNotice(
          `Barcode ${matched.code} matched PO line ${targetPoLine.skuCode} (${targetPoLine.openQuantity} open). Adjust the line below or click "+ Split line" to receive another batch.`,
        );
      } else {
        addDraftLineForPoLine(targetPoLine, matched.defaultSellingPrice, 1);
        setBarcodeStatusNotice(
          `Added PO line ${targetPoLine.skuCode} from barcode ${matched.code}.`,
        );
      }
      return true;
    },
    [addDraftLineForPoLine, appendOrFillDirectSku, currentPo, isPoMode, lines],
  );

  const handleBarcodeLookup = useCallback(
    async (rawCode: string): Promise<boolean> => {
      const code = rawCode.trim();
      if (!code) {
        return false;
      }
      setIsLookingUpBarcode(true);
      setBarcodeLookupError(null);
      setBarcodeStatusNotice(null);

      try {
        const lookup = await inventory.lookupBarcode(code);
        // Never reuse lookup.batchId when receiving: receipts always create a fresh batch.
        const handled = applyResolvedSkuFromBarcode({
          code: lookup.code,
          skuId: lookup.skuId,
          skuCode: null,
          productName: lookup.name,
          size: lookup.size,
          defaultSellingPrice: lookup.defaultSellingPrice,
        });
        return handled;
      } catch (error) {
        if (isApiClientError(error) && error.code === 'BARCODE_NOT_FOUND') {
          setUnknownBarcodeToLink(code);
          return false;
        }
        setBarcodeLookupError(
          isApiClientError(error)
            ? { message: error.message, requestId: error.requestId }
            : { message: 'Unable to look up barcode. Check connection and try again.' },
        );
        return false;
      } finally {
        setIsLookingUpBarcode(false);
      }
    },
    [applyResolvedSkuFromBarcode, inventory],
  );

  const handleUnknownBarcodeLinked = (sku: SkuListItem, code: string) => {
    setUnknownBarcodeToLink(null);
    applyResolvedSkuFromBarcode({
      code,
      skuId: sku.skuId,
      skuCode: sku.skuCode,
      productName: sku.productName,
      size: sku.size,
      defaultSellingPrice: sku.defaultSellingPrice,
    });
  };

  const handleUseConflictingLookup = (lookup: BarcodeLookupResult) => {
    setUnknownBarcodeToLink(null);
    applyResolvedSkuFromBarcode({
      code: lookup.code,
      skuId: lookup.skuId,
      skuCode: null,
      productName: lookup.name,
      size: lookup.size,
      defaultSellingPrice: lookup.defaultSellingPrice,
    });
  };

  const handleAddDirectLine = () => {
    invalidatePendingSubmit();
    const newId = nextLineIdRef.current++;
    setLines((prev) => [
      ...prev,
      {
        localId: newId,
        poLineId: null,
        skuId: '',
        skuCode: null,
        productName: '',
        size: null,
        defaultSellingPrice: null,
        quantityRaw: '1',
        unitCostRaw: '',
        printedMrpRaw: '',
        generateInternalTag: false,
      },
    ]);
    setLinesBannerError(undefined);
  };

  const handleRemoveLine = (localId: number) => {
    invalidatePendingSubmit();
    setLines((prev) => prev.filter((line) => line.localId !== localId));
    setLineErrors((prev) => {
      const next = { ...prev };
      delete next[localId];
      return next;
    });
  };

  const handleSelectDirectSku = (sku: SkuListItem) => {
    if (pickingLineLocalId === null) {
      return;
    }
    invalidatePendingSubmit();
    setSkuPriceMap((prev) => ({
      ...prev,
      [sku.skuId]: sku.defaultSellingPrice,
    }));
    setLines((prev) =>
      prev.map((line) =>
        line.localId === pickingLineLocalId
          ? {
              ...line,
              skuId: sku.skuId,
              skuCode: sku.skuCode,
              productName: sku.productName,
              size: sku.size,
              defaultSellingPrice: sku.defaultSellingPrice,
            }
          : line,
      ),
    );
    setLineErrors((prev) => {
      const existing = prev[pickingLineLocalId];
      if (!existing?.skuId) {
        return prev;
      }
      return {
        ...prev,
        [pickingLineLocalId]: { ...existing, skuId: undefined },
      };
    });
    setPickingLineLocalId(null);
  };

  const updateLineField = (localId: number, patch: Partial<DraftReceiptLine>) => {
    invalidatePendingSubmit();
    setLines((prev) =>
      prev.map((line) => (line.localId === localId ? { ...line, ...patch } : line)),
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current || isSubmitting) {
      return;
    }

    let attemptToSend = pendingSubmit;

    if (!attemptToSend) {
      let hasErrors = false;
      let nextVendorErr: string | undefined;
      let nextDateErr: string | undefined;
      let nextInvoiceErr: string | undefined;
      let nextLinesBanner: string | undefined;
      const nextLineErrors: Record<number, LineFieldErrors> = {};

      if (!selectedVendorId) {
        nextVendorErr = 'Select an active vendor.';
        hasErrors = true;
      }

      if (!isValidIsoDate(receivedDate)) {
        nextDateErr = 'Enter a valid received date (YYYY-MM-DD).';
        hasErrors = true;
      }

      const trimmedInvoice = vendorInvoiceRef.trim();
      if (trimmedInvoice.length > 150) {
        nextInvoiceErr = 'Vendor invoice reference must not exceed 150 characters.';
        hasErrors = true;
      }

      if (lines.length === 0) {
        nextLinesBanner = 'Add at least one receipt line.';
        hasErrors = true;
      }

      const requestedPerPoLine = new Map<string, number>();
      const preparedLines: CreateStockReceiptInput['lines'] = [];

      for (const line of lines) {
        const err: LineFieldErrors = {};

        if (!line.skuId) {
          err.skuId = 'Select or scan an active SKU.';
          hasErrors = true;
        }

        const qty = parsePositiveInteger(line.quantityRaw);
        if (qty === null) {
          err.quantity = 'Enter a whole number greater than 0.';
          hasErrors = true;
        }

        const costCheck = normalizeInrPriceInput(line.unitCostRaw);
        if (!costCheck.ok) {
          err.unitCost =
            line.unitCostRaw.trim().length === 0
              ? 'Enter the purchase unit cost in INR.'
              : costCheck.error;
          hasErrors = true;
        }

        let normalizedMrp: string | undefined;
        if (line.printedMrpRaw.trim().length > 0) {
          const mrpCheck = normalizeInrPriceInput(line.printedMrpRaw);
          if (!mrpCheck.ok) {
            err.printedMrp = mrpCheck.error;
            hasErrors = true;
          } else {
            normalizedMrp = mrpCheck.value;
          }
        }

        if (isPoMode && line.poLineId && qty !== null) {
          requestedPerPoLine.set(
            line.poLineId,
            (requestedPerPoLine.get(line.poLineId) ?? 0) + qty,
          );
        }

        if (err.skuId || err.quantity || err.unitCost || err.printedMrp) {
          nextLineErrors[line.localId] = err;
        } else if (qty !== null && costCheck.ok) {
          const payloadLine: CreateStockReceiptInput['lines'][number] = {
            skuId: line.skuId,
            quantity: qty,
            unitCost: costCheck.value,
            generateInternalTag: line.generateInternalTag,
          };
          if (normalizedMrp !== undefined) {
            payloadLine.printedMrp = normalizedMrp;
          }
          if (isPoMode && line.poLineId) {
            payloadLine.poLineId = line.poLineId;
          }
          preparedLines.push(payloadLine);
        }
      }

      // Client-side check combining multiple receipt lines targeting the same PO line
      if (isPoMode && currentPo) {
        const exceededPoLines = new Set<string>();
        for (const [targetPoLineId, combinedQty] of requestedPerPoLine.entries()) {
          const poLine = currentPo.lines.find((item) => item.poLineId === targetPoLineId);
          if (!poLine) {
            nextLinesBanner = 'One or more receipt lines reference an unknown PO line.';
            hasErrors = true;
          } else if (combinedQty > poLine.openQuantity) {
            exceededPoLines.add(targetPoLineId);
            hasErrors = true;
          }
        }

        if (exceededPoLines.size > 0) {
          for (const line of lines) {
            if (line.poLineId && exceededPoLines.has(line.poLineId)) {
              const poLine = currentPo.lines.find((item) => item.poLineId === line.poLineId)!;
              const combined = requestedPerPoLine.get(line.poLineId)!;
              nextLineErrors[line.localId] = {
                ...nextLineErrors[line.localId],
                quantity: `Combined quantity (${combined}) exceeds open quantity (${poLine.openQuantity}).`,
              };
            }
          }
        }
      }

      setVendorError(nextVendorErr);
      setReceivedDateError(nextDateErr);
      setInvoiceRefError(nextInvoiceErr);
      setLinesBannerError(nextLinesBanner);
      setLineErrors(nextLineErrors);

      if (hasErrors) {
        setSubmitError({
          message: 'Please correct the highlighted stock receipt fields before posting.',
        });
        return;
      }

      const payload: CreateStockReceiptInput = {
        vendorId: selectedVendorId,
        receivedDate: receivedDate.trim(),
        ...(isPoMode && poId ? { poId } : {}),
        ...(trimmedInvoice ? { vendorInvoiceRef: trimmedInvoice } : {}),
        lines: preparedLines,
      };

      attemptToSend = {
        idempotencyKey: generateIdempotencyKey(),
        payload,
      };
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const created = await inventory.createStockReceipt(
        attemptToSend.payload,
        attemptToSend.idempotencyKey,
      );

      setPendingSubmit(null);
      recordSessionReceipt(created);

      // Refresh PO, catalog stock, and inventory data in background without blocking navigation.
      if (created.poId) {
        void purchasing.getPurchaseOrder(created.poId).catch(() => undefined);
      }
      void catalog.listSkus({ status: 'ACTIVE', page: 0, size: 25 }).catch(() => undefined);
      void inventory.listInventory({ page: 0, size: 25 }).catch(() => undefined);

      navigate(`/inventory/receipts/${created.receiptId}`, { replace: true });
    } catch (error) {
      if (isApiClientError(error)) {
        if (error.code === 'PO_QUANTITY_EXCEEDED' || error.code === 'PO_LINE_MISMATCH') {
          setPendingSubmit(null);
          await refreshLinkedPo();
          setSubmitError({
            message: `${error.message} Purchase order balances were refreshed below — review your quantities and try again.`,
            requestId: error.requestId,
          });
        } else if (error.kind === 'network' || error.kind === 'server') {
          setPendingSubmit(attemptToSend);
          setSubmitError({
            message:
              'Connection dropped or server error while posting receipt — outcome is unknown. Retry with the exact same submission so stock is not counted twice.',
            requestId: error.requestId,
            isUnknownOutcome: true,
          });
        } else {
          setPendingSubmit(null);
          const mappedLineErrors: Record<number, LineFieldErrors> = {};
          for (const item of error.fieldErrors) {
            if (item.field === 'vendorId') {
              setVendorError(item.message);
            } else if (item.field === 'receivedDate') {
              setReceivedDateError(item.message);
            } else if (item.field === 'vendorInvoiceRef') {
              setInvoiceRefError(item.message);
            } else if (item.field === 'lines') {
              setLinesBannerError(item.message);
            } else {
              const match = /^lines\[(\d+)\]\.(skuId|quantity|unitCost|printedMrp)$/.exec(
                item.field,
              );
              if (match) {
                const idx = Number(match[1]);
                const prop = match[2] as keyof LineFieldErrors;
                const targetLine = lines[idx];
                if (targetLine) {
                  mappedLineErrors[targetLine.localId] = {
                    ...mappedLineErrors[targetLine.localId],
                    [prop]: item.message,
                  };
                }
              }
            }
          }
          setLineErrors(mappedLineErrors);
          setSubmitError({
            message: error.message || 'Stock receipt could not be posted.',
            requestId: error.requestId,
          });
        }
      } else {
        setPendingSubmit(attemptToSend);
        setSubmitError({
          message:
            'Unexpected error while posting stock receipt. Retry exact submission safely below.',
          isUnknownOutcome: true,
        });
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // Loading / Error views for PO mode
  const poLoadError = isPoMode && poId && poState?.poId === poId ? poState.error : null;
  const isLoadingPo = isPoMode && Boolean(poId) && poState?.poId !== poId;

  if (isLoadingPo) {
    return (
      <section className="surface-card module-page" aria-busy="true">
        <h1 id="main-content" tabIndex={-1}>
          Loading purchase order…
        </h1>
        <progress className="state-progress" aria-label="Loading purchase order" />
      </section>
    );
  }

  if (isPoMode && (poLoadError || !currentPo)) {
    return (
      <section className="surface-card module-page">
        <p>
          <Link to="/purchases">← Back to Purchase Orders</Link>
        </p>
        <h1 id="main-content" tabIndex={-1}>
          {poLoadError?.code === 'RESOURCE_NOT_FOUND'
            ? 'Purchase order not found'
            : 'Unable to load purchase order'}
        </h1>
        <div className="alert-banner alert-banner--error" role="alert">
          <div className="alert-banner__content">
            <p>{poLoadError?.message ?? 'Purchase order could not be loaded.'}</p>
            {poLoadError?.requestId ? (
              <p className="alert-banner__meta">Request ID: {poLoadError.requestId}</p>
            ) : null}
            {poLoadError?.code !== 'RESOURCE_NOT_FOUND' ? (
              <div className="alert-banner__actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setPoRefreshTick((prev) => prev + 1)}
                >
                  Retry
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  const poHasOpenQuantities =
    currentPo !== null &&
    currentPo.totalOpenQuantity > 0 &&
    currentPo.lines.some((line) => line.openQuantity > 0);

  if (isPoMode && currentPo && !poHasOpenQuantities) {
    return (
      <section className="surface-card module-page">
        <p>
          <Link to={`/purchases/${currentPo.poId}`}>← Back to {currentPo.poNumber}</Link>
        </p>
        <h1 id="main-content" tabIndex={-1}>
          Receive stock — {currentPo.poNumber}
        </h1>
        <div className="alert-banner alert-banner--info" role="status">
          <div className="alert-banner__content">
            <p>
              {currentPo.poNumber} ({getPoStatusDisplay(currentPo.status).label}) has no remaining
              open quantities to receive.
            </p>
            <div className="alert-banner__actions">
              <Link to={`/purchases/${currentPo.poId}`} className="btn-secondary">
                Return to PO detail
              </Link>
              <Link to="/purchases/receive" className="btn-primary">
                Create direct receipt
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="products-page">
      <div className="products-header">
        <div className="products-header__title-group">
          <p>
            <Link to={currentPo ? `/purchases/${currentPo.poId}` : '/purchases'}>
              {currentPo ? `← Back to ${currentPo.poNumber}` : '← Back to Purchase Orders'}
            </Link>
          </p>
          <h1 id="main-content" tabIndex={-1}>
            {currentPo ? `Receive Stock — ${currentPo.poNumber}` : 'Direct Stock Receipt'}
          </h1>
          <p className="products-header__subtitle">
            {currentPo
              ? `Prefilled from ${currentPo.poNumber} (${currentPo.vendorName}). Receive partial or full open quantities into new stock batches.`
              : 'Record stock purchased directly without a purchase order. Scan barcodes or pick SKUs to create new batches.'}
          </p>
        </div>
      </div>

      {submitError ? (
        <div
          className={
            submitError.isUnknownOutcome
              ? 'alert-banner alert-banner--warning'
              : 'alert-banner alert-banner--error'
          }
          role="alert"
        >
          <div className="alert-banner__content">
            <p>{submitError.message}</p>
            {submitError.requestId ? (
              <p className="alert-banner__meta">Request ID: {submitError.requestId}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {currentPo ? (
        <section className="surface-card receipt-po-lines-summary" aria-label="Purchase order balances">
          <div className="po-lines-header">
            <h2>{currentPo.poNumber} — Open Quantities</h2>
            <span
              className={`po-status-pill po-status-pill--${getPoStatusDisplay(currentPo.status).variant}`}
            >
              <span aria-hidden="true">{getPoStatusDisplay(currentPo.status).symbol}</span>
              <span>{getPoStatusDisplay(currentPo.status).label}</span>
            </span>
          </div>

          <div
            tabIndex={0}
            role="region"
            aria-label="Purchase order line quantities"
            className="catalog-table-wrapper"
          >
            <table className="catalog-table">
              <caption className="visually-hidden">
                Purchase order line balances and draft receipt allocations
              </caption>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">SKU code</th>
                  <th scope="col">Size</th>
                  <th scope="col" className="cell-num">
                    Ordered
                  </th>
                  <th scope="col" className="cell-num">
                    Received
                  </th>
                  <th scope="col" className="cell-num">
                    Open
                  </th>
                  <th scope="col" className="cell-num">
                    In draft
                  </th>
                  <th scope="col">Split batch</th>
                </tr>
              </thead>
              <tbody>
                {currentPo.lines.map((poLine) => {
                  const inDraft = draftQtyByPoLineId.get(poLine.poLineId) ?? 0;
                  const exceeds = inDraft > poLine.openQuantity;
                  return (
                    <tr key={poLine.poLineId}>
                      <th scope="row">{poLine.productName}</th>
                      <td data-label="SKU code" className="cell-code">
                        <code>{poLine.skuCode}</code>
                      </td>
                      <td data-label="Size">{poLine.size ?? '—'}</td>
                      <td data-label="Ordered" className="cell-num">
                        {poLine.orderedQuantity}
                      </td>
                      <td data-label="Received" className="cell-num">
                        {poLine.receivedQuantity}
                      </td>
                      <td data-label="Open" className="cell-num">
                        {poLine.openQuantity}
                      </td>
                      <td data-label="In draft" className="cell-num">
                        <span className={exceeds ? 'catalog-field-error' : undefined}>
                          {inDraft}
                          {exceeds ? ' (exceeds)' : ''}
                        </span>
                      </td>
                      <td data-label="Split batch">
                        {poLine.openQuantity > 0 ? (
                          <button
                            type="button"
                            className="btn-table-action"
                            onClick={() => addDraftLineForPoLine(poLine, undefined, 1)}
                          >
                            + Split line
                          </button>
                        ) : (
                          'Closed'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <form className="surface-card po-form" onSubmit={handleSubmit} noValidate>
        <div className="po-header-grid">
          {currentPo ? (
            <div className="catalog-field">
              <span className="catalog-label">Vendor (from PO)</span>
              <div className="po-sku-box">
                <div className="po-sku-box__info">
                  <span className="po-sku-box__name">{currentPo.vendorName}</span>
                  <span className="po-sku-box__meta">
                    Linked to {currentPo.poNumber}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="po-vendor-picker">
              <div className="catalog-label-row">
                <label htmlFor={vendorSelectId} className="catalog-label">
                  Vendor <span className="form-required" aria-hidden="true">*</span>
                </label>
                <button
                  type="button"
                  className="catalog-inline-link"
                  onClick={() => setIsVendorModalOpen(true)}
                >
                  + New vendor
                </button>
              </div>

              <div className="po-vendor-controls">
                <label htmlFor={vendorSearchId} className="visually-hidden">
                  Search active vendors
                </label>
                <input
                  id={vendorSearchId}
                  type="search"
                  className="catalog-input"
                  value={vendorSearchInput}
                  onChange={(event) => setVendorSearchInput(event.target.value)}
                  placeholder="Search active vendors by name or contact"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </div>

              <select
                id={vendorSelectId}
                name="vendorId"
                className="catalog-select"
                value={selectedVendorId}
                onChange={(event) => {
                  invalidatePendingSubmit();
                  const nextId = event.target.value;
                  setSelectedVendorId(nextId);
                  const matched = availableVendors.find((v) => v.vendorId === nextId) ?? null;
                  setSelectedVendorRecord(matched);
                  if (vendorError && nextId) {
                    setVendorError(undefined);
                  }
                }}
                required
                aria-invalid={vendorError ? 'true' : 'false'}
                aria-describedby={vendorError ? vendorErrorId : undefined}
              >
                <option value="">
                  {isLoadingVendors ? 'Loading active vendors…' : 'Select an active vendor…'}
                </option>
                {availableVendors.map((v) => (
                  <option key={v.vendorId} value={v.vendorId}>
                    {v.name}
                    {v.contact ? ` (${v.contact})` : ''}
                  </option>
                ))}
              </select>

              {vendorLoadError ? (
                <p className="catalog-field-error" role="alert">
                  {vendorLoadError}
                </p>
              ) : null}

              {totalVendors > VENDOR_PAGE_SIZE || vendorPage > 0 ? (
                <div className="po-picker-pager">
                  <span>
                    Vendor page {vendorPage + 1} of {totalVendorPages} ({totalVendors} active)
                  </span>
                  <div className="catalog-pagination__controls">
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={vendorPage <= 0 || isLoadingVendors}
                      onClick={() => setVendorPage((prev) => Math.max(0, prev - 1))}
                    >
                      Prev vendors
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={
                        (vendorPage + 1) * VENDOR_PAGE_SIZE >= totalVendors || isLoadingVendors
                      }
                      onClick={() => setVendorPage((prev) => prev + 1)}
                    >
                      Next vendors
                    </button>
                  </div>
                </div>
              ) : null}

              {vendorError ? (
                <p id={vendorErrorId} className="catalog-field-error">
                  <span aria-hidden="true">!</span>
                  <span>{vendorError}</span>
                </p>
              ) : null}
            </div>
          )}

          <div className="catalog-field">
            <label htmlFor={receivedDateId} className="catalog-label">
              Received date <span className="form-required" aria-hidden="true">*</span>
            </label>
            <input
              id={receivedDateId}
              name="receivedDate"
              type="date"
              className="catalog-input"
              value={receivedDate}
              onChange={(event) => {
                invalidatePendingSubmit();
                setReceivedDate(event.target.value);
                if (receivedDateError && isValidIsoDate(event.target.value)) {
                  setReceivedDateError(undefined);
                }
              }}
              required
              aria-invalid={receivedDateError ? 'true' : 'false'}
              aria-describedby={receivedDateError ? receivedDateErrorId : undefined}
            />
            {receivedDateError ? (
              <p id={receivedDateErrorId} className="catalog-field-error">
                <span aria-hidden="true">!</span>
                <span>{receivedDateError}</span>
              </p>
            ) : null}
          </div>

          <div className="catalog-field">
            <label htmlFor={invoiceRefId} className="catalog-label">
              Vendor invoice ref (optional)
            </label>
            <input
              id={invoiceRefId}
              name="vendorInvoiceRef"
              type="text"
              className="catalog-input"
              value={vendorInvoiceRef}
              maxLength={150}
              placeholder="e.g. INV-2026-104"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) => {
                invalidatePendingSubmit();
                setVendorInvoiceRef(event.target.value);
                if (invoiceRefError && event.target.value.trim().length <= 150) {
                  setInvoiceRefError(undefined);
                }
              }}
              aria-invalid={invoiceRefError ? 'true' : 'false'}
              aria-describedby={invoiceRefError ? invoiceErrorId : undefined}
            />
            {invoiceRefError ? (
              <p id={invoiceErrorId} className="catalog-field-error">
                <span aria-hidden="true">!</span>
                <span>{invoiceRefError}</span>
              </p>
            ) : null}
          </div>
        </div>

        <BarcodeScannerPanel
          isLookingUp={isLookingUpBarcode}
          lookupError={barcodeLookupError}
          disabled={isSubmitting}
          inputRef={barcodeInputRef}
          onLookupCode={handleBarcodeLookup}
        />

        {barcodeStatusNotice ? (
          <div className="alert-banner alert-banner--info" role="status">
            <div className="alert-banner__content">
              <p>{barcodeStatusNotice}</p>
            </div>
          </div>
        ) : null}

        <section className="po-lines-section" aria-label="Receipt lines">
          <div className="po-lines-header">
            <h2>Receipt lines ({lines.length})</h2>
            {!isPoMode ? (
              <button type="button" className="btn-secondary" onClick={handleAddDirectLine}>
                + Add line
              </button>
            ) : null}
          </div>

          {linesBannerError ? (
            <div className="alert-banner alert-banner--error" role="alert">
              <div className="alert-banner__content">
                <p>{linesBannerError}</p>
              </div>
            </div>
          ) : null}

          {lines.length === 0 ? (
            <p className="products-header__subtitle">
              No receipt lines in draft.{' '}
              {isPoMode
                ? 'Click "+ Split line" on an open PO line above or scan a barcode.'
                : 'Click "+ Add line" or scan a barcode above.'}
            </p>
          ) : (
            lines.map((line, index) => {
              const err = lineErrors[line.localId] ?? {};
              const qtyInputId = `rcp-qty-${line.localId}`;
              const costInputId = `rcp-cost-${line.localId}`;
              const mrpInputId = `rcp-mrp-${line.localId}`;
              const tagToggleId = `rcp-tag-${line.localId}`;
              const knownSellingPrice =
                line.defaultSellingPrice ??
                (line.skuId ? skuPriceMap[line.skuId] ?? null : null);
              const linkedPoLine =
                isPoMode && currentPo && line.poLineId
                  ? currentPo.lines.find((item) => item.poLineId === line.poLineId) ?? null
                  : null;

              return (
                <div key={line.localId} className="po-line-card">
                  <div className="po-line-card__top">
                    <span className="po-line-card__title">
                      Line {index + 1}
                      {linkedPoLine ? ` · PO open: ${linkedPoLine.openQuantity}` : ''}
                    </span>
                    <button
                      type="button"
                      className="btn-table-action btn-table-action--danger"
                      onClick={() => handleRemoveLine(line.localId)}
                    >
                      Remove line {index + 1}
                    </button>
                  </div>

                  <div className="catalog-field">
                    <span className="catalog-label">
                      SKU <span className="form-required" aria-hidden="true">*</span>
                    </span>
                    <div className={err.skuId ? 'po-sku-box po-sku-box--invalid' : 'po-sku-box'}>
                      <div className="po-sku-box__info">
                        {line.skuId ? (
                          <>
                            <span className="po-sku-box__name">{line.productName}</span>
                            <div className="receipt-line-prices">
                              {line.skuCode ? <code>{line.skuCode}</code> : null}
                              <span>Size: {line.size ?? '—'}</span>
                              <span>
                                Current selling price:{' '}
                                <strong>
                                  {knownSellingPrice ? formatInrDisplay(knownSellingPrice) : '—'}
                                </strong>
                              </span>
                            </div>
                          </>
                        ) : (
                          <span className="po-sku-box__meta">No SKU selected</span>
                        )}
                      </div>
                      {!isPoMode ? (
                        <button
                          type="button"
                          className="btn-table-action"
                          onClick={() => setPickingLineLocalId(line.localId)}
                        >
                          {line.skuId
                            ? `Change SKU (line ${index + 1})`
                            : `Select SKU (line ${index + 1})`}
                        </button>
                      ) : null}
                    </div>
                    {err.skuId ? (
                      <p className="catalog-field-error">
                        <span aria-hidden="true">!</span>
                        <span>{err.skuId}</span>
                      </p>
                    ) : null}
                  </div>

                  <div className="receipt-line-grid">
                    <div className="catalog-field">
                      <label htmlFor={qtyInputId} className="catalog-label">
                        Quantity received <span className="form-required" aria-hidden="true">*</span>
                      </label>
                      <input
                        id={qtyInputId}
                        type="text"
                        inputMode="numeric"
                        className="catalog-input"
                        value={line.quantityRaw}
                        onChange={(event) => {
                          const val = event.target.value;
                          updateLineField(line.localId, { quantityRaw: val });
                          if (err.quantity && parsePositiveInteger(val) !== null) {
                            setLineErrors((prev) => ({
                              ...prev,
                              [line.localId]: { ...prev[line.localId], quantity: undefined },
                            }));
                          }
                        }}
                        required
                        aria-invalid={err.quantity ? 'true' : 'false'}
                      />
                      {err.quantity ? (
                        <p className="catalog-field-error">
                          <span aria-hidden="true">!</span>
                          <span>{err.quantity}</span>
                        </p>
                      ) : null}
                    </div>

                    <div className="catalog-field">
                      <label htmlFor={costInputId} className="catalog-label">
                        Unit cost (INR) <span className="form-required" aria-hidden="true">*</span>
                      </label>
                      <input
                        id={costInputId}
                        type="text"
                        inputMode="decimal"
                        className="catalog-input"
                        value={line.unitCostRaw}
                        placeholder="e.g. 450.00"
                        onChange={(event) => {
                          const val = event.target.value;
                          updateLineField(line.localId, { unitCostRaw: val });
                          if (err.unitCost && normalizeInrPriceInput(val).ok) {
                            setLineErrors((prev) => ({
                              ...prev,
                              [line.localId]: { ...prev[line.localId], unitCost: undefined },
                            }));
                          }
                        }}
                        required
                        aria-invalid={err.unitCost ? 'true' : 'false'}
                      />
                      {err.unitCost ? (
                        <p className="catalog-field-error">
                          <span aria-hidden="true">!</span>
                          <span>{err.unitCost}</span>
                        </p>
                      ) : null}
                    </div>

                    <div className="catalog-field">
                      <label htmlFor={mrpInputId} className="catalog-label">
                        Printed MRP (INR, optional)
                      </label>
                      <input
                        id={mrpInputId}
                        type="text"
                        inputMode="decimal"
                        className="catalog-input"
                        value={line.printedMrpRaw}
                        placeholder="Leave blank if unprinted"
                        onChange={(event) => {
                          const val = event.target.value;
                          updateLineField(line.localId, { printedMrpRaw: val });
                          if (
                            err.printedMrp &&
                            (val.trim() === '' || normalizeInrPriceInput(val).ok)
                          ) {
                            setLineErrors((prev) => ({
                              ...prev,
                              [line.localId]: { ...prev[line.localId], printedMrp: undefined },
                            }));
                          }
                        }}
                        aria-invalid={err.printedMrp ? 'true' : 'false'}
                      />
                      {err.printedMrp ? (
                        <p className="catalog-field-error">
                          <span aria-hidden="true">!</span>
                          <span>{err.printedMrp}</span>
                        </p>
                      ) : null}
                    </div>

                    <div className="catalog-field">
                      <span className="catalog-label">Tag generation</span>
                      <label htmlFor={tagToggleId} className="receipt-line-tag-toggle">
                        <input
                          id={tagToggleId}
                          type="checkbox"
                          checked={line.generateInternalTag}
                          onChange={(event) =>
                            updateLineField(line.localId, {
                              generateInternalTag: event.target.checked,
                            })
                          }
                        />
                        <span>Generate Internal Tag</span>
                      </label>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </section>

        <div className="po-form-footer">
          <Link to={currentPo ? `/purchases/${currentPo.poId}` : '/purchases'} className="btn-secondary">
            Cancel
          </Link>
          <button
            type="submit"
            className="btn-primary"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting
              ? 'Posting receipt…'
              : pendingSubmit
                ? 'Retry receipt submission'
                : 'Post stock receipt'}
          </button>
        </div>
      </form>

      <VendorFormModal
        open={!isPoMode && isVendorModalOpen}
        api={purchasing}
        onClose={() => setIsVendorModalOpen(false)}
        onCreated={(created) => {
          invalidatePendingSubmit();
          setSelectedVendorId(created.vendorId);
          setSelectedVendorRecord(created);
          setVendorError(undefined);
          setVendorRefreshTick((prev) => prev + 1);
        }}
      />

      <SkuPickerModal
        open={!isPoMode && pickingLineLocalId !== null}
        api={catalog}
        onClose={() => setPickingLineLocalId(null)}
        onSelect={handleSelectDirectSku}
      />

      <BarcodeLinkModal
        open={unknownBarcodeToLink !== null}
        barcode={unknownBarcodeToLink ?? ''}
        inventoryApi={inventory}
        catalogApi={catalog}
        onClose={() => setUnknownBarcodeToLink(null)}
        onLinked={handleUnknownBarcodeLinked}
        onUseExistingMapping={handleUseConflictingLookup}
      />

      <ModalDialog
        open={pendingPoLineDisambiguation !== null}
        title="Select open purchase order line"
        onClose={() => setPendingPoLineDisambiguation(null)}
      >
        {pendingPoLineDisambiguation ? (
          <>
            <p>
              Barcode <code>{pendingPoLineDisambiguation.barcode}</code> matches{' '}
              <strong>{pendingPoLineDisambiguation.skuName}</strong>, which has multiple open PO
              lines. Select which line to receive:
            </p>
            <ul className="cancel-lines-list">
              {pendingPoLineDisambiguation.matchingPoLines.map((poLine) => (
                <li key={poLine.poLineId} className="cancel-line-item">
                  <div className="po-line-card__top">
                    <span>
                      <code>{poLine.skuCode}</code> (Size: {poLine.size ?? '—'})
                    </span>
                    <button
                      type="button"
                      className="btn-table-action"
                      onClick={() => {
                        addDraftLineForPoLine(
                          poLine,
                          pendingPoLineDisambiguation.defaultSellingPrice,
                          1,
                        );
                        setBarcodeStatusNotice(
                          `Added selected PO line (${poLine.skuCode}, open ${poLine.openQuantity}) from barcode ${pendingPoLineDisambiguation.barcode}.`,
                        );
                        setPendingPoLineDisambiguation(null);
                      }}
                    >
                      Select PO line
                    </button>
                  </div>
                  <p className="cancel-line-item__counts">
                    Ordered: {poLine.orderedQuantity} · Received: {poLine.receivedQuantity} ·
                    Open: {poLine.openQuantity} · Agreed cost:{' '}
                    {poLine.agreedUnitCost ? formatInrDisplay(poLine.agreedUnitCost) : '—'}
                  </p>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </ModalDialog>
    </div>
  );
}
