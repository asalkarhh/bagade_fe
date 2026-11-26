import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { isAbortError, isApiClientError } from '../api/errors.ts';
import { catalogApi, type CatalogApi } from '../catalog/catalogApi.ts';
import { buildCategoryOptions } from '../catalog/categoryUtils.ts';
import type { Category } from '../catalog/types.ts';
import { purchasingApi, type PurchasingApi } from '../purchasing/purchasingApi.ts';
import type { Vendor } from '../purchasing/types.ts';
import { formatSignedInrDisplay } from '../utils/inrPrice.ts';
import {
  getShopLocalDateIso,
  getShopMonthStartDateIso,
  isValidIsoDate,
} from '../utils/shopDate.ts';
import { ReportErrorBanner } from './components/ReportErrorBanner.tsx';
import { ReportPagination } from './components/ReportPagination.tsx';
import { formatReportMoneyOrUnavailable, validateDateRange } from './reportUtils.ts';
import { reportsApi, type ReportsApi } from './reportsApi.ts';
import type { VendorReport } from './types.ts';
import '../catalog/ProductsPage.css';
import './Reports.css';

export interface VendorReportPageProps {
  api?: ReportsApi;
  catalog?: CatalogApi;
  purchasing?: PurchasingApi;
}

const DEFAULT_PAGE_SIZE = 25;

interface VendorQueryState {
  key: string;
  data: VendorReport | null;
  error: { message: string; requestId?: string | null } | null;
}

