import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { isAbortError, isApiClientError } from '../api/errors.ts';
import { formatInrDisplay } from '../utils/inrPrice.ts';
import { catalogApi, type CatalogApi } from './catalogApi.ts';
import { buildCategoryOptions } from './categoryUtils.ts';
import { CategoryFormModal } from './components/CategoryFormModal.tsx';
import { EditPriceModal } from './components/EditPriceModal.tsx';
import {
  ProductAndSkuModal,
  type ProductAndSkuModalMode,
} from './components/ProductAndSkuModal.tsx';
import {
  StaleStatusModal,
  type StaleStatusConflict,
} from './components/StaleStatusModal.tsx';
import type {
  ActiveStatusFilter,
  Category,
  CreateSkuResponse,
  ProductResponse,
  SkuDetail,
  SkuListItem,
} from './types.ts';
import './ProductsPage.css';

export interface ProductsPageProps {
  api?: CatalogApi;
}

const DEFAULT_PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 250;

interface SkuQueryResultState {
  key: string;
  items: SkuListItem[];
  total: number;
  error: { message: string; requestId?: string | null } | null;
}

export function ProductsPage({ api = catalogApi }: ProductsPageProps) {
  const searchInputId = useId();
  const categoryFilterId = useId();
  const pageSizeId = useId();
  const tableCaptionId = useId();
  const addSizeNoteId = useId();

  // Filter & pagination state
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [statusFilter, setStatusFilter] = useState<ActiveStatusFilter>('ACTIVE');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [refreshRevision, setRefreshRevision] = useState(0);

  // Categories state
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categoryRefreshRevision, setCategoryRefreshRevision] = useState(0);
  const [lastCreatedCategoryId, setLastCreatedCategoryId] = useState<string | undefined>(
    undefined,
  );

  // SKU query results keyed to query parameters so loading state derives cleanly without effect setState
  const [queryResult, setQueryResult] = useState<SkuQueryResultState | null>(null);

  // In-memory map of skuId -> productId observed from authoritative API responses
  const [productIdsBySkuId, setProductIdsBySkuId] = useState<Record<string, string>>({});

  // Action & modal state
  const [statusAnnouncement, setStatusAnnouncement] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{
    message: string;
    requestId?: string | null;
  } | null>(null);
  const [pendingStatusSkuId, setPendingStatusSkuId] = useState<string | null>(null);

  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [productModalMode, setProductModalMode] = useState<ProductAndSkuModalMode | null>(null);
  const [editingPriceSku, setEditingPriceSku] = useState<SkuListItem | null>(null);
  const [staleStatusConflict, setStaleStatusConflict] = useState<StaleStatusConflict | null>(null);

  const listRequestSeqRef = useRef(0);
  const statusPendingRef = useRef<string | null>(null);

  useEffect(() => {
    document.title = 'Products | Bagade Clothing';
  }, []);

  // Debounce search typing while letting explicit form submit execute immediately.
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === debouncedQuery) {
      return;
    }
    const timer = window.setTimeout(() => {
      setDebouncedQuery(trimmed);
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [searchInput, debouncedQuery]);

  // Load paginated categories across all pages
  useEffect(() => {
    const controller = new AbortController();
    api
      .listAllCategories(controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) {
          return;
        }
        setCategories(loaded);
        setCategoryError(null);
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || controller.signal.aborted) {
          return;
        }
        setCategoryError(
          isApiClientError(error) ? error.message : 'Unable to load category options.',
        );
      });
    return () => {
      controller.abort();
    };
  }, [api, categoryRefreshRevision]);

  const activeQueryKey = useMemo(
    () =>
      JSON.stringify({
        q: debouncedQuery,
        categoryId: selectedCategoryId,
        status: statusFilter,
        page,
        size: pageSize,
        refreshRevision,
      }),
    [debouncedQuery, selectedCategoryId, statusFilter, page, pageSize, refreshRevision],
  );

  // Load SKUs with abort + monotonic sequence guard so slower responses cannot overwrite newer results
  useEffect(() => {
    const controller = new AbortController();
    const requestSeq = ++listRequestSeqRef.current;

    api
      .listSkus(
        {
          q: debouncedQuery || undefined,
          categoryId: selectedCategoryId || null,
          status: statusFilter,
          page,
          size: pageSize,
        },
        controller.signal,
      )
      .then((result) => {
        if (requestSeq !== listRequestSeqRef.current || controller.signal.aborted) {
          return;
        }

        if (result.items.length === 0 && result.total > 0 && page > 0) {
          const lastValidPage = Math.max(0, Math.ceil(result.total / pageSize) - 1);
          if (lastValidPage !== page) {
            setPage(lastValidPage);
            return;
          }
        }

        const discoveredProductIds: Record<string, string> = {};
        for (const item of result.items) {
          if (item.productId) {
            discoveredProductIds[item.skuId] = item.productId;
          }
        }
        if (Object.keys(discoveredProductIds).length > 0) {
          setProductIdsBySkuId((prev) => ({ ...prev, ...discoveredProductIds }));
        }

        setQueryResult({
          key: activeQueryKey,
          items: result.items,
          total: result.total,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (
          isAbortError(error) ||
          controller.signal.aborted ||
          requestSeq !== listRequestSeqRef.current
        ) {
          return;
        }
        setQueryResult((prev) => ({
          key: activeQueryKey,
          items: prev?.items ?? [],
          total: prev?.total ?? 0,
          error: {
            message: isApiClientError(error)
              ? error.message
              : 'Unable to load the product catalog.',
            requestId: isApiClientError(error) ? error.requestId : null,
          },
        }));
      });

    return () => {
      controller.abort();
    };
  }, [api, debouncedQuery, selectedCategoryId, statusFilter, page, pageSize, activeQueryKey]);

  const triggerCatalogRefresh = useCallback(() => {
    setRefreshRevision((prev) => prev + 1);
  }, []);

  const categoryOptions = useMemo(() => buildCategoryOptions(categories), [categories]);

  const skus = queryResult?.items ?? [];
  const totalSkus = queryResult?.total ?? 0;
  const skusError = queryResult?.error ?? null;
  const hasLoadedOnce = queryResult !== null && queryResult.error === null;
  const isLoadingSkus = queryResult?.key !== activeQueryKey;

  const hasActiveFilters =
    debouncedQuery.length > 0 ||
    searchInput.trim().length > 0 ||
    selectedCategoryId.length > 0 ||
    statusFilter !== 'ACTIVE';

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = searchInput.trim();
    if (trimmed !== debouncedQuery) {
      setDebouncedQuery(trimmed);
      setPage(0);
    } else if (page !== 0) {
      setPage(0);
    } else {
      triggerCatalogRefresh();
    }
  };

  const handleResetFilters = () => {
    setSearchInput('');
    setDebouncedQuery('');
    setSelectedCategoryId('');
    setStatusFilter('ACTIVE');
    setPage(0);
  };

  const handleCategoryCreated = (category: Category) => {
    setLastCreatedCategoryId(category.categoryId);
    setStatusAnnouncement(`Category "${category.name}" created.`);
    setCategoryRefreshRevision((prev) => prev + 1);
  };

  const handleProductCreated = (product: ProductResponse) => {
    setLastCreatedCategoryId(product.categoryId);
    setStatusAnnouncement(`Product "${product.name}" created. Add SKU variants next.`);
  };

  const handleSkuCreated = (productId: string, created: CreateSkuResponse) => {
    setProductIdsBySkuId((prev) => ({ ...prev, [created.skuId]: productId }));
    setStatusAnnouncement(
      `SKU ${created.skuCode}${created.size ? ` (size ${created.size})` : ''} added.`,
    );
    triggerCatalogRefresh();
  };

  const handleSkuUpdated = (updated: SkuDetail) => {
    setProductIdsBySkuId((prev) => ({ ...prev, [updated.skuId]: updated.productId }));
    setQueryResult((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((row) =>
              row.skuId === updated.skuId
                ? {
                    skuId: updated.skuId,
                    productId: updated.productId,
                    productName: updated.productName,
                    size: updated.size,
                    skuCode: updated.skuCode,
                    defaultSellingPrice: updated.defaultSellingPrice,
                    sellableQuantity: updated.sellableQuantity,
                    active: updated.active,
                    version: updated.version,
                  }
                : row,
            ),
          }
        : prev,
    );
    setStatusAnnouncement(
      `Updated SKU ${updated.skuCode} (${formatInrDisplay(updated.defaultSellingPrice)}, ${updated.active ? 'Active' : 'Inactive'}).`,
    );
    triggerCatalogRefresh();
  };

  const handleObservedLatest = (latest: SkuListItem) => {
    setQueryResult((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((row) => (row.skuId === latest.skuId ? latest : row)),
          }
        : prev,
    );
  };

  const handleToggleSkuStatus = async (row: SkuListItem) => {
    if (statusPendingRef.current) {
      return;
    }

    const nextActive = !row.active;
    statusPendingRef.current = row.skuId;
    setPendingStatusSkuId(row.skuId);
    setActionError(null);

    try {
      const updated = await api.updateSku(row.skuId, {
        expectedVersion: row.version,
        active: nextActive,
      });
      handleSkuUpdated(updated);
    } catch (error) {
      if (isApiClientError(error) && error.code === 'STALE_VERSION') {
        try {
          const latest = await api.findLatestSkuById(row.skuId, row.skuCode);
          if (latest) {
            handleObservedLatest(latest);
            setStaleStatusConflict({
              latestSku: latest,
              attemptedActive: nextActive,
              requestId: error.requestId,
            });
          } else {
            setActionError({
              message:
                'This SKU was modified elsewhere and could not be reloaded automatically. Refresh the catalog and try again.',
              requestId: error.requestId,
            });
          }
        } catch {
          setActionError({
            message:
              'This SKU was modified elsewhere and refreshing its current state failed. Retry loading the catalog.',
            requestId: error.requestId,
          });
        }
      } else if (isApiClientError(error)) {
        setActionError({
          message: error.message,
          requestId: error.requestId,
        });
      } else {
        setActionError({
          message: 'Could not update SKU status. Please try again.',
        });
      }
    } finally {
      statusPendingRef.current = null;
      setPendingStatusSkuId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalSkus / pageSize));
  const rangeStart = totalSkus === 0 ? 0 : page * pageSize + 1;
  const rangeEnd = Math.min(totalSkus, page * pageSize + skus.length);
  const anyRowMissingProductId = skus.some(
    (row) => !(row.productId ?? productIdsBySkuId[row.skuId]),
  );

  return (
    <div className="products-page">
      <div className="products-header">
        <div className="products-header__title-group">
          <h1 id="main-content" tabIndex={-1}>
            Products
          </h1>
          <p className="products-header__subtitle">
            Manage clothing categories, products, size variants, INR selling prices, and active
            SKU status.
          </p>
        </div>

        <div className="products-header__actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setIsCategoryModalOpen(true)}
          >
            New category
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() =>
              setProductModalMode({
                kind: 'create-product',
                defaultCategoryId: lastCreatedCategoryId || selectedCategoryId || undefined,
              })
            }
          >
            New product
          </button>
        </div>
      </div>

      {statusAnnouncement ? (
        <div className="alert-banner alert-banner--info" role="status">
          <div className="alert-banner__content">
            <p>{statusAnnouncement}</p>
          </div>
        </div>
      ) : null}

      {categoryError ? (
        <div className="alert-banner alert-banner--warning" role="status">
          <div className="alert-banner__content">
            <p>Categories could not be loaded: {categoryError}</p>
            <div className="alert-banner__actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setCategoryRefreshRevision((prev) => prev + 1)}
              >
                Retry categories
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {actionError ? (
        <div className="alert-banner alert-banner--error" role="alert">
          <div className="alert-banner__content">
            <p>{actionError.message}</p>
            {actionError.requestId ? (
              <p className="alert-banner__meta">Request ID: {actionError.requestId}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <section className="surface-card catalog-filters-card" aria-label="Catalog filters">
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
                placeholder="e.g. Kanchipuram, SAR-KAN-001, 34"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="search"
              />
            </div>

            <div className="catalog-filter-field catalog-filter-field--category">
              <label htmlFor={categoryFilterId} className="catalog-label">
                Category
              </label>
              <select
                id={categoryFilterId}
                name="categoryId"
                className="catalog-select"
                value={selectedCategoryId}
                onChange={(event) => {
                  setSelectedCategoryId(event.target.value);
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

            <fieldset className="catalog-status-fieldset">
              <legend>Status</legend>
              <div className="status-radio-group">
                {(['ACTIVE', 'INACTIVE', 'ALL'] as const).map((option) => {
                  const label =
                    option === 'ACTIVE' ? 'Active' : option === 'INACTIVE' ? 'Inactive' : 'All';
                  return (
                    <label key={option} className="status-radio-option">
                      <input
                        type="radio"
                        name="skuStatus"
                        value={option}
                        checked={statusFilter === option}
                        onChange={() => {
                          setStatusFilter(option);
                          setPage(0);
                        }}
                      />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

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
      </section>

      <section className="surface-card catalog-results-card" aria-label="Catalog results">
        <div className="catalog-results-bar">
          <span id={tableCaptionId} className="catalog-results-count">
            {totalSkus === 0
              ? '0 SKUs'
              : `Showing ${rangeStart}–${rangeEnd} of ${totalSkus} SKUs`}
          </span>
          {isLoadingSkus ? (
            <span className="catalog-refreshing" aria-live="polite">
              Loading catalog…
            </span>
          ) : null}
        </div>

        {skusError ? (
          <div className="catalog-empty-state">
            <div className="alert-banner alert-banner--error" role="alert">
              <div className="alert-banner__content">
                <p>{skusError.message}</p>
                {skusError.requestId ? (
                  <p className="alert-banner__meta">Request ID: {skusError.requestId}</p>
                ) : null}
                <div className="alert-banner__actions">
                  <button type="button" className="btn-secondary" onClick={triggerCatalogRefresh}>
                    Retry
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : !hasLoadedOnce && isLoadingSkus ? (
          <div className="catalog-empty-state" aria-busy="true">
            <p>Loading product catalog…</p>
            <progress className="state-progress" aria-label="Loading catalog" />
          </div>
        ) : skus.length === 0 ? (
          <div className="catalog-empty-state">
            {hasActiveFilters ? (
              <>
                <p>No SKUs match the current search, category, or status filters.</p>
                <button type="button" className="btn-secondary" onClick={handleResetFilters}>
                  Reset filters
                </button>
              </>
            ) : (
              <>
                <p>No active SKUs in the catalog yet. Create a category and your first product.</p>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() =>
                    setProductModalMode({
                      kind: 'create-product',
                      defaultCategoryId: lastCreatedCategoryId || undefined,
                    })
                  }
                >
                  Create first product
                </button>
              </>
            )}
          </div>
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-labelledby={tableCaptionId}
            className="catalog-table-wrapper"
          >
            <table className="catalog-table">
              <caption className="visually-hidden">
                Product SKUs with size, default selling price in INR, sellable quantity, and
                active status
              </caption>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">SKU code</th>
                  <th scope="col">Size</th>
                  <th scope="col" className="cell-num">
                    Price
                  </th>
                  <th scope="col" className="cell-num">
                    Sellable qty
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {skus.map((row) => {
                  const effectiveProductId = row.productId ?? productIdsBySkuId[row.skuId] ?? null;
                  const isStatusPending = pendingStatusSkuId === row.skuId;

                  return (
                    <tr key={row.skuId}>
                      <th scope="row">{row.productName}</th>
                      <td data-label="SKU code" className="cell-code">
                        <code>{row.skuCode}</code>
                      </td>
                      <td data-label="Size">{row.size ?? '—'}</td>
                      <td data-label="Price" className="cell-num">
                        {formatInrDisplay(row.defaultSellingPrice)}
                      </td>
                      <td data-label="Sellable qty" className="cell-num">
                        {row.sellableQuantity}
                      </td>
                      <td data-label="Status">
                        <span
                          className={
                            row.active
                              ? 'sku-status-pill sku-status-pill--active'
                              : 'sku-status-pill sku-status-pill--inactive'
                          }
                        >
                          <span aria-hidden="true">{row.active ? '●' : '○'}</span>
                          <span>{row.active ? 'Active' : 'Inactive'}</span>
                        </span>
                      </td>
                      <td data-label="Actions" className="cell-actions">
                        <div className="cell-actions__group">
                          <button
                            type="button"
                            className="btn-table-action"
                            onClick={() => setEditingPriceSku(row)}
                          >
                            Edit price
                          </button>
                          <button
                            type="button"
                            className={
                              row.active
                                ? 'btn-table-action btn-table-action--danger'
                                : 'btn-table-action'
                            }
                            disabled={isStatusPending}
                            aria-busy={isStatusPending}
                            onClick={() => {
                              void handleToggleSkuStatus(row);
                            }}
                          >
                            {isStatusPending
                              ? 'Updating…'
                              : row.active
                                ? 'Deactivate'
                                : 'Activate'}
                          </button>
                          <button
                            type="button"
                            className="btn-table-action"
                            disabled={!effectiveProductId}
                            aria-describedby={!effectiveProductId ? addSizeNoteId : undefined}
                            onClick={() => {
                              if (effectiveProductId) {
                                setProductModalMode({
                                  kind: 'add-sku',
                                  productId: effectiveProductId,
                                  productName: row.productName,
                                });
                              }
                            }}
                          >
                            Add size
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {anyRowMissingProductId && skus.length > 0 ? (
          <p id={addSizeNoteId} className="catalog-api-note">
            Note: &ldquo;Add size&rdquo; requires <code>productId</code> from the backend catalog
            response (available for products created or edited in this session, or when{' '}
            <code>GET /api/v1/skus</code> includes <code>productId</code>).
          </p>
        ) : null}

        <div className="catalog-pagination">
          <span>
            Page {totalSkus === 0 ? 0 : page + 1} of {totalSkus === 0 ? 0 : totalPages}
          </span>
          <div className="catalog-pagination__controls">
            <button
              type="button"
              className="btn-secondary"
              disabled={page <= 0 || isLoadingSkus}
              onClick={() => setPage((prev) => Math.max(0, prev - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={(page + 1) * pageSize >= totalSkus || isLoadingSkus}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>

      <CategoryFormModal
        open={isCategoryModalOpen}
        api={api}
        categoryOptions={categoryOptions}
        onClose={() => setIsCategoryModalOpen(false)}
        onCreated={handleCategoryCreated}
      />

      <ProductAndSkuModal
        open={Boolean(productModalMode)}
        mode={productModalMode}
        api={api}
        categoryOptions={categoryOptions}
        onClose={() => setProductModalMode(null)}
        onCategoryCreated={handleCategoryCreated}
        onProductCreated={handleProductCreated}
        onSkuCreated={handleSkuCreated}
      />

      <EditPriceModal
        sku={editingPriceSku}
        api={api}
        onClose={() => setEditingPriceSku(null)}
        onUpdated={handleSkuUpdated}
        onObservedLatest={handleObservedLatest}
      />

      <StaleStatusModal
        conflict={staleStatusConflict}
        api={api}
        onClose={() => setStaleStatusConflict(null)}
        onResolved={handleSkuUpdated}
      />
    </div>
  );
}
