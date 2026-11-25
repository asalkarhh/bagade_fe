import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isAbortError, isApiClientError } from '../api/errors.ts';
import { catalogApi, type CatalogApi } from '../catalog/catalogApi.ts';
import type { SkuListItem } from '../catalog/types.ts';
import { formatInrDisplay, normalizeInrPriceInput } from '../utils/inrPrice.ts';
import { getShopLocalDateIso, isValidIsoDate } from '../utils/shopDate.ts';
import { SkuPickerModal } from './components/SkuPickerModal.tsx';
import { VendorFormModal } from './components/VendorFormModal.tsx';
import { purchasingApi, type PurchasingApi } from './purchasingApi.ts';
import { getPoStatusDisplay } from './statusLabels.ts';
import type { PurchaseOrderListItem, Vendor } from './types.ts';

export interface CreatePurchaseOrderPageProps {
  api?: PurchasingApi;
  catalog?: CatalogApi;
}

interface DraftLine {
  localId: number;
  sku: SkuListItem | null;
  orderedQuantityRaw: string;
  agreedUnitCostRaw: string;
}

interface LineErrors {
  skuId?: string;
  orderedQuantity?: string;
  agreedUnitCost?: string;
}

const VENDOR_PAGE_SIZE = 25;

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

export function CreatePurchaseOrderPage({
  api = purchasingApi,
  catalog = catalogApi,
}: CreatePurchaseOrderPageProps) {
  const navigate = useNavigate();

  const vendorSearchId = useId();
  const vendorSelectId = useId();
  const vendorErrorId = useId();
  const orderDateId = useId();
  const orderDateErrorId = useId();

  // Active vendor picker state (paginated + searchable)
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

  // Selected vendor & PO draft state
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [selectedVendorRecord, setSelectedVendorRecord] = useState<Vendor | null>(null);
  const [orderDate, setOrderDate] = useState(() => getShopLocalDateIso());
  const nextLineIdRef = useRef(2);
  const [lines, setLines] = useState<DraftLine[]>([
    { localId: 1, sku: null, orderedQuantityRaw: '1', agreedUnitCostRaw: '' },
  ]);

  // Modals
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [pickingLineId, setPickingLineId] = useState<number | null>(null);

  // Validation & submission state
  const [vendorError, setVendorError] = useState<string | undefined>(undefined);
  const [orderDateError, setOrderDateError] = useState<string | undefined>(undefined);
  const [linesBannerError, setLinesBannerError] = useState<string | undefined>(undefined);
  const [lineErrors, setLineErrors] = useState<Record<number, LineErrors>>({});
  const [submitError, setSubmitError] = useState<{
    message: string;
    requestId?: string | null;
    isUnknownOutcome?: boolean;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Recovery lookup when POST /purchase-orders drops with unknown outcome
  const [recentPos, setRecentPos] = useState<PurchaseOrderListItem[] | null>(null);
  const [recentPosError, setRecentPosError] = useState<string | null>(null);
  const [isCheckingRecent, setIsCheckingRecent] = useState(false);

  const submittingRef = useRef(false);

  useEffect(() => {
    document.title = 'New Purchase Order | Bagade Clothing';
  }, []);

  useEffect(() => {
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
  }, [vendorSearchInput, debouncedVendorQuery]);

  const vendorQueryKey = useMemo(
    () => JSON.stringify({ q: debouncedVendorQuery, page: vendorPage, vendorRefreshTick }),
    [debouncedVendorQuery, vendorPage, vendorRefreshTick],
  );

  useEffect(() => {
    const controller = new AbortController();
    const seq = ++vendorRequestSeqRef.current;

    api
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
  }, [api, debouncedVendorQuery, vendorPage, vendorQueryKey]);

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
  const isLoadingVendors = vendorListState?.key !== vendorQueryKey;
  const totalVendorPages = Math.max(1, Math.ceil(totalVendors / VENDOR_PAGE_SIZE));

  const handleVendorCreated = (created: Vendor) => {
    // Select new vendor immediately while keeping all existing order lines untouched.
    setSelectedVendorId(created.vendorId);
    setSelectedVendorRecord(created);
    setVendorError(undefined);
    setVendorRefreshTick((prev) => prev + 1);
  };

  const handleAddLine = () => {
    const newId = nextLineIdRef.current++;
    setLines((prev) => [
      ...prev,
      { localId: newId, sku: null, orderedQuantityRaw: '1', agreedUnitCostRaw: '' },
    ]);
    setLinesBannerError(undefined);
  };

  const handleRemoveLine = (localId: number) => {
    setLines((prev) => prev.filter((line) => line.localId !== localId));
    setLineErrors((prev) => {
      const next = { ...prev };
      delete next[localId];
      return next;
    });
  };

  const handleSelectSkuForLine = (sku: SkuListItem) => {
    if (pickingLineId === null) {
      return;
    }
    setLines((prev) =>
      prev.map((line) => (line.localId === pickingLineId ? { ...line, sku } : line)),
    );
    setLineErrors((prev) => {
      const existing = prev[pickingLineId];
      if (!existing?.skuId) {
        return prev;
      }
      return {
        ...prev,
        [pickingLineId]: { ...existing, skuId: undefined },
      };
    });
    setPickingLineId(null);
  };

  const handleCheckRecentPos = async () => {
    if (isCheckingRecent) {
      return;
    }
    setIsCheckingRecent(true);
    setRecentPosError(null);
    try {
      const res = await api.listPurchaseOrders({
        vendorId: selectedVendorId || null,
        page: 0,
        size: 5,
      });
      setRecentPos(res.items);
    } catch (error) {
      setRecentPosError(
        isApiClientError(error)
          ? error.message
          : 'Could not load recent purchase orders.',
      );
    } finally {
      setIsCheckingRecent(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current || isSubmitting) {
      return;
    }

    let hasClientErrors = false;
    let nextVendorError: string | undefined;
    let nextDateError: string | undefined;
    let nextLinesBanner: string | undefined;
    const nextLineErrors: Record<number, LineErrors> = {};

    if (!selectedVendorId) {
      nextVendorError = 'Select an active vendor.';
      hasClientErrors = true;
    }

    if (!isValidIsoDate(orderDate)) {
      nextDateError = 'Enter a valid order date (YYYY-MM-DD).';
      hasClientErrors = true;
    }

    if (lines.length === 0) {
      nextLinesBanner = 'Add at least one SKU line to create a purchase order.';
      hasClientErrors = true;
    }

    const preparedLines: {
      skuId: string;
      orderedQuantity: number;
      agreedUnitCost: string | null;
    }[] = [];

    for (const line of lines) {
      const err: LineErrors = {};
      if (!line.sku) {
        err.skuId = 'Select an active SKU.';
        hasClientErrors = true;
      }

      const qty = parsePositiveInteger(line.orderedQuantityRaw);
      if (qty === null) {
        err.orderedQuantity = 'Enter a whole number greater than 0.';
        hasClientErrors = true;
      }

      // Preserve distinction between blank cost (null) and explicit zero ("0.00").
      let agreedCost: string | null = null;
      if (line.agreedUnitCostRaw.trim().length > 0) {
        const priceCheck = normalizeInrPriceInput(line.agreedUnitCostRaw);
        if (!priceCheck.ok) {
          err.agreedUnitCost = priceCheck.error;
          hasClientErrors = true;
        } else {
          agreedCost = priceCheck.value;
        }
      }

      if (err.skuId || err.orderedQuantity || err.agreedUnitCost) {
        nextLineErrors[line.localId] = err;
      } else if (line.sku && qty !== null) {
        preparedLines.push({
          skuId: line.sku.skuId,
          orderedQuantity: qty,
          agreedUnitCost: agreedCost,
        });
      }
    }

    setVendorError(nextVendorError);
    setOrderDateError(nextDateError);
    setLinesBannerError(nextLinesBanner);
    setLineErrors(nextLineErrors);

    if (hasClientErrors) {
      setSubmitError({
        message: 'Please fix the highlighted purchase order fields before saving.',
      });
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    setRecentPos(null);
    setRecentPosError(null);

    try {
      const created = await api.createPurchaseOrder({
        vendorId: selectedVendorId,
        orderDate: orderDate.trim(),
        lines: preparedLines,
      });
      navigate(`/purchases/${created.poId}`, { replace: true });
    } catch (error) {
      if (isApiClientError(error)) {
        if (error.kind === 'network' || error.kind === 'server') {
          setSubmitError({
            message:
              'Connection dropped or server error occurred — the outcome is unknown. Because purchase order creation cannot guarantee safe automatic replay, check recent purchase orders before submitting again.',
            requestId: error.requestId,
            isUnknownOutcome: true,
          });
        } else {
          const mappedLineErrors: Record<number, LineErrors> = {};
          for (const item of error.fieldErrors) {
            if (item.field === 'vendorId') {
              setVendorError(item.message);
            } else if (item.field === 'orderDate') {
              setOrderDateError(item.message);
            } else if (item.field === 'lines') {
              setLinesBannerError(item.message);
            } else {
              const match = /^lines\[(\d+)\]\.(skuId|orderedQuantity|agreedUnitCost)$/.exec(
                item.field,
              );
              if (match) {
                const idx = Number(match[1]);
                const prop = match[2] as keyof LineErrors;
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
            message: error.message || 'Purchase order could not be saved.',
            requestId: error.requestId,
          });
        }
      } else {
        setSubmitError({
          message:
            'Unexpected error while saving purchase order. Check recent purchase orders before retrying.',
          isUnknownOutcome: true,
        });
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="products-page">
      <div className="products-header">
        <div className="products-header__title-group">
          <p>
            <Link to="/purchases">← Back to Purchase Orders</Link>
          </p>
          <h1 id="main-content" tabIndex={-1}>
            New Purchase Order
          </h1>
          <p className="products-header__subtitle">
            Select an active vendor, set the order date, and add SKU lines with whole-piece
            quantities.
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
            {submitError.isUnknownOutcome ? (
              <>
                <div className="alert-banner__actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={isCheckingRecent}
                    onClick={() => {
                      void handleCheckRecentPos();
                    }}
                  >
                    {isCheckingRecent ? 'Checking recent POs…' : 'Check recent POs'}
                  </button>
                  <Link to="/purchases" className="btn-secondary">
                    Open Purchase Orders list
                  </Link>
                </div>
                {recentPosError ? <p>{recentPosError}</p> : null}
                {recentPos ? (
                  recentPos.length === 0 ? (
                    <p>No recent purchase orders found for the selected vendor.</p>
                  ) : (
                    <ul className="po-recent-list">
                      {recentPos.map((po) => (
                        <li key={po.poId}>
                          <Link to={`/purchases/${po.poId}`} className="po-link">
                            {po.poNumber}
                          </Link>{' '}
                          — {po.orderDate} — {getPoStatusDisplay(po.status).label} (
                          {po.totalOpenQuantity} open)
                        </li>
                      ))}
                    </ul>
                  )
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      <form className="surface-card po-form" onSubmit={handleSubmit} noValidate>
        <div className="po-header-grid">
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
                    disabled={(vendorPage + 1) * VENDOR_PAGE_SIZE >= totalVendors || isLoadingVendors}
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

          <div className="catalog-field">
            <label htmlFor={orderDateId} className="catalog-label">
              Order date <span className="form-required" aria-hidden="true">*</span>
            </label>
            <input
              id={orderDateId}
              name="orderDate"
              type="date"
              className="catalog-input"
              value={orderDate}
              onChange={(event) => {
                setOrderDate(event.target.value);
                if (orderDateError && isValidIsoDate(event.target.value)) {
                  setOrderDateError(undefined);
                }
              }}
              required
              aria-invalid={orderDateError ? 'true' : 'false'}
              aria-describedby={orderDateError ? orderDateErrorId : undefined}
            />
            {orderDateError ? (
              <p id={orderDateErrorId} className="catalog-field-error">
                <span aria-hidden="true">!</span>
                <span>{orderDateError}</span>
              </p>
            ) : null}
          </div>
        </div>

        <section className="po-lines-section" aria-label="Order lines">
          <div className="po-lines-header">
            <h2>Order lines</h2>
            <button type="button" className="btn-secondary" onClick={handleAddLine}>
              + Add line
            </button>
          </div>

          {linesBannerError ? (
            <div className="alert-banner alert-banner--error" role="alert">
              <div className="alert-banner__content">
                <p>{linesBannerError}</p>
              </div>
            </div>
          ) : null}

          {lines.map((line, index) => {
            const err = lineErrors[line.localId] ?? {};
            const qtyInputId = `po-line-qty-${line.localId}`;
            const costInputId = `po-line-cost-${line.localId}`;

            return (
              <div key={line.localId} className="po-line-card">
                <div className="po-line-card__top">
                  <span className="po-line-card__title">Line {index + 1}</span>
                  <button
                    type="button"
                    className="btn-table-action btn-table-action--danger"
                    onClick={() => handleRemoveLine(line.localId)}
                  >
                    Remove line {index + 1}
                  </button>
                </div>

                <div className="po-line-card__grid">
                  <div className="catalog-field">
                    <span className="catalog-label">
                      SKU <span className="form-required" aria-hidden="true">*</span>
                    </span>
                    <div className={err.skuId ? 'po-sku-box po-sku-box--invalid' : 'po-sku-box'}>
                      <div className="po-sku-box__info">
                        {line.sku ? (
                          <>
                            <span className="po-sku-box__name">{line.sku.productName}</span>
                            <span className="po-sku-box__meta">
                              <code>{line.sku.skuCode}</code> · Size: {line.sku.size ?? '—'} ·{' '}
                              {formatInrDisplay(line.sku.defaultSellingPrice)}
                            </span>
                          </>
                        ) : (
                          <span className="po-sku-box__meta">No SKU selected</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn-table-action"
                        onClick={() => setPickingLineId(line.localId)}
                      >
                        {line.sku ? `Change SKU (line ${index + 1})` : `Select SKU (line ${index + 1})`}
                      </button>
                    </div>
                    {err.skuId ? (
                      <p className="catalog-field-error">
                        <span aria-hidden="true">!</span>
                        <span>{err.skuId}</span>
                      </p>
                    ) : null}
                  </div>

                  <div className="catalog-field">
                    <label htmlFor={qtyInputId} className="catalog-label">
                      Ordered quantity <span className="form-required" aria-hidden="true">*</span>
                    </label>
                    <input
                      id={qtyInputId}
                      type="text"
                      inputMode="numeric"
                      className="catalog-input"
                      value={line.orderedQuantityRaw}
                      onChange={(event) => {
                        const val = event.target.value;
                        setLines((prev) =>
                          prev.map((item) =>
                            item.localId === line.localId
                              ? { ...item, orderedQuantityRaw: val }
                              : item,
                          ),
                        );
                        if (err.orderedQuantity && parsePositiveInteger(val) !== null) {
                          setLineErrors((prev) => ({
                            ...prev,
                            [line.localId]: { ...prev[line.localId], orderedQuantity: undefined },
                          }));
                        }
                      }}
                      required
                      aria-invalid={err.orderedQuantity ? 'true' : 'false'}
                    />
                    {err.orderedQuantity ? (
                      <p className="catalog-field-error">
                        <span aria-hidden="true">!</span>
                        <span>{err.orderedQuantity}</span>
                      </p>
                    ) : null}
                  </div>

                  <div className="catalog-field">
                    <label htmlFor={costInputId} className="catalog-label">
                      Agreed unit cost (INR, optional)
                    </label>
                    <input
                      id={costInputId}
                      type="text"
                      inputMode="decimal"
                      className="catalog-input"
                      value={line.agreedUnitCostRaw}
                      placeholder="Leave blank if unset"
                      onChange={(event) => {
                        const val = event.target.value;
                        setLines((prev) =>
                          prev.map((item) =>
                            item.localId === line.localId
                              ? { ...item, agreedUnitCostRaw: val }
                              : item,
                          ),
                        );
                        if (err.agreedUnitCost) {
                          const ok = val.trim() === '' || normalizeInrPriceInput(val).ok;
                          if (ok) {
                            setLineErrors((prev) => ({
                              ...prev,
                              [line.localId]: { ...prev[line.localId], agreedUnitCost: undefined },
                            }));
                          }
                        }
                      }}
                      aria-invalid={err.agreedUnitCost ? 'true' : 'false'}
                    />
                    {err.agreedUnitCost ? (
                      <p className="catalog-field-error">
                        <span aria-hidden="true">!</span>
                        <span>{err.agreedUnitCost}</span>
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </section>

        <div className="po-form-footer">
          <Link to="/purchases" className="btn-secondary">
            Cancel
          </Link>
          <button
            type="submit"
            className="btn-primary"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Saving purchase order…' : 'Save purchase order'}
          </button>
        </div>
      </form>

      <VendorFormModal
        open={isVendorModalOpen}
        api={api}
        onClose={() => setIsVendorModalOpen(false)}
        onCreated={handleVendorCreated}
      />

      <SkuPickerModal
        open={pickingLineId !== null}
        api={catalog}
        onClose={() => setPickingLineId(null)}
        onSelect={handleSelectSkuForLine}
      />
    </div>
  );
}