export function VendorReportPage({
  api = reportsApi,
  catalog = catalogApi,
  purchasing = purchasingApi,
}: VendorReportPageProps) {
  const fromId = useId();
  const toId = useId();
  const snapshotId = useId();
  const vendorIdFilterId = useId();
  const categoryIdFilterId = useId();
  const pageSizeId = useId();
  const tableHeadingId = useId();

  const defaultFrom = useMemo(() => getShopMonthStartDateIso(), []);
  const defaultTo = useMemo(() => getShopLocalDateIso(), []);

  const [fromInput, setFromInput] = useState(defaultFrom);
  const [toInput, setToInput] = useState(defaultTo);
  const [snapshotInput, setSnapshotInput] = useState('');
  const [vendorInput, setVendorInput] = useState('');
  const [categoryInput, setCategoryInput] = useState('');

  const [appliedFilters, setAppliedFilters] = useState({
    from: defaultFrom,
    to: defaultTo,
    snapshotDate: '',
    vendorId: '',
    categoryId: '',
  });
  const [validationError, setValidationError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [refreshTick, setRefreshTick] = useState(0);

  const [categories, setCategories] = useState<Category[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [queryState, setQueryState] = useState<VendorQueryState | null>(null);

  const requestSeqRef = useRef(0);

  useEffect(() => {
    document.title = 'Vendor Performance Report | Bagade Clothing';
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

  const activeKey = useMemo(
    () => JSON.stringify({ ...appliedFilters, page, pageSize, refreshTick }),
    [appliedFilters, page, pageSize, refreshTick],
  );

  useEffect(() => {
    const controller = new AbortController();
    const seq = ++requestSeqRef.current;

    api
      .getVendorReport(
        {
          from: appliedFilters.from,
          to: appliedFilters.to,
          snapshotDate: appliedFilters.snapshotDate || undefined,
          vendorId: appliedFilters.vendorId || null,
          categoryId: appliedFilters.categoryId || null,
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
            : { message: 'Unable to load the vendor performance report right now.' },
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

    const trimmedSnap = snapshotInput.trim();
    if (trimmedSnap) {
      if (!isValidIsoDate(trimmedSnap)) {
        setValidationError('Enter a valid snapshot date (YYYY-MM-DD).');
        return;
      }
      if (trimmedSnap < fromInput.trim()) {
        setValidationError('Snapshot date must not be before receipt period start ("From") date.');
        return;
      }
    }

    setValidationError(null);
    setAppliedFilters({
      from: fromInput.trim(),
      to: toInput.trim(),
      snapshotDate: trimmedSnap,
      vendorId: vendorInput,
      categoryId: categoryInput,
    });
    setPage(0);
  };

  const handleReset = () => {
    setFromInput(defaultFrom);
    setToInput(defaultTo);
    setSnapshotInput('');
    setVendorInput('');
    setCategoryInput('');
    setValidationError(null);
    setAppliedFilters({
      from: defaultFrom,
      to: defaultTo,
      snapshotDate: '',
      vendorId: '',
      categoryId: '',
    });
    setPage(0);
  };

  const isLoading = queryState === null || queryState.key !== activeKey;
  const report = queryState?.key === activeKey ? queryState.data : null;
  const error = queryState?.key === activeKey ? queryState.error : null;

  return (
    <div className="products-page">
      <section className="surface-card catalog-filters-card" aria-label="Vendor report filters">
        <form className="catalog-filters-form" onSubmit={handleApply} noValidate>
          <div className="catalog-filter-field">
            <label htmlFor={fromId} className="catalog-label">
              Receipt Period From
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
              Receipt Period To
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
            <label htmlFor={snapshotId} className="catalog-label">
              Snapshot Date (optional)
            </label>
            <input
              id={snapshotId}
              type="date"
              className="catalog-input"
              value={snapshotInput}
              onChange={(event) => {
                setSnapshotInput(event.target.value);
                setValidationError(null);
              }}
            />
          </div>

          <div className="catalog-filter-field catalog-filter-field--category">
            <label htmlFor={vendorIdFilterId} className="catalog-label">
              Vendor
            </label>
            <select
              id={vendorIdFilterId}
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

          <div className="catalog-filter-field catalog-filter-field--category">
            <label htmlFor={categoryIdFilterId} className="catalog-label">
              Category
            </label>
            <select
              id={categoryIdFilterId}
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

      {error ? (
        <ReportErrorBanner
          message={error.message}
          requestId={error.requestId}
          onRetry={() => setRefreshTick((t) => t + 1)}
        />
      ) : null}

      {isLoading && !report ? (
        <section className="surface-card" aria-busy="true">
          <p>Loading vendor cohort performance…</p>
        </section>
      ) : null}

      {report ? (
        <>
          <div className="alert-banner alert-banner--info" role="status">
            <div className="alert-banner__content">
              <p>
                <strong>Receipt Period:</strong> {report.from} to {report.to} ·{' '}
                <strong>Snapshot Date:</strong> {report.snapshotDate}. Direct batch units came from
                internal tag scans (physically identified batch); FIFO units were allocated
                oldest-first; Unknown Attribution / Audit Surplus reflects stock without a linked
                supplier batch.
              </p>
            </div>
          </div>

          {!report.costComplete ? (
            <div className="alert-banner alert-banner--warning" role="status">
              <div className="alert-banner__content">
                <p>
                  <strong>Gross margin is incomplete:</strong> At least one cohort includes
                  unknown-cost units (such as audit surplus). Incomplete margins are shown as
                  unavailable.
                </p>
              </div>
            </div>
          ) : null}

          <section aria-label="Vendor totals across all matching cohorts">
            <div className="report-kpi-grid">
              <div className="report-kpi-card">
                <span className="report-kpi-card__label">Received Units</span>
                <span className="report-kpi-card__value">{report.totalReceivedUnits}</span>
              </div>

              <div className="report-kpi-card">
                <span className="report-kpi-card__label">Net Sold Units</span>
                <span className="report-kpi-card__value">{report.totalNetSoldUnits}</span>
                <span className="report-kpi-card__note">
                  Direct batch: {report.totalDirectBatchSoldUnits} · FIFO: {report.totalFifoSoldUnits}
                </span>
              </div>

              <div className="report-kpi-card">
                <span className="report-kpi-card__label">Remaining Sellable</span>
                <span className="report-kpi-card__value">{report.totalRemainingSellableUnits}</span>
              </div>

              <div className="report-kpi-card">
                <span className="report-kpi-card__label">Sell-Through %</span>
                <span
                  className={`report-kpi-card__value${
                    report.totalSellThroughPercentage === null ? ' report-unavailable-value' : ''
                  }`}
                >
                  {report.totalSellThroughPercentage !== null
                    ? `${report.totalSellThroughPercentage}%`
                    : 'Unavailable'}
                </span>
              </div>

              <div className="report-kpi-card report-kpi-card--highlight">
                <span className="report-kpi-card__label">Total Gross Margin</span>
                <span
                  className={`report-kpi-card__value${
                    !report.costComplete || report.totalGrossMargin === null
                      ? ' report-unavailable-value'
                      : ''
                  }`}
                >
                  {formatReportMoneyOrUnavailable(
                    report.totalGrossMargin,
                    report.costComplete,
                    'Unavailable (margin incomplete)',
                  )}
                </span>
              </div>

              <div className="report-kpi-card">
                <span className="report-kpi-card__label">Avg Days Receipt → Sale</span>
                <span
                  className={`report-kpi-card__value${
                    report.weightedDaysFromReceiptToSale === null ? ' report-unavailable-value' : ''
                  }`}
                >
                  {report.weightedDaysFromReceiptToSale !== null
                    ? `${report.weightedDaysFromReceiptToSale} days`
                    : 'Unavailable'}
                </span>
              </div>
            </div>
          </section>

          <section className="surface-card catalog-results-card" aria-label="Vendor cohorts table">
            <div className="catalog-results-bar">
              <div>
                <h2 id={tableHeadingId} className="catalog-results-count">
                  {report.total === 0
                    ? '0 vendor cohorts'
                    : `${report.total} vendor cohort${report.total === 1 ? '' : 's'}`}
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
                <p>No batches received during this receipt period match your filters.</p>
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
                        <th scope="col">Vendor / Cohort</th>
                        <th scope="col">Attribution Type</th>
                        <th scope="col" className="cell-num">
                          Received
                        </th>
                        <th scope="col" className="cell-num">
                          Direct Batch
                        </th>
                        <th scope="col" className="cell-num">
                          FIFO Sold
                        </th>
                        <th scope="col" className="cell-num">
                          Net Sold
                        </th>
                        <th scope="col" className="cell-num">
                          Remaining
                        </th>
                        <th scope="col" className="cell-num">
                          Sell-Through
                        </th>
                        <th scope="col" className="cell-num">
                          Avg Days
                        </th>
                        <th scope="col" className="cell-num">
                          Gross Margin
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.items.map((row, idx) => {
                        const isUnknownVendor =
                          row.batchSource === 'AUDIT_SURPLUS' || row.vendorId === null;
                        return (
                          <tr key={`${row.vendorId ?? 'unknown'}:${row.batchSource}:${idx}`}>
                            <th scope="row">{row.vendorName}</th>
                            <td data-label="Attribution Type">
                              <span
                                className={`report-attribution-pill ${
                                  isUnknownVendor
                                    ? 'report-attribution-pill--unknown'
                                    : 'report-attribution-pill--vendor'
                                }`}
                              >
                                {isUnknownVendor
                                  ? 'Unknown Attribution (Audit Surplus)'
                                  : 'Supplier Cohort (Direct + FIFO)'}
                              </span>
                            </td>
                            <td className="cell-num" data-label="Received">
                              {row.receivedUnits}
                            </td>
                            <td className="cell-num" data-label="Direct Batch">
                              {row.directBatchSoldUnits}
                            </td>
                            <td className="cell-num" data-label="FIFO Sold">
                              {row.fifoSoldUnits}
                            </td>
                            <td className="cell-num" data-label="Net Sold">
                              {row.netSoldUnits}
                            </td>
                            <td className="cell-num" data-label="Remaining">
                              {row.remainingSellableUnits}
                            </td>
                            <td className="cell-num" data-label="Sell-Through">
                              {row.sellThroughPercentage !== null
                                ? `${row.sellThroughPercentage}%`
                                : 'Unavailable'}
                            </td>
                            <td className="cell-num" data-label="Avg Days">
                              {row.weightedDaysFromReceiptToSale !== null
                                ? `${row.weightedDaysFromReceiptToSale} d`
                                : 'Unavailable'}
                            </td>
                            <td className="cell-num" data-label="Gross Margin">
                              {row.costComplete && row.grossMargin !== null ? (
                                formatSignedInrDisplay(row.grossMargin)
                              ) : (
                                <span className="report-unavailable-value">
                                  Unavailable (incomplete cost)
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
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
    </div>
  );
}
