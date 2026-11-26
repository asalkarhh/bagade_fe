import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAbortError, isApiClientError } from '../api/errors.ts';
import { catalogApi, type CatalogApi } from '../catalog/catalogApi.ts';
import { buildCategoryOptions } from '../catalog/categoryUtils.ts';
import type { Category, SkuListItem } from '../catalog/types.ts';
import { purchasingApi, type PurchasingApi } from '../purchasing/purchasingApi.ts';
import type { PurchaseOrderPrefillState, Vendor } from '../purchasing/types.ts';
import { ReportErrorBanner } from '../reports/components/ReportErrorBanner.tsx';
import { ReportPagination } from '../reports/components/ReportPagination.tsx';
import { validateOptionalPriceRange } from '../reports/reportUtils.ts';
import { formatInrDisplay } from '../utils/inrPrice.ts';
import { PurchaseTargetModal } from './components/PurchaseTargetModal.tsx';
import { planningApi, type PlanningApi } from './planningApi.ts';
import type {
  PastVendorRef,
  PurchasePlanningItem,
  PurchasePlanningResponse,
  PurchaseTargetResult,
} from './types.ts';
import '../catalog/ProductsPage.css';
import './Planning.css';

export interface PurchasePlanningPageProps {
  api?: PlanningApi;
  catalog?: CatalogApi;
  purchasing?: PurchasingApi;
}

const DEFAULT_PAGE_SIZE = 25;
const POSITIVE_INT_PATTERN = /^[1-9]\d*$/;

interface BuyingListEntry {
  sku: SkuListItem;
  pastVendors: PastVendorRef[];
  quantityRaw: string;
}

interface PlanningQueryState {
  key: string;
  data: PurchasePlanningResponse | null;
  error: { message: string; requestId?: string | null } | null;
}

function toSkuListItem(item: PurchasePlanningItem): SkuListItem {
  return {
    skuId: item.skuId,
    productId: null,
    productName: item.productName,
    size: item.size,
    skuCode: item.skuCode,
    defaultSellingPrice: item.currentSellingPrice,
    sellableQuantity: item.sellableQuantity,
    active: true,
    version: 0,
  };
}

