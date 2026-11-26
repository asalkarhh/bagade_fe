import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { isAbortError, isApiClientError } from '../api/errors.ts';
import { catalogApi, type CatalogApi } from '../catalog/catalogApi.ts';
import { buildCategoryOptions } from '../catalog/categoryUtils.ts';
import type { Category, SkuListItem } from '../catalog/types.ts';
import { SkuPickerModal } from '../purchasing/components/SkuPickerModal.tsx';
import { formatShopTimestamp, getShopLocalDateIso, getShopMonthStartDateIso } from '../utils/shopDate.ts';
import { ReportErrorBanner } from './components/ReportErrorBanner.tsx';
import { ReportPagination } from './components/ReportPagination.tsx';
import { formatSignedCountDelta, validateDateRange } from './reportUtils.ts';
import { reportsApi, type ReportsApi } from './reportsApi.ts';
import type { StockAuditReport } from './types.ts';
import '../catalog/ProductsPage.css';
import './Reports.css';

export interface StockAuditReportPageProps {
  api?: ReportsApi;
  catalog?: CatalogApi;
}

const DEFAULT_PAGE_SIZE = 25;

interface AuditQueryState {
  key: string;
  data: StockAuditReport | null;
  error: { message: string; requestId?: string | null } | null;
}

export function StockAuditReportPage({
  api = reportsApi,
  catalog = catalogApi,
}: StockAuditReportPageProps) {
  const fromId = useId();
  const toId = useId();
  const catId = useId();
  const pageSizeId = useId();
  const tableHeadingId = useId();

  const defaultFrom = useMemo(() => getShopMonthStartDateIso(), []);
  const defaultTo = useMemo(() => getShopLocalDateIso(), []);

  const [fromInput, setFromInput] = useState(defaultFrom);
  const [toInput, setToInput] = useState(defaultTo);
  const [categoryInput, setCategoryInput] = useState('');
  const [selectedSku, setSelectedSku] = useState<SkuListItem | null>(null);

  const [appliedFilters, setAppliedFilters] = useState({
    from: defaultFrom,
    to: defaultTo,
    categoryId: '',
    skuId: '',
  });
  const [validationError, setValidationError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [refreshTick, setRefreshTick] = useState(0);

  const [categories, setCategories] = useState<Category[]>([]);
  const [skuModalOpen, setSkuModalOpen] = useState(false);
  const [queryState, setQueryState] = useState<AuditQueryState | null>(null);

  const requestSeqRef = useRef(0);

  useEffect(() => {
    document.title = 'Stock Audit Report | Bagade Clothing';
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    catalog
      .listAllCategories(controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) {
          setCategories(list);
        }
      })
      .catch(() => {
        // Report works without category list.
      });
    return () => controller.abort();
  }, [catalog]);

  const categoryOptions = useMemo(() => buildCategoryOptions(categories), [categories]);

  const activeKey = useMemo(
    () => JSON.stringify({ ...appliedFilters, page, pageSize, refreshTick }),
    [appliedFilters, page, pageSize, refreshTick],
  );

  useEffect(() => {
    const controller = new AbortController();
    const seq = ++requestSeqRef.current;

    api
      .getStockAuditReport(
        {
          from: appliedFilters.from,
          to: appliedFilters.to,
          categoryId: appliedFilters.categoryId || null,
          skuId: appliedFilters.skuId || null,
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
            : { message: 'Unable to load the stock audit report right now.' },
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
      categoryId: categoryInput,
      skuId: selectedSku?.skuId ?? '',
    });
    setPage(0);
  };

  const handleReset = () => {
    setFromInput(defaultFrom);
    setToInput(defaultTo);
    setCategoryInput('');
    setSelectedSku(null);
    setValidationError(null);
    setAppliedFilters({
      from: defaultFrom,
      to: defaultTo,
      categoryId: '',
      skuId: '',
    });
    setPage(0);
  };

  const isLoading = queryState === null || queryState.key !== activeKey;
  const report = queryState?.key === activeKey ? queryState.data : null;
  const error = queryState?.key === activeKey ? queryState.error : null;

  return (
    <div className="products-page">
      <section className="surface-card catalog-filters-card" aria-label="Stock audit filters">
        <form className="catalog-filters-form" onSubmit={handleApply} noValidate>
          <div className="catalog-filter-field">
            <label htmlFor={fromId} className="catalog-label">
              Posted From
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
              Posted To
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

          <div className="catalog-filter-field catalog-filter-field--category">
            <label htmlFor={catId} className="catalog-label">
              Category
            </label>
            <select
              id={catId}
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

          <div className="catalog-filter-field">
            <span className="catalog-label">SKU Filter</span>
            <div className="report-filter-chip-row">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSkuModalOpen(true)}
              >
                {selectedSku ? 'Change SKU' : 'Filter by SKU'}
              </button>
              {selectedSku ? (
                <span className="report-filter-chip">
                  <span>
                    {selectedSku.skuCode}
                    {selectedSku.size ? ` (${selectedSku.size})` : ''}
                  </span>
                  <button
                    type="button"
                    className="catalog-inline-link"
                    onClick={() => setSelectedSku(null)}
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
          <p>Loading posted physical stock audit lines…</p>
        </section>
      ) : null}

      {report ? (
        <>
          <section aria-label="Stock audit adjustment totals">
            <div className="report-kpi-grid">
              <div className="report-kpi-card">
                <span className="report-kpi-card__label">Posted Count Lines</span>
                <span className="report-kpi-card__value">{report.total}</span>
                <span className="report-kpi-card__note">
                  {report.from} to {report.to}
                </span>
              </div>

              <div className="report-kpi-card">
                <span className="report-kpi-card__label">Surplus Found (+)</span>
                <span className="report-kpi-card__value">+{report.totalPositiveAdjustment}</span>
              </div>

              <div className="report-kpi-card">
                <span className="report-kpi-card__label">Shortages (-)</span>
                <span className="report-kpi-card__value">-{report.totalNegativeAdjustment}</span>
              </div>

              <div className="report-kpi-card report-kpi-card--highlight">
                <span className="report-kpi-card__label">Net Stock Adjustment</span>
                <span className="report-kpi-card__value">
                  {formatSignedCountDelta(report.netAdjustment)}
                </span>
              </div>
            </div>
          </section>

          <section className="surface-card catalog-results-card" aria-label="Posted audit lines table">
            <div className="catalog-results-bar">
              <div>
                <h2 id={tableHeadingId} className="catalog-results-count">
                  {report.total === 0
                    ? '0 posted stock audits'
                    : `${report.total} posted audit line${report.total === 1 ? '' : 's'} (including exact matches)`}
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
                <p>No posted stock counts matched the selected date range, category, or SKU filter.</p>
                <button type="button" className="btn-secondary" onClick={handleReset}>
                  Reset Filters
                </button>
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
                        <th scope="col">Product</th>
                        <th scope="col">SKU</th>
                        <th scope="col">Size</th>
                        <th scope="col" className="cell-num">
                          Expected
                        </th>
                        <th scope="col" className="cell-num">
                          Counted
                        </th>
                        <th scope="col" className="cell-num">
                          Adjustment
                        </th>
                        <th scope="col">Reason</th>
                        <th scope="col">Posted By</th>
                        <th scope="col">Posted At</th>
                        <th scope="col">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.items.map((row) => (
                        <tr key={row.countLineId}>
                          <th scope="row">{row.productName}</th>
                          <td className="cell-code" data-label="SKU">
                            <code>{row.skuCode}</code>
                          </td>
                          <td data-label="Size">{row.size || '—'}</td>
                          <td className="cell-num" data-label="Expected">
                            {row.expectedQuantity}
                          </td>
                          <td className="cell-num" data-label="Counted">
                            {row.countedQuantity}
                          </td>
                          <td className="cell-num" data-label="Adjustment">
                            {formatSignedCountDelta(row.adjustment)}
                          </td>
                          <td data-label="Reason">{row.reason || 'Exact match — none required'}</td>
                          <td data-label="Posted By">
                            {row.postedByDisplayName} (<code>{row.postedByUsername}</code>)
                          </td>
                          <td data-label="Posted At">{formatShopTimestamp(row.postedAt)}</td>
                          <td data-label="Count">
                            <Link
                              to={`/inventory/stock-counts/${encodeURIComponent(row.stockCountId)}`}
                              className="po-link"
                            >
                              {row.scope === 'SHOP' ? 'Shop' : 'Category'}
                            </Link>
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

      <SkuPickerModal
        open={skuModalOpen}
        api={catalog}
        onClose={() => setSkuModalOpen(false)}
        onSelect={(sku) => {
          setSelectedSku(sku);
          setSkuModalOpen(false);
        }}
      />
    </div>
  );
}
