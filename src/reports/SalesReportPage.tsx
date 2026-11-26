import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { isAbortError, isApiClientError } from '../api/errors.ts';
import { catalogApi, type CatalogApi } from '../catalog/catalogApi.ts';
import { buildCategoryOptions } from '../catalog/categoryUtils.ts';
import type { Category, SkuListItem } from '../catalog/types.ts';
import { SkuPickerModal } from '../purchasing/components/SkuPickerModal.tsx';
import { formatInrDisplay, formatSignedInrDisplay } from '../utils/inrPrice.ts';
import { getShopLocalDateIso, getShopMonthStartDateIso } from '../utils/shopDate.ts';
import { ReportErrorBanner } from './components/ReportErrorBanner.tsx';
import { ReportPagination } from './components/ReportPagination.tsx';
import {
  formatReportMoneyOrUnavailable,
  validateDateRange,
  validateOptionalPriceRange,
} from './reportUtils.ts';
import { reportsApi, type ReportsApi } from './reportsApi.ts';
import type { SalesReport } from './types.ts';
import '../catalog/ProductsPage.css';
import './Reports.css';

export interface SalesReportPageProps {
  api?: ReportsApi;
  catalog?: CatalogApi;
}

const DEFAULT_PAGE_SIZE = 25;

interface SalesQueryState {
  key: string;
  data: SalesReport | null;
  error: { message: string; requestId?: string | null } | null;
}

