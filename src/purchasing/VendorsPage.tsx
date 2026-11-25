import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { isAbortError, isApiClientError } from '../api/errors.ts';
import type { ActiveStatusFilter } from '../catalog/types.ts';
import { VendorFormModal } from './components/VendorFormModal.tsx';
import { purchasingApi, type PurchasingApi } from './purchasingApi.ts';
import type { Vendor } from './types.ts';

export interface VendorsPageProps {
  api?: PurchasingApi;
}

const DEFAULT_PAGE_SIZE = 25;

interface VendorQueryState {
  key: string;
  items: Vendor[];
  total: number;
  error: { message: string; requestId?: string | null } | null;
}

export function VendorsPage({ api = purchasingApi }: VendorsPageProps) {
  const searchId = useId();
  const pageSizeId = useId();
  const captionId = useId();

  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ActiveStatusFilter>('ACTIVE');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [refreshTick, setRefreshTick] = useState(0);

  const [queryState, setQueryState] = useState<VendorQueryState | null>(null);
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const requestSeqRef = useRef(0);

  useEffect(() => {
    document.title = 'Vendors | Bagade Clothing';
  }, []);

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

  const activeQueryKey = useMemo(
    () =>
      JSON.stringify({
        q: debouncedQuery,
        status: statusFilter,
        page,
        size: pageSize,
        refreshTick,
      }),
    [debouncedQuery, statusFilter, page, pageSize, refreshTick],
  );

  useEffect(() => {
    const controller = new AbortController();
    const seq = ++requestSeqRef.current;

    api
      .listVendors(
        {
          q: debouncedQuery || undefined,
          status: statusFilter,
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
            message: isApiClientError(error) ? error.message : 'Unable to load vendors.',
            requestId: isApiClientError(error) ? error.requestId : null,
          },
        }));
      });

    return () => {
      controller.abort();
    };
  }, [api, debouncedQuery, statusFilter, page, pageSize, activeQueryKey]);

  const vendors = queryState?.items ?? [];
  const totalVendors = queryState?.total ?? 0;
  const loadError = queryState?.error ?? null;
  const hasLoadedOnce = queryState !== null && queryState.error === null;
  const isLoading = queryState?.key !== activeQueryKey;

  const hasActiveFilters =
    debouncedQuery.length > 0 || searchInput.trim().length > 0 || statusFilter !== 'ACTIVE';

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
    setStatusFilter('ACTIVE');
    setPage(0);
  };

  const handleVendorCreated = (created: Vendor) => {
    setStatusNotice(`Vendor "${created.name}" created.`);
    setRefreshTick((prev) => prev + 1);
  };

  const totalPages = Math.max(1, Math.ceil(totalVendors / pageSize));
  const rangeStart = totalVendors === 0 ? 0 : page * pageSize + 1;
  const rangeEnd = Math.min(totalVendors, page * pageSize + vendors.length);

  return (
    <div className="products-page">
      <div className="products-header">
        <div className="products-header__title-group">
          <h1 id="main-content" tabIndex={-1}>
            Vendors
          </h1>
          <p className="products-header__subtitle">
            Search clothing suppliers by name or contact and add new vendors for purchase orders.
          </p>
        </div>

        <div className="products-header__actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setIsVendorModalOpen(true)}
          >
            New vendor
          </button>
        </div>
      </div>

      {statusNotice ? (
        <div className="alert-banner alert-banner--info" role="status">
          <div className="alert-banner__content">
            <p>{statusNotice}</p>
          </div>
        </div>
      ) : null}

      <section className="surface-card catalog-filters-card" aria-label="Vendor filters">
        <search>
          <form className="catalog-filters-form" onSubmit={handleSearchSubmit}>
            <div className="catalog-filter-field catalog-filter-field--search">
              <label htmlFor={searchId} className="catalog-label">
                Search vendor name or contact
              </label>
              <input
                id={searchId}
                name="q"
                type="search"
                className="catalog-input"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="e.g. Kanchipuram Silk Looms, 98765"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="search"
              />
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
                        name="vendorStatus"
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

      <section className="surface-card catalog-results-card" aria-label="Vendor list">
        <div className="catalog-results-bar">
          <span id={captionId} className="catalog-results-count">
            {totalVendors === 0
              ? '0 vendors'
              : `Showing ${rangeStart}–${rangeEnd} of ${totalVendors} vendors`}
          </span>
          {isLoading ? (
            <span className="catalog-refreshing" aria-live="polite">
              Loading vendors…
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
            <p>Loading vendors…</p>
            <progress className="state-progress" aria-label="Loading vendors" />
          </div>
        ) : vendors.length === 0 ? (
          <div className="catalog-empty-state">
            {hasActiveFilters ? (
              <>
                <p>No vendors match the current search or status filter.</p>
                <button type="button" className="btn-secondary" onClick={handleResetFilters}>
                  Reset filters
                </button>
              </>
            ) : (
              <>
                <p>No active vendors yet. Add a supplier before creating a purchase order.</p>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setIsVendorModalOpen(true)}
                >
                  Create first vendor
                </button>
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
              <caption className="visually-hidden">Vendors with contact and active status</caption>
              <thead>
                <tr>
                  <th scope="col">Vendor name</th>
                  <th scope="col">Contact</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((vendor) => (
                  <tr key={vendor.vendorId}>
                    <th scope="row">{vendor.name}</th>
                    <td data-label="Contact">{vendor.contact ?? '—'}</td>
                    <td data-label="Status">
                      <span
                        className={
                          vendor.active
                            ? 'sku-status-pill sku-status-pill--active'
                            : 'sku-status-pill sku-status-pill--inactive'
                        }
                      >
                        <span aria-hidden="true">{vendor.active ? '●' : '○'}</span>
                        <span>{vendor.active ? 'Active' : 'Inactive'}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="catalog-pagination">
          <span>
            Page {totalVendors === 0 ? 0 : page + 1} of {totalVendors === 0 ? 0 : totalPages}
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
              disabled={(page + 1) * pageSize >= totalVendors || isLoading}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>

      <VendorFormModal
        open={isVendorModalOpen}
        api={api}
        onClose={() => setIsVendorModalOpen(false)}
        onCreated={handleVendorCreated}
      />
    </div>
  );
}
