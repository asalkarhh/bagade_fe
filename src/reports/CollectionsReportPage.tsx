import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { isAbortError, isApiClientError } from '../api/errors.ts';
import { billingApi, type BillingApi } from '../billing/billingApi.ts';
import { CustomerPickerModal } from '../billing/components/CustomerPickerModal.tsx';
import type { Customer } from '../billing/types.ts';
import { formatSignedInrDisplay } from '../utils/inrPrice.ts';
import { getShopLocalDateIso, getShopMonthStartDateIso } from '../utils/shopDate.ts';
import { ReportErrorBanner } from './components/ReportErrorBanner.tsx';
import { ReportPagination } from './components/ReportPagination.tsx';
import { validateDateRange } from './reportUtils.ts';
import { reportsApi, type ReportsApi } from './reportsApi.ts';
import type { CollectionsReport } from './types.ts';
import '../catalog/ProductsPage.css';
import './Reports.css';

export interface CollectionsReportPageProps {
  api?: ReportsApi;
  billing?: BillingApi;
}

const DEFAULT_PAGE_SIZE = 25;

interface CollectionsQueryState {
  key: string;
  data: CollectionsReport | null;
  error: { message: string; requestId?: string | null } | null;
}

export function CollectionsReportPage({
  api = reportsApi,
  billing = billingApi,
}: CollectionsReportPageProps) {
  const fromId = useId();
  const toId = useId();
  const pageSizeId = useId();
  const tableHeadingId = useId();

  const defaultFrom = useMemo(() => getShopMonthStartDateIso(), []);
  const defaultTo = useMemo(() => getShopLocalDateIso(), []);

  const [fromInput, setFromInput] = useState(defaultFrom);
  const [toInput, setToInput] = useState(defaultTo);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  const [appliedFilters, setAppliedFilters] = useState({
    from: defaultFrom,
    to: defaultTo,
    customerId: '',
  });
  const [validationError, setValidationError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [refreshTick, setRefreshTick] = useState(0);

  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [queryState, setQueryState] = useState<CollectionsQueryState | null>(null);

  const requestSeqRef = useRef(0);

  useEffect(() => {
    document.title = 'Collections & Credit Report | Bagade Clothing';
  }, []);

  const activeKey = useMemo(
    () => JSON.stringify({ ...appliedFilters, page, pageSize, refreshTick }),
    [appliedFilters, page, pageSize, refreshTick],
  );

  useEffect(() => {
    const controller = new AbortController();
    const seq = ++requestSeqRef.current;

    api
      .getCollectionsReport(
        {
          from: appliedFilters.from,
          to: appliedFilters.to,
          customerId: appliedFilters.customerId || null,
          page,
          size: pageSize,
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
            : { message: 'Unable to load the collections and credit report right now.' },
        });
      });

    return () => controller.abort();
  }, [activeKey, api, appliedFilters, page, pageSize]);

  const handleApply = (event: FormEvent) => {
    event.preventDefault();
    const dateErr = validateDateRange(fromInput, toInput, true);
    if (dateErr) {
      setValidationError(dateErr);
      return;
    }
    setValidationError(null);
    setAppliedFilters({
      from: fromInput.trim(),
      to: toInput.trim(),
      customerId: selectedCustomer?.customerId ?? '',
    });
    setPage(0);
  };

  const handleReset = () => {
    setFromInput(defaultFrom);
    setToInput(defaultTo);
    setSelectedCustomer(null);
    setValidationError(null);
    setAppliedFilters({
      from: defaultFrom,
      to: defaultTo,
      customerId: '',
    });
    setPage(0);
  };

  const isLoading = queryState === null || queryState.key !== activeKey;
  const report = queryState?.key === activeKey ? queryState.data : null;
  const error = queryState?.key === activeKey ? queryState.error : null;

  return (
    <div className="products-page">
      <section className="surface-card catalog-filters-card" aria-label="Collections report filters">
        <form className="catalog-filters-form" onSubmit={handleApply} noValidate>
          <div className="catalog-filter-field">
            <label htmlFor={fromId} className="catalog-label">
              From Date
            </label>
            <input
              id={fromId}
              type="date"
              className="catalog-input"
              value={fromInput}
              onChange={(event) => {
                setFromInput(event.target.value);
                setValidationError(null);
              }}
            />
          </div>

          <div className="catalog-filter-field">
            <label htmlFor={toId} className="catalog-label">
              To Date (As-Of End Date)
            </label>
            <input
              id={toId}
              type="date"
              className="catalog-input"
              value={toInput}
              onChange={(event) => {
                setToInput(event.target.value);
                setValidationError(null);
              }}
            />
          </div>

          <div className="catalog-filter-field">
            <span className="catalog-label">Customer Filter</span>
            <div className="report-filter-chip-row">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setCustomerModalOpen(true)}
              >
                {selectedCustomer ? 'Change Customer' : 'Filter by Customer'}
              </button>
              {selectedCustomer ? (
                <span className="report-filter-chip">
                  <span>{selectedCustomer.name}</span>
                  <button
                    type="button"
                    className="catalog-inline-link"
                    onClick={() => setSelectedCustomer(null)}
                  >
                    Clear
                  </button>
                </span>
              ) : null}
            </div>
          </div>

          <div className="catalog-filter-actions">
            <button type="submit" className="btn-primary">
              Apply Filters
            </button>
            <button type="button" className="btn-secondary" onClick={handleReset}>
              Reset Month
            </button>
          </div>
        </form>

        {validationError ? (
          <p className="catalog-field-error" role="alert">
            {validationError}
          </p>
        ) : null}
      </section>

      {error ? (
        <ReportErrorBanner
          message={error.message}
          requestId={error.requestId}
          onRetry={() => setRefreshTick((t) => t + 1)}
        />
      ) : null}

      {isLoading && !report ? (
        <section className="surface-card" aria-busy="true">
          <p>Loading cash/UPI collections and customer credit balances…</p>
        </section>
      ) : null}

      {report ? (
        <>
          <div className="alert-banner alert-banner--info" role="status">
            <div className="alert-banner__content">
              <p>
                <strong>Collections vs Sales:</strong> Collections and refunds reflect actual payment
                entries recorded between <strong>{report.from}</strong> and{' '}
                <strong>{report.to}</strong>, separate from net sales revenue. Credit balances
                reflect cumulative unpaid dues strictly as of <strong>{report.to}</strong>.
              </p>
            </div>
          </div>

          <section aria-label="Collections totals across matching customers">
            <div className="report-kpi-grid">
              <div className="report-kpi-card">
                <span className="report-kpi-card__label">Cash Collected</span>
                <span className="report-kpi-card__value">
                  {formatSignedInrDisplay(report.cashCollected)}
                </span>
              </div>

              <div className="report-kpi-card">
                <span className="report-kpi-card__label">UPI Collected</span>
                <span className="report-kpi-card__value">
                  {formatSignedInrDisplay(report.upiCollected)}
                </span>
              </div>

              <div className="report-kpi-card">
                <span className="report-kpi-card__label">Total Collections</span>
                <span className="report-kpi-card__value">
                  {formatSignedInrDisplay(report.totalCollections)}
                </span>
                <span className="report-kpi-card__note">Before refunds</span>
              </div>

              <div className="report-kpi-card">
                <span className="report-kpi-card__label">Total Refunds</span>
                <span className="report-kpi-card__value">
                  {formatSignedInrDisplay(report.totalRefunds)}
                </span>
                <span className="report-kpi-card__note">
                  Cash: {formatSignedInrDisplay(report.cashRefunded)} · UPI:{' '}
                  {formatSignedInrDisplay(report.upiRefunded)}
                </span>
              </div>

              <div className="report-kpi-card">
                <span className="report-kpi-card__label">Net Collections</span>
                <span className="report-kpi-card__value">
                  {formatSignedInrDisplay(report.netCollections)}
                </span>
              </div>

              <div className="report-kpi-card">
                <span className="report-kpi-card__label">Credit Sales (Period)</span>
                <span className="report-kpi-card__value">
                  {formatSignedInrDisplay(report.creditSales)}
                </span>
                <span className="report-kpi-card__note">New unpaid credit billed</span>
              </div>

              <div className="report-kpi-card report-kpi-card--highlight">
                <span className="report-kpi-card__label">
                  Outstanding Credit (as of {report.to})
                </span>
                <span className="report-kpi-card__value">
                  {formatSignedInrDisplay(report.outstandingBalanceAsOfEnd)}
                </span>
              </div>
            </div>
          </section>

          <section
            className="surface-card catalog-results-card"
            aria-label="Customer collections breakdown"
          >
            <div className="catalog-results-bar">
              <div>
                <h2 id={tableHeadingId} className="catalog-results-count">
                  {report.total === 0
                    ? '0 customers with collections or credit activity'
                    : `${report.total} customer${report.total === 1 ? '' : 's'} with activity`}
                </h2>
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

            {report.items.length === 0 ? (
              <div className="catalog-empty-state">
                <p>
                  No customer credit balances or customer-linked payments matched the selected period
                  and filter.
                </p>
              </div>
            ) : (
              <>
                <div
                  className="catalog-table-wrapper"
                  role="region"
                  aria-labelledby={tableHeadingId}
                  tabIndex={0}
                >
                  <table className="catalog-table reports-table">
                    <thead>
                      <tr>
                        <th scope="col">Customer</th>
                        <th scope="col">Contact</th>
                        <th scope="col" className="cell-num">
                          Cash
                        </th>
                        <th scope="col" className="cell-num">
                          UPI
                        </th>
                        <th scope="col" className="cell-num">
                          Total Collected
                        </th>
                        <th scope="col" className="cell-num">
                          Refunds
                        </th>
                        <th scope="col" className="cell-num">
                          Net Collected
                        </th>
                        <th scope="col" className="cell-num">
                          Credit Sales
                        </th>
                        <th scope="col" className="cell-num">
                          Outstanding ({report.to})
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.items.map((row) => (
                        <tr key={row.customerId}>
                          <th scope="row">{row.customerName || row.customerId}</th>
                          <td data-label="Contact">{row.customerContact || '—'}</td>
                          <td className="cell-num" data-label="Cash">
                            {formatSignedInrDisplay(row.cashCollected)}
                          </td>
                          <td className="cell-num" data-label="UPI">
                            {formatSignedInrDisplay(row.upiCollected)}
                          </td>
                          <td className="cell-num" data-label="Total Collected">
                            {formatSignedInrDisplay(row.totalCollections)}
                          </td>
                          <td className="cell-num" data-label="Refunds">
                            {formatSignedInrDisplay(row.totalRefunds)}
                          </td>
                          <td className="cell-num" data-label="Net Collected">
                            {formatSignedInrDisplay(row.netCollections)}
                          </td>
                          <td className="cell-num" data-label="Credit Sales">
                            {formatSignedInrDisplay(row.creditSales)}
                          </td>
                          <td className="cell-num" data-label={`Outstanding (${report.to})`}>
                            {formatSignedInrDisplay(row.outstandingBalanceAsOfEnd)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <ReportPagination
                  page={page}
                  pageSize={pageSize}
                  totalItems={report.total}
                  isLoading={isLoading}
                  onPageChange={setPage}
                />
              </>
            )}
          </section>
        </>
      ) : null}

      <CustomerPickerModal
        open={customerModalOpen}
        api={billing}
        allowCreate={false}
        onClose={() => setCustomerModalOpen(false)}
        onSelectCustomer={(customer) => {
          setSelectedCustomer(customer);
          setCustomerModalOpen(false);
        }}
      />
    </div>
  );
}
