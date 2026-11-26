import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { isAbortError, isApiClientError } from '../api/errors.ts';
import { formatInrDisplay } from '../utils/inrPrice.ts';
import { billingApi, type BillingApi } from './billingApi.ts';
import { CustomerPickerModal } from './components/CustomerPickerModal.tsx';
import { getBillStatusDisplay } from './statusLabels.ts';
import type { BillSummary, Customer } from './types.ts';
import '../catalog/ProductsPage.css';
import '../purchasing/Purchasing.css';
import './Billing.css';

export interface BillHistoryPageProps {
  api?: BillingApi;
}

const DEFAULT_PAGE_SIZE = 25;

interface BillHistoryQueryState {
  key: string;
  items: BillSummary[];
  total: number;
  error: { message: string; requestId?: string | null } | null;
}

export function BillHistoryPage({ api = billingApi }: BillHistoryPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const billNumberId = useId();
  const fromDateId = useId();
  const toDateId = useId();
  const pageSizeId = useId();
  const tableCaptionId = useId();

  const [billNumberInput, setBillNumberInput] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [customerFilter, setCustomerFilter] = useState<Customer | null>(() => {
    const id = searchParams.get('customerId')?.trim() || '';
    if (!id) {
      return null;
    }
    return {
      customerId: id,
      name: searchParams.get('customerName')?.trim() || id,
      contact: searchParams.get('customerContact')?.trim() || null,
    };
  });
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [refreshTick, setRefreshTick] = useState(0);

  const [queryState, setQueryState] = useState<BillHistoryQueryState | null>(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    document.title = 'Bill History | Bagade Clothing';
  }, []);

  const dateRangeError =
    fromDate && toDate && fromDate > toDate
      ? "'From' date must not be after 'To' date."
      : null;

  const activeQueryKey = useMemo(
    () =>
      JSON.stringify({
        billNumber: billNumberInput.trim(),
        from: fromDate,
        to: toDate,
        customerId: customerFilter?.customerId ?? '',
        page,
        size: pageSize,
        refreshTick,
      }),
    [billNumberInput, fromDate, toDate, customerFilter?.customerId, page, pageSize, refreshTick],
  );

  useEffect(() => {
    if (dateRangeError) {
      return;
    }

    const controller = new AbortController();
    const seq = ++requestSeqRef.current;

    api
      .listBills(
        {
          billNumber: billNumberInput.trim() || undefined,
          from: fromDate || undefined,
          to: toDate || undefined,
          customerId: customerFilter?.customerId ?? undefined,
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
            message: isApiClientError(error) ? error.message : 'Unable to load bills.',
            requestId: isApiClientError(error) ? error.requestId : null,
          },
        }));
      });

    return () => {
      controller.abort();
    };
  }, [api, billNumberInput, fromDate, toDate, customerFilter, page, pageSize, activeQueryKey, dateRangeError]);

  const bills = queryState?.items ?? [];
  const totalBills = queryState?.total ?? 0;
  const loadError = queryState?.error ?? null;
  const hasLoadedOnce = queryState !== null && queryState.error === null;
  const isLoading = !dateRangeError && queryState?.key !== activeQueryKey;

  const hasActiveFilters =
    billNumberInput.trim().length > 0 ||
    fromDate.length > 0 ||
    toDate.length > 0 ||
    customerFilter !== null;

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

  const syncCustomerSearchParam = (customer: Customer | null) => {
    const next = new URLSearchParams(searchParams);
    if (customer) {
      next.set('customerId', customer.customerId);
      next.set('customerName', customer.name);
      if (customer.contact) {
        next.set('customerContact', customer.contact);
      } else {
        next.delete('customerContact');
      }
    } else {
      next.delete('customerId');
      next.delete('customerName');
      next.delete('customerContact');
    }
    setSearchParams(next, { replace: true });
  };

  const handleReset = () => {
    setBillNumberInput('');
    setFromDate('');
    setToDate('');
    setCustomerFilter(null);
    syncCustomerSearchParam(null);
    setPage(0);
  };

  const totalPages = Math.max(1, Math.ceil(totalBills / pageSize));
  const rangeStart = totalBills === 0 ? 0 : page * pageSize + 1;
  const rangeEnd = Math.min(totalBills, page * pageSize + bills.length);

  return (
    <div className="products-page">
      <div className="products-header">
        <div className="products-header__title-group">
          <h1 id="main-content" tabIndex={-1}>
            Bill History
          </h1>
          <p className="products-header__subtitle">
            Search issued bills by number, date range, or customer to view snapshots or reprint 80 mm
            receipts.
          </p>
        </div>

        <div className="products-header__actions">
          <Link to="/billing" className="btn-primary">
            New Bill
          </Link>
        </div>
      </div>

      <section className="surface-card catalog-filters-card" aria-label="Bill history filters">
        <search>
          <form className="catalog-filters-form" onSubmit={handleFilterSubmit}>
            <div className="catalog-filter-field catalog-filter-field--search">
              <label htmlFor={billNumberId} className="catalog-label">
                Bill number
              </label>
              <input
                id={billNumberId}
                name="billNumber"
                type="search"
                className="catalog-input"
                placeholder="e.g. BILL-2026-0001"
                value={billNumberInput}
                onChange={(event) => {
                  setBillNumberInput(event.target.value);
                  setPage(0);
                }}
              />
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

            <div className="catalog-filter-field catalog-filter-field--category">
              <span className="catalog-label">Customer filter</span>
              <div className="cell-actions__group">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsCustomerModalOpen(true)}
                >
                  {customerFilter ? `Customer: ${customerFilter.name}` : 'Filter by customer'}
                </button>
                {customerFilter ? (
                  <button
                    type="button"
                    className="btn-table-action"
                    onClick={() => {
                      setCustomerFilter(null);
                      syncCustomerSearchParam(null);
                      setPage(0);
                    }}
                  >
                    Clear customer
                  </button>
                ) : null}
              </div>
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
          <div
            className="alert-banner alert-banner--error"
            role="alert"
            style={{ marginBlockStart: '0.75rem' }}
          >
            <div className="alert-banner__content">
              <p>{dateRangeError}</p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="surface-card catalog-results-card" aria-label="Bill list">
        <div className="catalog-results-bar">
          <span id={tableCaptionId} className="catalog-results-count">
            {totalBills === 0
              ? '0 bills'
              : `Showing ${rangeStart}–${rangeEnd} of ${totalBills} bills`}
          </span>
          {isLoading ? (
            <span className="catalog-refreshing" aria-live="polite">
              Loading bills…
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
            <p>Loading bills…</p>
            <progress className="state-progress" aria-label="Loading bills" />
          </div>
        ) : bills.length === 0 ? (
          <div className="catalog-empty-state">
            {hasActiveFilters ? (
              <>
                <p>No bills match the selected filters.</p>
                <button type="button" className="btn-secondary" onClick={handleReset}>
                  Reset filters
                </button>
              </>
            ) : (
              <>
                <p>No bills have been issued yet.</p>
                <Link to="/billing" className="btn-primary">
                  Go to Billing Counter
                </Link>
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
                Issued bills with issue date, status, total, amount paid, and balance due
              </caption>
              <thead>
                <tr>
                  <th scope="col">Bill number</th>
                  <th scope="col">Issue date</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="cell-num">
                    Total
                  </th>
                  <th scope="col" className="cell-num">
                    Paid
                  </th>
                  <th scope="col" className="cell-num">
                    Balance due
                  </th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((bill) => {
                  const statusDisplay = getBillStatusDisplay(bill.status);
                  return (
                    <tr key={bill.billId}>
                      <th scope="row">
                        <Link to={`/billing/${bill.billId}`} className="po-link">
                          {bill.billNumber}
                        </Link>
                      </th>
                      <td data-label="Issue date">{bill.issueDate}</td>
                      <td data-label="Status">
                        <span
                          className={`bill-status-pill bill-status-pill--${statusDisplay.variant}`}
                        >
                          <span aria-hidden="true">{statusDisplay.symbol}</span>
                          <span>{statusDisplay.label}</span>
                        </span>
                      </td>
                      <td data-label="Total" className="cell-num">
                        {formatInrDisplay(bill.total)}
                      </td>
                      <td data-label="Paid" className="cell-num">
                        {formatInrDisplay(bill.paid)}
                      </td>
                      <td data-label="Balance due" className="cell-num">
                        {formatInrDisplay(bill.balanceDue)}
                      </td>
                      <td data-label="Details">
                        <Link to={`/billing/${bill.billId}`} className="btn-table-action">
                          View bill
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
            Page {totalBills === 0 ? 0 : page + 1} of {totalBills === 0 ? 0 : totalPages}
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
              disabled={(page + 1) * pageSize >= totalBills || isLoading}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>

      <CustomerPickerModal
        open={isCustomerModalOpen}
        api={api}
        allowCreate={false}
        onClose={() => setIsCustomerModalOpen(false)}
        onSelectCustomer={(customer) => {
          setCustomerFilter(customer);
          syncCustomerSearchParam(customer);
          setPage(0);
        }}
      />
    </div>
  );
}
