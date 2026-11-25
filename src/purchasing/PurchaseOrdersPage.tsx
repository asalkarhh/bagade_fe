import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { isAbortError, isApiClientError } from '../api/errors.ts';
import { purchasingApi, type PurchasingApi } from './purchasingApi.ts';
import { ALL_PO_STATUSES, getPoStatusDisplay } from './statusLabels.ts';
import type { PurchaseOrderListItem, PurchaseOrderStatus, Vendor } from './types.ts';

export interface PurchaseOrdersPageProps {
  api?: PurchasingApi;
}

const DEFAULT_PAGE_SIZE = 25;

interface PoQueryState {
  key: string;
  items: PurchaseOrderListItem[];
  total: number;
  error: { message: string; requestId?: string | null } | null;
}

export function PurchaseOrdersPage({ api = purchasingApi }: PurchaseOrdersPageProps) {
  const vendorFilterId = useId();
  const statusFilterId = useId();
  const fromDateId = useId();
  const toDateId = useId();
  const pageSizeId = useId();
  const captionId = useId();

  const [vendorId, setVendorId] = useState('');
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | ''>('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [refreshTick, setRefreshTick] = useState(0);

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [queryState, setQueryState] = useState<PoQueryState | null>(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    document.title = 'Purchase Orders | Bagade Clothing';
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api
      .listAllVendors(controller.signal)
      .then((loaded) => {
        if (!controller.signal.aborted) {
          setVendors(loaded);
        }
      })
      .catch(() => {
        // Non-blocking: vendor filter falls back cleanly if vendor list fails.
      });
    return () => {
      controller.abort();
    };
  }, [api]);

  const dateRangeError =
    fromDate && toDate && fromDate > toDate
      ? "'From' date must not be after 'To' date."
      : null;

  const activeQueryKey = useMemo(
    () =>
      JSON.stringify({
        vendorId,
        status: statusFilter,
        from: fromDate,
        to: toDate,
        page,
        size: pageSize,
        refreshTick,
      }),
    [vendorId, statusFilter, fromDate, toDate, page, pageSize, refreshTick],
  );

  useEffect(() => {
    if (dateRangeError) {
      return;
    }

    const controller = new AbortController();
    const seq = ++requestSeqRef.current;

    api
      .listPurchaseOrders(
        {
          vendorId: vendorId || null,
          status: statusFilter,
          from: fromDate || undefined,
          to: toDate || undefined,
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
              : 'Unable to load purchase orders.',
            requestId: isApiClientError(error) ? error.requestId : null,
          },
        }));
      });

    return () => {
      controller.abort();
    };
  }, [api, vendorId, statusFilter, fromDate, toDate, page, pageSize, activeQueryKey, dateRangeError]);

  const vendorNamesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of vendors) {
      map.set(v.vendorId, v.name);
    }
    return map;
  }, [vendors]);

  const sortedVendors = useMemo(
    () =>
      [...vendors].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      ),
    [vendors],
  );

  const orders = queryState?.items ?? [];
  const totalOrders = queryState?.total ?? 0;
  const loadError = queryState?.error ?? null;
  const hasLoadedOnce = queryState !== null && queryState.error === null;
  const isLoading = !dateRangeError && queryState?.key !== activeQueryKey;

  const hasActiveFilters =
    vendorId.length > 0 || statusFilter.length > 0 || fromDate.length > 0 || toDate.length > 0;

  const handleFilterSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (dateRangeError) {
      return;
    }
    if (page !== 0) {
      setPage(0);
    } else {
      setRefreshTick((prev) => prev + 1);
    }
  };

  const handleReset = () => {
    setVendorId('');
    setStatusFilter('');
    setFromDate('');
    setToDate('');
    setPage(0);
  };

  const totalPages = Math.max(1, Math.ceil(totalOrders / pageSize));
  const rangeStart = totalOrders === 0 ? 0 : page * pageSize + 1;
  const rangeEnd = Math.min(totalOrders, page * pageSize + orders.length);

  return (
    <div className="products-page">
      <div className="products-header">
        <div className="products-header__title-group">
          <h1 id="main-content" tabIndex={-1}>
            Purchase Orders
          </h1>
          <p className="products-header__subtitle">
            Track open vendor orders and remaining expected quantities before placing new orders.
          </p>
        </div>
      </div>

      <section className="surface-card catalog-filters-card" aria-label="Purchase order filters">
        <search>
          <form className="catalog-filters-form" onSubmit={handleFilterSubmit}>
            <div className="catalog-filter-field catalog-filter-field--category">
              <label htmlFor={vendorFilterId} className="catalog-label">
                Vendor
              </label>
              <select
                id={vendorFilterId}
                name="vendorId"
                className="catalog-select"
                value={vendorId}
                onChange={(event) => {
                  setVendorId(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">All vendors</option>
                {sortedVendors.map((v) => (
                  <option key={v.vendorId} value={v.vendorId}>
                    {v.name}
                    {v.active ? '' : ' (Inactive)'}
                  </option>
                ))}
              </select>
            </div>

            <div className="catalog-filter-field catalog-filter-field--category">
              <label htmlFor={statusFilterId} className="catalog-label">
                Status
              </label>
              <select
                id={statusFilterId}
                name="status"
                className="catalog-select"
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value as PurchaseOrderStatus | '');
                  setPage(0);
                }}
              >
                <option value="">All statuses</option>
                {ALL_PO_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {getPoStatusDisplay(st).label}
                  </option>
                ))}
              </select>
            </div>

            <div className="catalog-filter-field">
              <label htmlFor={fromDateId} className="catalog-label">
                From date
              </label>
              <input
                id={fromDateId}
                name="from"
                type="date"
                className="catalog-input"
                value={fromDate}
                onChange={(event) => {
                  setFromDate(event.target.value);
                  setPage(0);
                }}
                aria-invalid={dateRangeError ? 'true' : 'false'}
              />
            </div>

            <div className="catalog-filter-field">
              <label htmlFor={toDateId} className="catalog-label">
                To date
              </label>
              <input
                id={toDateId}
                name="to"
                type="date"
                className="catalog-input"
                value={toDate}
                onChange={(event) => {
                  setToDate(event.target.value);
                  setPage(0);
                }}
                aria-invalid={dateRangeError ? 'true' : 'false'}
              />
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
                Filter
              </button>
              {hasActiveFilters ? (
                <button type="button" className="btn-secondary" onClick={handleReset}>
                  Reset
                </button>
              ) : null}
            </div>
          </form>
        </search>

        {dateRangeError ? (
          <div className="alert-banner alert-banner--error" role="alert" style={{ marginBlockStart: '0.75rem' }}>
            <div className="alert-banner__content">
              <p>{dateRangeError}</p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="surface-card catalog-results-card" aria-label="Purchase order list">
        <div className="catalog-results-bar">
          <span id={captionId} className="catalog-results-count">
            {totalOrders === 0
              ? '0 purchase orders'
              : `Showing ${rangeStart}–${rangeEnd} of ${totalOrders} purchase orders`}
          </span>
          {isLoading ? (
            <span className="catalog-refreshing" aria-live="polite">
              Loading purchase orders…
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
            <p>Loading purchase orders…</p>
            <progress className="state-progress" aria-label="Loading purchase orders" />
          </div>
        ) : orders.length === 0 ? (
          <div className="catalog-empty-state">
            {hasActiveFilters ? (
              <>
                <p>No purchase orders match the selected filters.</p>
                <button type="button" className="btn-secondary" onClick={handleReset}>
                  Reset filters
                </button>
              </>
            ) : (
              <>
                <p>No purchase orders have been created yet.</p>
                <Link to="/purchases/new" className="btn-primary">
                  Create first purchase order
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
                Purchase orders with vendor, order date, status, and total open quantity
              </caption>
              <thead>
                <tr>
                  <th scope="col">PO number</th>
                  <th scope="col">Vendor</th>
                  <th scope="col">Order date</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="cell-num">
                    Total open qty
                  </th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((po) => {
                  const statusDisplay = getPoStatusDisplay(po.status);
                  const vendorLabel = vendorNamesById.get(po.vendorId) ?? po.vendorId;

                  return (
                    <tr key={po.poId}>
                      <th scope="row">
                        <Link to={`/purchases/${po.poId}`} className="po-link">
                          {po.poNumber}
                        </Link>
                      </th>
                      <td data-label="Vendor">{vendorLabel}</td>
                      <td data-label="Order date">{po.orderDate}</td>
                      <td data-label="Status">
                        <span className={`po-status-pill po-status-pill--${statusDisplay.variant}`}>
                          <span aria-hidden="true">{statusDisplay.symbol}</span>
                          <span>{statusDisplay.label}</span>
                        </span>
                      </td>
                      <td data-label="Total open qty" className="cell-num">
                        {po.totalOpenQuantity}
                      </td>
                      <td data-label="Details">
                        <Link to={`/purchases/${po.poId}`} className="btn-table-action">
                          View order
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="catalog-pagination">
          <span>
            Page {totalOrders === 0 ? 0 : page + 1} of {totalOrders === 0 ? 0 : totalPages}
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
              disabled={(page + 1) * pageSize >= totalOrders || isLoading}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
