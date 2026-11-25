import { Fragment, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { isAbortError, isApiClientError } from '../api/errors.ts';
import { catalogApi, type CatalogApi } from '../catalog/catalogApi.ts';
import { buildCategoryOptions } from '../catalog/categoryUtils.ts';
import type { Category } from '../catalog/types.ts';
import { formatInrDisplay } from '../utils/inrPrice.ts';
import { TagPrintPreviewModal, type TagPrintMode } from './components/TagPrintPreviewModal.tsx';
import { inventoryApi, type InventoryApi } from './inventoryApi.ts';
import { useRecentSessionReceipts } from './sessionReceipts.ts';
import type { InventoryItem } from './types.ts';
import '../catalog/ProductsPage.css';
import './Inventory.css';

export interface InventoryPageProps {
  api?: InventoryApi;
  catalog?: CatalogApi;
}

const DEFAULT_PAGE_SIZE = 25;

interface InventoryQueryState {
  key: string;
  items: InventoryItem[];
  total: number;
  error: { message: string; requestId?: string | null } | null;
}

export function InventoryPage({ api = inventoryApi, catalog = catalogApi }: InventoryPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const skuIdFilter = searchParams.get('skuId')?.trim() || '';

  const searchInputId = useId();
  const categorySelectId = useId();
  const pageSizeId = useId();
  const captionId = useId();

  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [refreshTick, setRefreshTick] = useState(0);

  const [categories, setCategories] = useState<Category[]>([]);
  const [queryState, setQueryState] = useState<InventoryQueryState | null>(null);
  const [expandedSkuIds, setExpandedSkuIds] = useState<Record<string, boolean>>({});
  const [tagModalState, setTagModalState] = useState<{
    batchId: string;
    mode: TagPrintMode;
  } | null>(null);

  const recentSessionReceipts = useRecentSessionReceipts();
  const requestSeqRef = useRef(0);

  useEffect(() => {
    document.title = 'Inventory | Bagade Clothing';
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    catalog
      .listAllCategories(controller.signal)
      .then((loaded) => {
        if (!controller.signal.aborted) {
          setCategories(loaded);
        }
      })
      .catch(() => {
        // Non-blocking: category filter remains optional if categories fail to load.
      });
    return () => {
      controller.abort();
    };
  }, [catalog]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === debouncedQuery) {
      return;
    }
    const timer = window.setTimeout(() => {
      setDebouncedQuery(trimmed);
      setPage(0);
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [searchInput, debouncedQuery]);

  const categoryOptions = useMemo(() => buildCategoryOptions(categories), [categories]);

  const activeQueryKey = useMemo(
    () =>
      JSON.stringify({
        q: debouncedQuery,
        categoryId,
        skuId: skuIdFilter,
        page,
        size: pageSize,
        refreshTick,
      }),
    [debouncedQuery, categoryId, skuIdFilter, page, pageSize, refreshTick],
  );

  useEffect(() => {
    const controller = new AbortController();
    const seq = ++requestSeqRef.current;

    api
      .listInventory(
        {
          skuId: skuIdFilter || undefined,
          categoryId: categoryId || undefined,
          q: debouncedQuery || undefined,
          page,
          size: pageSize,
        },
        controller.signal,
      )
      .then((res) => {
        if (seq !== requestSeqRef.current || controller.signal.aborted) {
          return;
        }
        setQueryState({
          key: activeQueryKey,
          items: res.items,
          total: res.total,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (
          isAbortError(error) ||
          controller.signal.aborted ||
          seq !== requestSeqRef.current
        ) {
          return;
        }
        setQueryState((prev) => ({
          key: activeQueryKey,
          items: prev?.items ?? [],
          total: prev?.total ?? 0,
          error: {
            message: isApiClientError(error)
              ? error.message
              : 'Unable to load inventory.',
            requestId: isApiClientError(error) ? error.requestId : null,
          },
        }));
      });

    return () => {
      controller.abort();
    };
  }, [api, debouncedQuery, categoryId, skuIdFilter, page, pageSize, activeQueryKey]);

  const items = queryState?.items ?? [];
  const totalItems = queryState?.total ?? 0;
  const loadError = queryState?.error ?? null;
  const hasLoadedOnce = queryState !== null && queryState.error === null;
  const isLoading = queryState?.key !== activeQueryKey;

  const hasActiveFilters =
    debouncedQuery.length > 0 ||
    searchInput.trim().length > 0 ||
    categoryId.length > 0 ||
    skuIdFilter.length > 0;

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = searchInput.trim();
    if (trimmed !== debouncedQuery) {
      setDebouncedQuery(trimmed);
      setPage(0);
    } else if (page !== 0) {
      setPage(0);
    } else {
      setRefreshTick((prev) => prev + 1);
    }
  };

  const handleResetFilters = () => {
    setSearchInput('');
    setDebouncedQuery('');
    setCategoryId('');
    if (skuIdFilter) {
      const next = new URLSearchParams(searchParams);
      next.delete('skuId');
      setSearchParams(next);
    }
    setPage(0);
  };

  const toggleExpandSku = (skuId: string) => {
    setExpandedSkuIds((prev) => ({ ...prev, [skuId]: !prev[skuId] }));
  };

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const rangeStart = totalItems === 0 ? 0 : page * pageSize + 1;
  const rangeEnd = Math.min(totalItems, page * pageSize + items.length);

  return (
    <div className="products-page">
      <div className="products-header">
        <div className="products-header__title-group">
          <h1 id="main-content" tabIndex={-1}>
            Inventory
          </h1>
          <p className="products-header__subtitle">
            Review sellable and non-sellable SKU stock balances and inspect batch costs, MRPs, and
            tag barcodes.
          </p>
        </div>

        <div className="products-header__actions">
          <Link to="/purchases/receive" className="btn-primary">
            Direct Receipt
          </Link>
        </div>
      </div>

      {recentSessionReceipts.length > 0 ? (
        <section className="surface-card" aria-label="Recently posted receipts">
          <div className="catalog-added-list">
            <span className="catalog-added-list__title">Recently posted stock receipts</span>
            <ul>
              {recentSessionReceipts.map((rcp) => (
                <li key={rcp.receiptId}>
                  <Link to={`/inventory/receipts/${rcp.receiptId}`} className="po-link">
                    {rcp.receiptNumber}
                  </Link>{' '}
                  — {rcp.vendorName}
                  {rcp.poNumber ? ` (${rcp.poNumber})` : ' (Direct)'} — {rcp.totalUnits} unit
                  {rcp.totalUnits === 1 ? '' : 's'} on {rcp.receivedDate}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <section className="surface-card catalog-filters-card" aria-label="Inventory filters">
        <search>
          <form className="catalog-filters-form" onSubmit={handleSearchSubmit}>
            <div className="catalog-filter-field catalog-filter-field--search">
              <label htmlFor={searchInputId} className="catalog-label">
                Search product, SKU code, or size
              </label>
              <input
                id={searchInputId}
                name="q"
                type="search"
                className="catalog-input"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="e.g. Silk Saree, SAR-SLK-100, M"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="search"
              />
            </div>

            <div className="catalog-filter-field catalog-filter-field--category">
              <label htmlFor={categorySelectId} className="catalog-label">
                Category
              </label>
              <select
                id={categorySelectId}
                name="categoryId"
                className="catalog-select"
                value={categoryId}
                onChange={(event) => {
                  setCategoryId(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">All categories</option>
                {categoryOptions.map((cat) => (
                  <option key={cat.categoryId} value={cat.categoryId}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="catalog-filter-field catalog-filter-field--size">
              <label htmlFor={pageSizeId} className="catalog-label">
                Per page
              </label>
              <select
                id={pageSizeId}
                name="pageSize"
                className="catalog-select"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(0);
                }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </div>

            <div className="catalog-filter-actions">
              <button type="submit" className="btn-secondary">
                Search
              </button>
              {hasActiveFilters ? (
                <button type="button" className="btn-secondary" onClick={handleResetFilters}>
                  Reset
                </button>
              ) : null}
            </div>
          </form>
        </search>

        {skuIdFilter ? (
          <div className="alert-banner alert-banner--info" role="status">
            <div className="alert-banner__content">
              <p>
                Filtered to SKU ID <code>{skuIdFilter}</code>.
              </p>
              <div className="alert-banner__actions">
                <button type="button" className="btn-secondary" onClick={handleResetFilters}>
                  Show all SKUs
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="surface-card catalog-results-card" aria-label="Inventory stock list">
        <div className="catalog-results-bar">
          <span id={captionId} className="catalog-results-count">
            {totalItems === 0
              ? '0 inventory SKUs'
              : `Showing ${rangeStart}–${rangeEnd} of ${totalItems} SKUs`}
          </span>
          {isLoading ? (
            <span className="catalog-refreshing" aria-live="polite">
              Loading inventory…
            </span>
          ) : null}
        </div>

        {loadError ? (
          <div className="catalog-empty-state">
            <div className="alert-banner alert-banner--error" role="alert">
              <div className="alert-banner__content">
                <p>{loadError.message}</p>
                {loadError.requestId ? (
                  <p className="alert-banner__meta">Request ID: {loadError.requestId}</p>
                ) : null}
                <div className="alert-banner__actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setRefreshTick((prev) => prev + 1)}
                  >
                    Retry
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : !hasLoadedOnce && isLoading ? (
          <div className="catalog-empty-state" aria-busy="true">
            <p>Loading inventory balances…</p>
            <progress className="state-progress" aria-label="Loading inventory balances" />
          </div>
        ) : items.length === 0 ? (
          <div className="catalog-empty-state">
            {hasActiveFilters ? (
              <>
                <p>No inventory SKUs match the current filters.</p>
                <button type="button" className="btn-secondary" onClick={handleResetFilters}>
                  Reset filters
                </button>
              </>
            ) : (
              <>
                <p>No SKUs in catalog yet. Receive stock or add products first.</p>
                <Link to="/purchases/receive" className="btn-primary">
                  Record direct stock receipt
                </Link>
              </>
            )}
          </div>
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-labelledby={captionId}
            className="catalog-table-wrapper"
          >
            <table className="catalog-table">
              <caption className="visually-hidden">
                Inventory balances showing sellable and non-sellable quantities and expandable batch
                records
              </caption>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">SKU code</th>
                  <th scope="col">Size</th>
                  <th scope="col" className="cell-num">
                    Selling price
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col" className="cell-num">
                    Sellable
                  </th>
                  <th scope="col" className="cell-num">
                    Non-sellable
                  </th>
                  <th scope="col">Batches</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const isExpanded = Boolean(expandedSkuIds[item.skuId]);
                  const batchPanelId = `inv-batches-${item.skuId}`;

                  return (
                    <Fragment key={item.skuId}>
                      <tr>
                        <th scope="row">{item.productName}</th>
                        <td data-label="SKU code" className="cell-code">
                          <code>{item.skuCode}</code>
                        </td>
                        <td data-label="Size">{item.size ?? '—'}</td>
                        <td data-label="Selling price" className="cell-num">
                          {formatInrDisplay(item.defaultSellingPrice)}
                        </td>
                        <td data-label="Status">
                          <span
                            className={
                              item.active
                                ? 'sku-status-pill sku-status-pill--active'
                                : 'sku-status-pill sku-status-pill--inactive'
                            }
                          >
                            <span aria-hidden="true">{item.active ? '●' : '○'}</span>
                            <span>{item.active ? 'Active' : 'Inactive'}</span>
                          </span>
                        </td>
                        <td data-label="Sellable" className="cell-num">
                          {item.sellableQuantity}
                        </td>
                        <td data-label="Non-sellable" className="cell-num">
                          {item.nonSellableQuantity}
                        </td>
                        <td data-label="Batches" className="cell-actions">
                          <button
                            type="button"
                            className="btn-table-action"
                            aria-expanded={isExpanded}
                            aria-controls={batchPanelId}
                            onClick={() => toggleExpandSku(item.skuId)}
                          >
                            {isExpanded
                              ? `Hide batches (${item.batches.length})`
                              : `View batches (${item.batches.length})`}
                          </button>
                        </td>
                      </tr>

                      {isExpanded ? (
                        <tr id={batchPanelId} className="inventory-batch-detail-row">
                          <td colSpan={8} className="inventory-batches-cell">
                            <div className="inventory-batches-inner">
                              {item.batches.length === 0 ? (
                                <p className="products-header__subtitle">
                                  No stock batches received yet for {item.productName} (
                                  {item.skuCode}).
                                </p>
                              ) : (
                                <table className="inventory-batches-table">
                                  <caption className="visually-hidden">
                                    Stock batches for {item.productName} ({item.skuCode})
                                  </caption>
                                  <thead>
                                    <tr>
                                      <th scope="col">Received date</th>
                                      <th scope="col" className="cell-num">
                                        Unit cost
                                      </th>
                                      <th scope="col" className="cell-num">
                                        Printed MRP
                                      </th>
                                      <th scope="col" className="cell-num">
                                        Sellable
                                      </th>
                                      <th scope="col" className="cell-num">
                                        Non-sellable
                                      </th>
                                      <th scope="col">Internal barcode</th>
                                      <th scope="col">Tag</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {item.batches.map((batch) => (
                                      <tr key={batch.batchId}>
                                        <th scope="row">{batch.receivedDate}</th>
                                        <td data-label="Unit cost" className="cell-num">
                                          {formatInrDisplay(batch.unitCost)}
                                        </td>
                                        <td data-label="Printed MRP" className="cell-num">
                                          {batch.printedMrp !== null
                                            ? formatInrDisplay(batch.printedMrp)
                                            : '—'}
                                        </td>
                                        <td data-label="Sellable" className="cell-num">
                                          {batch.sellableQuantity}
                                        </td>
                                        <td data-label="Non-sellable" className="cell-num">
                                          {batch.nonSellableQuantity}
                                        </td>
                                        <td data-label="Internal barcode" className="cell-code">
                                          {batch.internalBarcode ? (
                                            <code>{batch.internalBarcode}</code>
                                          ) : (
                                            '—'
                                          )}
                                        </td>
                                        <td data-label="Tag">
                                          <button
                                            type="button"
                                            className="btn-table-action"
                                            onClick={() =>
                                              setTagModalState({
                                                batchId: batch.batchId,
                                                mode: batch.internalBarcode
                                                  ? 'reprint'
                                                  : 'generate',
                                              })
                                            }
                                          >
                                            {batch.internalBarcode ? 'Reprint Tag' : 'Generate Tag'}
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="catalog-pagination">
          <span>
            Page {totalItems === 0 ? 0 : page + 1} of {totalItems === 0 ? 0 : totalPages}
          </span>
          <div className="catalog-pagination__controls">
            <button
              type="button"
              className="btn-secondary"
              disabled={page <= 0 || isLoading}
              onClick={() => setPage((prev) => Math.max(0, prev - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={(page + 1) * pageSize >= totalItems || isLoading}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>

      <TagPrintPreviewModal
        open={tagModalState !== null}
        batchId={tagModalState?.batchId ?? null}
        mode={tagModalState?.mode ?? 'reprint'}
        defaultCopies={1}
        api={api}
        onClose={() => setTagModalState(null)}
        onLabelLoaded={(batchId, code) => {
          setQueryState((prev) => {
            if (!prev) {
              return prev;
            }
            return {
              ...prev,
              items: prev.items.map((item) => ({
                ...item,
                batches: item.batches.map((b) =>
                  b.batchId === batchId ? { ...b, internalBarcode: code } : b,
                ),
              })),
            };
          });
        }}
      />
    </div>
  );
}