export function PurchasePlanningPage({
  api = planningApi,
  catalog = catalogApi,
  purchasing = purchasingApi,
}: PurchasePlanningPageProps) {
  const navigate = useNavigate();

  const categorySelectId = useId();
  const sizeInputId = useId();
  const minPriceId = useId();
  const maxPriceId = useId();
  const vendorSelectId = useId();
  const periodInputId = useId();
  const pageSizeId = useId();
  const poVendorSelectId = useId();

  const [categoryInput, setCategoryInput] = useState('');
  const [sizeInput, setSizeInput] = useState('');
  const [minPriceInput, setMinPriceInput] = useState('');
  const [maxPriceInput, setMaxPriceInput] = useState('');
  const [vendorInput, setVendorInput] = useState('');
  const [periodInput, setPeriodInput] = useState('');

  const [appliedFilters, setAppliedFilters] = useState({
    categoryId: '',
    size: '',
    minPrice: '',
    maxPrice: '',
    vendorId: '',
    planningPeriod: '',
  });
  const [validationError, setValidationError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [refreshTick, setRefreshTick] = useState(0);

  const [categories, setCategories] = useState<Category[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [queryState, setQueryState] = useState<PlanningQueryState | null>(null);

  const [targetModalItem, setTargetModalItem] = useState<PurchasePlanningItem | null>(null);
  const [targetFeedback, setTargetFeedback] = useState<string | null>(null);

  const [buyingList, setBuyingList] = useState<Record<string, BuyingListEntry>>({});
  const [selectedPoVendorId, setSelectedPoVendorId] = useState('');
  const [buyingError, setBuyingError] = useState<string | null>(null);

  const requestSeqRef = useRef(0);

  useEffect(() => {
    document.title = 'What to Buy | Bagade Clothing';
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      catalog.listAllCategories(controller.signal).catch(() => [] as Category[]),
      purchasing.listAllVendors(controller.signal).catch(() => [] as Vendor[]),
    ]).then(([cats, vnds]) => {
      if (!controller.signal.aborted) {
        setCategories(cats);
        setVendors(vnds);
      }
    });
    return () => controller.abort();
  }, [catalog, purchasing]);

  const categoryOptions = useMemo(() => buildCategoryOptions(categories), [categories]);
  const activeVendors = useMemo(() => vendors.filter((v) => v.active), [vendors]);

  const activeKey = useMemo(
    () => JSON.stringify({ ...appliedFilters, page, pageSize, refreshTick }),
    [appliedFilters, page, pageSize, refreshTick],
  );

  useEffect(() => {
    const controller = new AbortController();
    const seq = ++requestSeqRef.current;

    api
      .getPurchasePlanning(
        {
          categoryId: appliedFilters.categoryId || null,
          size: appliedFilters.size || undefined,
          minPrice: appliedFilters.minPrice || undefined,
          maxPrice: appliedFilters.maxPrice || undefined,
          vendorId: appliedFilters.vendorId || null,
          planningPeriod: appliedFilters.planningPeriod || undefined,
          page,
          pageSize,
        },
        controller.signal,
      )
      .then((data) => {
        if (controller.signal.aborted || seq !== requestSeqRef.current) {
          return;
        }
        setQueryState({ key: activeKey, data, error: null });
      })
      .catch((err) => {
        if (controller.signal.aborted || isAbortError(err) || seq !== requestSeqRef.current) {
          return;
        }
        setQueryState({
          key: activeKey,
          data: null,
          error: isApiClientError(err)
            ? { message: err.message, requestId: err.requestId }
            : { message: 'Unable to load purchase planning recommendations right now.' },
        });
      });

    return () => controller.abort();
  }, [activeKey, api, appliedFilters, page, pageSize]);

  const handleApply = (event: FormEvent) => {
    event.preventDefault();
    const priceCheck = validateOptionalPriceRange(minPriceInput, maxPriceInput);
    if (!priceCheck.ok) {
      setValidationError(priceCheck.error);
      return;
    }

    setValidationError(null);
    setAppliedFilters({
      categoryId: categoryInput,
      size: sizeInput.trim(),
      minPrice: priceCheck.minPrice ?? '',
      maxPrice: priceCheck.maxPrice ?? '',
      vendorId: vendorInput,
      planningPeriod: periodInput.trim(),
    });
    setPage(0);
  };

  const handleReset = () => {
    setCategoryInput('');
    setSizeInput('');
    setMinPriceInput('');
    setMaxPriceInput('');
    setVendorInput('');
    setPeriodInput('');
    setValidationError(null);
    setAppliedFilters({
      categoryId: '',
      size: '',
      minPrice: '',
      maxPrice: '',
      vendorId: '',
      planningPeriod: '',
    });
    setPage(0);
  };

  const toggleSelectForBuying = (item: PurchasePlanningItem) => {
    setBuyingError(null);
    setBuyingList((prev) => {
      if (prev[item.skuId]) {
        const next = { ...prev };
        delete next[item.skuId];
        return next;
      }
      const defaultQty =
        item.suggestedQuantity !== null && item.suggestedQuantity > 0
          ? item.suggestedQuantity
          : 1;
      return {
        ...prev,
        [item.skuId]: {
          sku: toSkuListItem(item),
          pastVendors: item.pastVendors,
          quantityRaw: String(defaultQty),
        },
      };
    });
  };

  const updateBuyingQuantity = (skuId: string, raw: string) => {
    setBuyingError(null);
    setBuyingList((prev) => {
      const existing = prev[skuId];
      if (!existing) {
        return prev;
      }
      return {
        ...prev,
        [skuId]: {
          ...existing,
          quantityRaw: raw,
        },
      };
    });
  };

  const removeFromBuyingList = (skuId: string) => {
    setBuyingError(null);
    setBuyingList((prev) => {
      const next = { ...prev };
      delete next[skuId];
      return next;
    });
  };

  const handleTargetSaved = (saved: PurchaseTargetResult, item: PurchasePlanningItem) => {
    setTargetModalItem(null);
    setTargetFeedback(
      `Saved ${saved.planningPeriod ? `period "${saved.planningPeriod}"` : 'default'} target (${saved.targetQuantity} pcs) for ${item.productName}${item.size ? ` (${item.size})` : ''}.`,
    );
    setRefreshTick((t) => t + 1);
  };

  const selectedEntries = useMemo(() => Object.values(buyingList), [buyingList]);

  const handlePreparePurchaseOrder = () => {
    if (selectedEntries.length === 0) {
      setBuyingError('Select at least one SKU to prepare a purchase order.');
      return;
    }

    const preparedLines: PurchaseOrderPrefillState['lines'] = [];
    for (const entry of selectedEntries) {
      const trimmed = entry.quantityRaw.trim();
      if (!POSITIVE_INT_PATTERN.test(trimmed)) {
        setBuyingError(
          `Enter a positive whole quantity (1 or greater) for ${entry.sku.productName}${entry.sku.size ? ` (${entry.sku.size})` : ''}.`,
        );
        return;
      }
      const parsed = Number(trimmed);
      if (!Number.isSafeInteger(parsed) || parsed < 1) {
        setBuyingError(`Invalid buying quantity for ${entry.sku.skuCode}.`);
        return;
      }
      preparedLines.push({
        sku: entry.sku,
        orderedQuantity: parsed,
      });
    }

    const chosenVendor =
      selectedPoVendorId
        ? (activeVendors.find((v) => v.vendorId === selectedPoVendorId) ?? null)
        : null;

    const prefillState: PurchaseOrderPrefillState = {
      vendorId: chosenVendor?.vendorId ?? null,
      vendorRecord: chosenVendor,
      lines: preparedLines,
    };

    navigate('/purchases/new', {
      state: {
        prefillPurchaseOrder: prefillState,
      },
    });
  };

  const isLoading = queryState === null || queryState.key !== activeKey;
  const planning = queryState?.key === activeKey ? queryState.data : null;
  const error = queryState?.key === activeKey ? queryState.error : null;

  return (
    <div className="planning-shell">
      <div className="products-header">
        <div className="products-header__title-group">
          <h1 id="main-content" tabIndex={-1}>
            What to Buy
          </h1>
          <p className="products-header__subtitle">
            Compare current stock, open purchase orders, and recent sales against minimum targets,
            then select items to prepare a draft purchase order.
          </p>
        </div>
      </div>

      <section className="surface-card catalog-filters-card" aria-label="Purchase planning filters">
        <form className="catalog-filters-form" onSubmit={handleApply} noValidate>
          <div className="catalog-filter-field catalog-filter-field--category">
            <label htmlFor={categorySelectId} className="catalog-label">
              Category
            </label>
            <select
              id={categorySelectId}
              className="catalog-select"
              value={categoryInput}
              onChange={(event) => setCategoryInput(event.target.value)}
            >
              <option value="">All categories</option>
              {categoryOptions.map((opt) => (
                <option key={opt.categoryId} value={opt.categoryId}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="catalog-filter-field catalog-filter-field--size">
            <label htmlFor={sizeInputId} className="catalog-label">
              Size
            </label>
            <input
              id={sizeInputId}
              type="search"
              className="catalog-input"
              value={sizeInput}
              placeholder="e.g. M, 32"
              onChange={(event) => setSizeInput(event.target.value)}
            />
          </div>

          <div className="catalog-filter-field">
            <label htmlFor={minPriceId} className="catalog-label">
              Min Selling Price
            </label>
            <input
              id={minPriceId}
              type="text"
              inputMode="decimal"
              className="catalog-input"
              value={minPriceInput}
              placeholder="Any"
              onChange={(event) => {
                setMinPriceInput(event.target.value);
                setValidationError(null);
              }}
            />
          </div>

          <div className="catalog-filter-field">
            <label htmlFor={maxPriceId} className="catalog-label">
              Max Selling Price
            </label>
            <input
              id={maxPriceId}
              type="text"
              inputMode="decimal"
              className="catalog-input"
              value={maxPriceInput}
              placeholder="Any"
              onChange={(event) => {
                setMaxPriceInput(event.target.value);
                setValidationError(null);
              }}
            />
          </div>

          <div className="catalog-filter-field catalog-filter-field--category">
            <label htmlFor={vendorSelectId} className="catalog-label">
              Supplied By Vendor
            </label>
            <select
              id={vendorSelectId}
              className="catalog-select"
              value={vendorInput}
              onChange={(event) => setVendorInput(event.target.value)}
            >
              <option value="">All vendors</option>
              {vendors.map((v) => (
                <option key={v.vendorId} value={v.vendorId}>
                  {v.name}
                  {v.active ? '' : ' (Inactive)'}
                </option>
              ))}
            </select>
          </div>

          <div className="catalog-filter-field">
            <label htmlFor={periodInputId} className="catalog-label">
              Planning Period
            </label>
            <input
              id={periodInputId}
              type="text"
              className="catalog-input"
              value={periodInput}
              placeholder="Default target"
              onChange={(event) => setPeriodInput(event.target.value)}
            />
          </div>

          <div className="catalog-filter-actions">
            <button type="submit" className="btn-primary">
              Apply Filters
            </button>
            <button type="button" className="btn-secondary" onClick={handleReset}>
              Reset Filters
            </button>
          </div>
        </form>

        {validationError ? (
          <p className="catalog-field-error" role="alert">
            {validationError}
          </p>
        ) : null}
      </section>

      {targetFeedback ? (
        <div className="alert-banner alert-banner--info" role="status">
          <div className="alert-banner__content">
            <p>{targetFeedback}</p>
          </div>
        </div>
      ) : null}

      {selectedEntries.length > 0 ? (
        <section className="planning-buying-bar" aria-label="Current buying list">
          <div className="planning-buying-bar__header">
            <div>
              <h2>Current Buying List ({selectedEntries.length} selected)</h2>
              <p className="catalog-field-hint">
                Selecting items does not submit a Purchase Order. Review quantities and continue to
                the Purchase Order form to confirm one vendor and enter unit costs.
              </p>
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setBuyingList({});
                setBuyingError(null);
              }}
            >
              Clear Buying List
            </button>
          </div>

          <div className="planning-buying-items">
            {selectedEntries.map((entry) => (
              <div key={entry.sku.skuId} className="planning-buying-row">
                <div>
                  <strong>
                    {entry.sku.productName}
                    {entry.sku.size ? ` (Size ${entry.sku.size})` : ''}
                  </strong>{' '}
                  <code>{entry.sku.skuCode}</code>
                </div>
                <div className="planning-buying-row__controls">
                  <label className="catalog-label" htmlFor={`buy-qty-${entry.sku.skuId}`}>
                    Order Qty
                  </label>
                  <input
                    id={`buy-qty-${entry.sku.skuId}`}
                    type="text"
                    inputMode="numeric"
                    className="planning-buy-input"
                    value={entry.quantityRaw}
                    onChange={(event) =>
                      updateBuyingQuantity(entry.sku.skuId, event.target.value)
                    }
                  />
                  <button
                    type="button"
                    className="btn-table-action"
                    onClick={() => removeFromBuyingList(entry.sku.skuId)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          {buyingError ? (
            <p className="catalog-field-error" role="alert">
              {buyingError}
            </p>
          ) : null}

          <div className="catalog-filters-form">
            <div className="catalog-filter-field catalog-filter-field--category">
              <label htmlFor={poVendorSelectId} className="catalog-label">
                Vendor for Draft Purchase Order (optional before review)
              </label>
              <select
                id={poVendorSelectId}
                className="catalog-select"
                value={selectedPoVendorId}
                onChange={(event) => setSelectedPoVendorId(event.target.value)}
              >
                <option value="">Choose on Purchase Order form</option>
                {activeVendors.map((v) => (
                  <option key={v.vendorId} value={v.vendorId}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className="btn-primary"
              onClick={handlePreparePurchaseOrder}
            >
              Prepare Purchase Order
            </button>
          </div>
        </section>
      ) : null}

      {error ? (
        <ReportErrorBanner
          message={error.message}
          requestId={error.requestId}
          onRetry={() => setRefreshTick((t) => t + 1)}
        />
      ) : null}

      {isLoading && !planning ? (
        <section className="surface-card" aria-busy="true">
          <p>Loading purchase planning recommendations…</p>
        </section>
      ) : null}

      {planning ? (
        <section className="surface-card catalog-results-card" aria-label="SKU replenishment list">
          <div className="catalog-results-bar">
            <div>
              <h2 className="catalog-results-count">
                {planning.total} active SKU{planning.total === 1 ? '' : 's'} · Recent sales period:{' '}
                <strong>{planning.recentSalesFrom}</strong> to{' '}
                <strong>{planning.recentSalesTo}</strong>
              </h2>
              <p className="catalog-field-hint">
                {planning.planningPeriod
                  ? `Resolved targets for planning period "${planning.planningPeriod}" (falls back to default target where no period target is set).`
                  : 'Showing default minimum stock targets.'}
              </p>
            </div>

            <div className="catalog-filter-actions">
              {isLoading ? <span className="catalog-refreshing">Refreshing…</span> : null}
              <label htmlFor={pageSizeId} className="visually-hidden">
                Rows per page
              </label>
              <select
                id={pageSizeId}
                className="catalog-select"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(0);
                }}
              >
                <option value={10}>10 per page</option>
                <option value={25}>25 per page</option>
                <option value={50}>50 per page</option>
              </select>
            </div>
          </div>

          {planning.items.length === 0 ? (
            <div className="catalog-empty-state">
              <p>No active SKUs matched the selected category, size, price range, or vendor.</p>
              <button type="button" className="btn-secondary" onClick={handleReset}>
                Reset Filters
              </button>
            </div>
          ) : (
            <>
              <div className="planning-list-container">
                {planning.items.map((item) => {
                  const selectedEntry = buyingList[item.skuId];
                  const isSelected = Boolean(selectedEntry);
                  const suggestedZero = item.suggestedQuantity === 0;
                  const suggestedPositive =
                    item.suggestedQuantity !== null && item.suggestedQuantity > 0;

                  return (
                    <article
                      key={item.skuId}
                      className={`planning-item-card${
                        isSelected ? ' planning-item-card--selected' : ''
                      }`}
                    >
                      <div className="planning-item-card__top">
                        <div className="planning-item-card__identity">
                          <input
                            type="checkbox"
                            className="planning-item-select-checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectForBuying(item)}
                            aria-label={`Select ${item.productName}${item.size ? ` size ${item.size}` : ''} (${item.skuCode}) for buying list`}
                          />
                          <div className="planning-item-title-block">
                            <span className="planning-item-title">
                              {item.productName}
                              {item.size ? ` — Size ${item.size}` : ''}
                            </span>
                            <div className="planning-item-meta">
                              <span>
                                SKU: <code>{item.skuCode}</code>
                              </span>
                              <span>Price: {formatInrDisplay(item.currentSellingPrice)}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="planning-quantities-strip">
                        <div className="planning-qty-box">
                          <span className="planning-qty-box__label">Stock on Hand</span>
                          <span className="planning-qty-box__value">
                            {item.sellableQuantity} pcs
                          </span>
                        </div>

                        <div className="planning-qty-box">
                          <span className="planning-qty-box__label">Already Ordered (Open PO)</span>
                          <span className="planning-qty-box__value">{item.openPoQuantity} pcs</span>
                        </div>

                        <div
                          className={`planning-qty-box${
                            suggestedPositive
                              ? ' planning-qty-box--suggested'
                              : suggestedZero
                                ? ' planning-qty-box--zero'
                                : ''
                          }`}
                        >
                          <span className="planning-qty-box__label">Suggested Buy</span>
                          <span className="planning-qty-box__value">
                            {item.suggestedQuantity === null
                              ? 'No target set'
                              : item.suggestedQuantity === 0
                                ? 'No additional stock needed'
                                : `${item.suggestedQuantity} pcs`}
                          </span>
                        </div>
                      </div>

                      <div className="planning-item-actions">
                        <div className="planning-target-cluster">
                          <span>
                            <strong>Target:</strong>{' '}
                            {item.targetQuantity === null ? (
                              'Unset'
                            ) : (
                              <>
                                <strong>{item.targetQuantity}</strong>{' '}
                                <span className="catalog-field-hint">
                                  ({item.resolvedPlanningPeriod
                                    ? `Period: ${item.resolvedPlanningPeriod}`
                                    : 'Default target'})
                                </span>
                              </>
                            )}
                          </span>

                          <button
                            type="button"
                            className="btn-table-action"
                            onClick={() => setTargetModalItem(item)}
                          >
                            {item.targetQuantity === null ? 'Set Target' : 'Edit Target'}
                          </button>
                        </div>

                        {isSelected ? (
                          <div className="planning-buying-row__controls">
                            <label
                              className="catalog-label"
                              htmlFor={`card-buy-qty-${item.skuId}`}
                            >
                              Buying Qty
                            </label>
                            <input
                              id={`card-buy-qty-${item.skuId}`}
                              type="text"
                              inputMode="numeric"
                              className="planning-buy-input"
                              aria-label={`Buying quantity for ${item.productName}${item.size ? ` size ${item.size}` : ''} (${item.skuCode})`}
                              value={selectedEntry.quantityRaw}
                              onChange={(event) =>
                                updateBuyingQuantity(item.skuId, event.target.value)
                              }
                            />
                          </div>
                        ) : null}
                      </div>

                      <details className="planning-details">
                        <summary className="planning-details__summary">
                          Sales &amp; Vendor Details ({item.recentSales} sold ·{' '}
                          {item.pastVendors.length} past vendor
                          {item.pastVendors.length === 1 ? '' : 's'})
                        </summary>
                        <div className="planning-details__body">
                          <p>
                            <strong>Recent Sales ({planning.recentSalesFrom} to{' '}
                            {planning.recentSalesTo}):</strong> {item.recentSales} pcs
                          </p>
                          <p>
                            <strong>Last Verified Physical Count:</strong>{' '}
                            {item.lastVerifiedCountDate || 'Not physically counted yet'}
                          </p>
                          <div>
                            <strong>Past Vendors:</strong>{' '}
                            {item.pastVendors.length === 0 ? (
                              <span>No previous receipts or POs recorded.</span>
                            ) : (
                              <div className="planning-vendors-list">
                                {item.pastVendors.map((v) => (
                                  <span key={v.vendorId} className="report-filter-chip">
                                    {v.vendorName}
                                    {v.active ? '' : ' (Inactive)'}
                                    {v.active && isSelected ? (
                                      <button
                                        type="button"
                                        className="catalog-inline-link"
                                        onClick={() => setSelectedPoVendorId(v.vendorId)}
                                      >
                                        Use for PO
                                      </button>
                                    ) : null}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </details>
                    </article>
                  );
                })}
              </div>

              <ReportPagination
                page={page}
                pageSize={pageSize}
                totalItems={planning.total}
                isLoading={isLoading}
                onPageChange={setPage}
              />
            </>
          )}
        </section>
      ) : null}

      {targetModalItem ? (
        <PurchaseTargetModal
          key={targetModalItem.skuId}
          open={Boolean(targetModalItem)}
          item={targetModalItem}
          activePlanningPeriod={appliedFilters.planningPeriod}
          api={api}
          onClose={() => setTargetModalItem(null)}
          onSaved={handleTargetSaved}
        />
      ) : null}
    </div>
  );
}