export function SalesReportPage({
  api = reportsApi,
  catalog = catalogApi,
}: SalesReportPageProps) {
  const fromId = useId();
  const toId = useId();
  const catId = useId();
  const minPriceId = useId();
  const maxPriceId = useId();
  const pageSizeId = useId();
  const tableHeadingId = useId();

  const defaultFrom = useMemo(() => getShopMonthStartDateIso(), []);
  const defaultTo = useMemo(() => getShopLocalDateIso(), []);

  const [fromInput, setFromInput] = useState(defaultFrom);
  const [toInput, setToInput] = useState(defaultTo);
  const [categoryInput, setCategoryInput] = useState('');
  const [selectedSku, setSelectedSku] = useState<SkuListItem | null>(null);
  const [minPriceInput, setMinPriceInput] = useState('');
  const [maxPriceInput, setMaxPriceInput] = useState('');

  const [appliedFilters, setAppliedFilters] = useState({
    from: defaultFrom,
    to: defaultTo,
    categoryId: '',
    skuId: '',
    minPrice: '',
    maxPrice: '',
  });
  const [validationError, setValidationError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [refreshTick, setRefreshTick] = useState(0);

  const [categories, setCategories] = useState<Category[]>([]);
  const [skuModalOpen, setSkuModalOpen] = useState(false);
  const [queryState, setQueryState] = useState<SalesQueryState | null>(null);

  const requestSeqRef = useRef(0);

  useEffect(() => {
    document.title = 'Sales & Profit Report | Bagade Clothing';
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
        // Report still works cleanly without category dropdown options.
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
      .getSalesReport(
        {
          from: appliedFilters.from,
          to: appliedFilters.to,
          categoryId: appliedFilters.categoryId || null,
          skuId: appliedFilters.skuId || null,
          minPrice: appliedFilters.minPrice || undefined,
          maxPrice: appliedFilters.maxPrice || undefined,
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
            : { message: 'Unable to load the sales report right now.' },
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
    const priceCheck = validateOptionalPriceRange(minPriceInput, maxPriceInput);
    if (!priceCheck.ok) {
      setValidationError(priceCheck.error);
      return;
    }

    setValidationError(null);
    setAppliedFilters({
      from: fromInput.trim(),
      to: toInput.trim(),
      categoryId: categoryInput,
      skuId: selectedSku?.skuId ?? '',
      minPrice: priceCheck.minPrice ?? '',
      maxPrice: priceCheck.maxPrice ?? '',
    });
    setPage(0);
  };

  const handleReset = () => {
    setFromInput(defaultFrom);
    setToInput(defaultTo);
    setCategoryInput('');
    setSelectedSku(null);
    setMinPriceInput('');
    setMaxPriceInput('');
    setValidationError(null);
    setAppliedFilters({
      from: defaultFrom,
      to: defaultTo,
      categoryId: '',
      skuId: '',
      minPrice: '',
      maxPrice: '',
    });
    setPage(0);
  };

  const isLoading = queryState === null || queryState.key !== activeKey;
  const report = queryState?.key === activeKey ? queryState.data : null;
  const error = queryState?.key === activeKey ? queryState.error : null;

  const isWholeShopView =
    report !== null &&
    report.categoryId === null &&
    report.skuId === null &&
    report.minPrice === null &&
    report.maxPrice === null;

  return (
    <div className="products-page">
      <section className="surface-card catalog-filters-card" aria-label="Sales report filters">
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
              To Date
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
              <option value="">All categories (Whole Shop)</option>
              {categoryOptions.map((opt) => (
                <option key={opt.categoryId} value={opt.categoryId}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="catalog-filter-field">
            <label htmlFor={minPriceId} className="catalog-label">
              Min Selling Price (INR)
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
              Max Selling Price (INR)
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
          <p>Loading sales and profit summary…</p>
        </section>
      ) : null}

      {report ? (
        <>
          {!report.costComplete ? (
            <div className="alert-banner alert-banner--warning" role="status">
              <div className="alert-banner__content">
                <p>
                  <strong>Margin is incomplete:</strong> Some sold units lack recorded purchase
                  cost (for example, audit surplus stock). Unavailable cost and profit figures are
                  shown as unavailable rather than <code>₹0.00</code>.
                </p>
              </div>
            </div>
          ) : null}

          {!isWholeShopView ? (
            <div className="alert-banner alert-banner--info" role="status">
              <div className="alert-banner__content">
                <p>
                  Showing filtered category/SKU/price sales metrics. Whole-shop operating expenses
                  are not subtracted from filtered views.
                </p>
              </div>
            </div>
          ) : null}

          <section aria-label="Sales totals across matching records">
            <div className="report-kpi-grid">
              <div className="report-kpi-card">
                <span className="report-kpi-card__label">Net Units Sold</span>
                <span className="report-kpi-card__value">{report.netUnitsSold}</span>
                <span className="report-kpi-card__note">
                  {report.from} to {report.to}
                </span>
              </div>

              <div className="report-kpi-card">
                <span className="report-kpi-card__label">Net Sales</span>
                <span className="report-kpi-card__value">
                  {formatSignedInrDisplay(report.netSales)}
                </span>
              </div>

              <div className="report-kpi-card">
                <span className="report-kpi-card__label">Cost of Goods Sold</span>
                <span
                  className={`report-kpi-card__value${
                    !report.costComplete || report.cogs === null ? ' report-unavailable-value' : ''
                  }`}
                >
                  {formatReportMoneyOrUnavailable(
                    report.cogs,
                    report.costComplete,
                    'Unavailable (missing cost)',
                  )}
                </span>
              </div>

              <div className="report-kpi-card report-kpi-card--highlight">
                <span className="report-kpi-card__label">Gross Profit</span>
                <span
                  className={`report-kpi-card__value${
                    !report.costComplete || report.grossProfit === null
                      ? ' report-unavailable-value'
                      : ''
                  }`}
                >
                  {formatReportMoneyOrUnavailable(
                    report.grossProfit,
                    report.costComplete,
                    'Unavailable (margin incomplete)',
                  )}
                </span>
              </div>

              {isWholeShopView ? (
                <>
                  <div className="report-kpi-card">
                    <span className="report-kpi-card__label">Operating Expenses</span>
                    <span className="report-kpi-card__value">
                      {report.operatingExpenses !== null
                        ? formatSignedInrDisplay(report.operatingExpenses)
                        : 'Unavailable'}
                    </span>
                    <span className="report-kpi-card__note">Whole-shop expenses in period</span>
                  </div>

                  <div className="report-kpi-card report-kpi-card--highlight">
                    <span className="report-kpi-card__label">Estimated Profit</span>
                    <span
                      className={`report-kpi-card__value${
                        !report.costComplete || report.estimatedProfit === null
                          ? ' report-unavailable-value'
                          : ''
                      }`}
                    >
                      {formatReportMoneyOrUnavailable(
                        report.estimatedProfit,
                        report.costComplete,
                        'Unavailable (margin incomplete)',
                      )}
                    </span>
                    <span className="report-kpi-card__note">Gross profit minus expenses</span>
                  </div>
                </>
              ) : null}

              <div className="report-kpi-card">
                <span className="report-kpi-card__label">Non-Sellable Returns</span>
                <span className="report-kpi-card__value">{report.nonSellableReturnUnits} pcs</span>
                <span className="report-kpi-card__note">
                  Sales val: {formatInrDisplay(report.nonSellableReturnSalesValue)} · Cost:{' '}
                  {report.nonSellableReturnCost !== null
                    ? formatInrDisplay(report.nonSellableReturnCost)
                    : 'Unavailable'}
                </span>
              </div>
            </div>
          </section>

          <section className="surface-card catalog-results-card" aria-label="SKU sales breakdown">
            <div className="catalog-results-bar">
              <div>
                <h2 id={tableHeadingId} className="catalog-results-count">
                  {report.total === 0
                    ? '0 SKUs sold in period'
                    : `${report.total} SKU${report.total === 1 ? '' : 's'} in period`}
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
                <p>No sales activity matched the selected date range or filters.</p>
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
                          Net Sold
                        </th>
                        <th scope="col" className="cell-num">
                          Net Sales
                        </th>
                        <th scope="col" className="cell-num">
                          COGS
                        </th>
                        <th scope="col" className="cell-num">
                          Gross Profit
                        </th>
                        <th scope="col">Cost Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.items.map((item) => (
                        <tr key={item.skuId}>
                          <th scope="row">{item.productName}</th>
                          <td className="cell-code" data-label="SKU">
                            <code>{item.skuCode}</code>
                          </td>
                          <td data-label="Size">{item.size || '—'}</td>
                          <td className="cell-num" data-label="Net Sold">
                            {item.netUnitsSold}
                          </td>
                          <td className="cell-num" data-label="Net Sales">
                            {formatSignedInrDisplay(item.netSales)}
                          </td>
                          <td className="cell-num" data-label="COGS">
                            {item.costComplete && item.cogs !== null ? (
                              formatSignedInrDisplay(item.cogs)
                            ) : (
                              <span className="report-unavailable-value">Unavailable</span>
                            )}
                          </td>
                          <td className="cell-num" data-label="Gross Profit">
                            {item.costComplete && item.grossProfit !== null ? (
                              formatSignedInrDisplay(item.grossProfit)
                            ) : (
                              <span className="report-unavailable-value">Unavailable</span>
                            )}
                          </td>
                          <td data-label="Cost Status">
                            {item.costComplete ? 'Complete' : 'Incomplete cost'}
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
