import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { isAbortError, isApiClientError } from '../api/errors.ts';
import { catalogApi, type CatalogApi } from '../catalog/catalogApi.ts';
import { buildCategoryOptions } from '../catalog/categoryUtils.ts';
import type { Category, SkuListItem } from '../catalog/types.ts';
import { SkuPickerModal } from '../purchasing/components/SkuPickerModal.tsx';
import { purchasingApi, type PurchasingApi } from '../purchasing/purchasingApi.ts';
import type { Vendor } from '../purchasing/types.ts';
import { formatInrDisplay } from '../utils/inrPrice.ts';
import { ReportErrorBanner } from './components/ReportErrorBanner.tsx';
import { ReportPagination } from './components/ReportPagination.tsx';
import { formatReportMoneyOrUnavailable } from './reportUtils.ts';
import { reportsApi, type ReportsApi } from './reportsApi.ts';
import type { StockAgeingReport } from './types.ts';
import '../catalog/ProductsPage.css';
import './Reports.css';

export interface StockAgeingReportPageProps {
  api?: ReportsApi;
  catalog?: CatalogApi;
  purchasing?: PurchasingApi;
}

const DEFAULT_PAGE_SIZE = 25;

interface AgeingQueryState {
  key: string;
  data: StockAgeingReport | null;
  error: { message: string; requestId?: string | null } | null;
}

export function StockAgeingReportPage({
  api = reportsApi,
  catalog = catalogApi,
  purchasing = purchasingApi,
}: StockAgeingReportPageProps) {
  const catId = useId();
  const vendorIdFilterId = useId();
  const pageSizeId = useId();
  const tableHeadingId = useId();

  const [categoryInput, setCategoryInput] = useState('');
  const [vendorInput, setVendorInput] = useState('');
  const [selectedSku, setSelectedSku] = useState<SkuListItem | null>(null);

  const [appliedFilters, setAppliedFilters] = useState({
    categoryId: '',
    vendorId: '',
    skuId: '',
  });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [refreshTick, setRefreshTick] = useState(0);

  const [categories, setCategories] = useState<Category[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [skuModalOpen, setSkuModalOpen] = useState(false);
  const [queryState, setQueryState] = useState<AgeingQueryState | null>(null);

  const requestSeqRef = useRef(0);

  useEffect(() => {
    document.title = 'Stock Ageing Report | Bagade Clothing';
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
      .getStockAgeingReport(
        {
          categoryId: appliedFilters.categoryId || null,
          skuId: appliedFilters.skuId || null,
          vendorId: appliedFilters.vendorId || null,
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
            : { message: 'Unable to load the stock ageing report right now.' },
        });
      });

    return () => controller.abort();
  }, [activeKey, api, appliedFilters, page, pageSize]);

  const handleApply = (event: FormEvent) => {
    event.preventDefault();
    setAppliedFilters({
      categoryId: categoryInput,
      vendorId: vendorInput,
      skuId: selectedSku?.skuId ?? '',
    });
    setPage(0);
  };

  const handleReset = () => {
    setCategoryInput('');
    setVendorInput('');
    setSelectedSku(null);
    setAppliedFilters({ categoryId: '', vendorId: '', skuId: '' });
    setPage(0);
  };

  const isLoading = queryState === null || queryState.key !== activeKey;
  const report = queryState?.key === activeKey ? queryState.data : null;
  const error = queryState?.key === activeKey ? queryState.error : null;

  return (
    <div className="products-page">
      <section className="surface-card catalog-filters-card" aria-label="Stock ageing filters">
        <form className="catalog-filters-form" onSubmit={handleApply} noValidate>
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
              Reset Filters
            </button>
          </div>
        </form>
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
          <p>Loading sellable inventory batches and ageing metrics…</p>
        </section>
      ) : null}

      {report ? (
        <>
          {report.unknownReceiptDateUnits > 0 || report.unknownCostUnits > 0 ? (
            <div className="alert-banner alert-banner--warning" role="status">
              <div className="alert-banner__content">
                <p>
                  <strong>Incomplete batch metadata present:</strong> {report.unknownReceiptDateUnits}{' '}
                  sellable unit(s) have an unknown receipt date and {report.unknownCostUnits}{' '}
                  sellable unit(s) have an unknown unit cost. Those batches remain visible with
                  unavailable age or cost rather than invented values.
                </p>
              </div>
            </div>
          ) : null}

          <section aria-label="Stock ageing totals">
            <div className="report-kpi-grid">
              <div className="report-kpi-card">
                <span className="report-kpi-card__label">Total Sellable Stock</span>
                <span className="report-kpi-card__value">{report.totalSellableUnits} pcs</span>
                <span className="report-kpi-card__note">As of {report.asOfDate}</span>
              </div>

              <div className="report-kpi-card report-kpi-card--highlight">
                <span className="report-kpi-card__label">Known Stock Value</span>
                <span
                  className={`report-kpi-card__value${
                    !report.costComplete || report.totalStockValue === null
                      ? ' report-unavailable-value'
                      : ''
                  }`}
                >
                  {formatReportMoneyOrUnavailable(
                    report.totalStockValue,
                    report.costComplete,
                    'Unavailable (unknown-cost units present)',
                  )}
                </span>
              </div>

              <div className="report-kpi-card">
                <span className="report-kpi-card__label">Unknown Date Units</span>
                <span className="report-kpi-card__value">{report.unknownReceiptDateUnits} pcs</span>
              </div>

              <div className="report-kpi-card">
                <span className="report-kpi-card__label">Unknown Cost Units</span>
                <span className="report-kpi-card__value">{report.unknownCostUnits} pcs</span>
              </div>
            </div>
          </section>

          <section className="surface-card catalog-results-card" aria-label="Batch ageing table">
            <div className="catalog-results-bar">
              <div>
                <h2 id={tableHeadingId} className="catalog-results-count">
                  {report.total === 0
                    ? '0 sellable batches'
                    : `${report.total} active sellable batch${report.total === 1 ? '' : 'es'}`}
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
                <p>No active sellable batches matched the selected filters.</p>
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
                        <th scope="col">Batch / Source</th>
                        <th scope="col">Vendor</th>
                        <th scope="col">Received Date</th>
                        <th scope="col" className="cell-num">
                          Days on Hand
                        </th>
                        <th scope="col" className="cell-num">
                          Sellable Qty
                        </th>
                        <th scope="col" className="cell-num">
                          Unit Cost
                        </th>
                        <th scope="col" className="cell-num">
                          Stock Value
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.items.map((row) => (
                        <tr key={row.batchId}>
                          <th scope="row">{row.productName}</th>
                          <td className="cell-code" data-label="SKU">
                            <code>{row.skuCode}</code>
                          </td>
                          <td data-label="Size">{row.size || '—'}</td>
                          <td className="cell-code" data-label="Batch / Source">
                            <code>{row.batchId.slice(0, 8)}</code>{' '}
                            <span className="catalog-field-hint">
                              ({row.batchSource === 'AUDIT_SURPLUS' ? 'Audit Surplus' : 'Receipt'})
                            </span>
                          </td>
                          <td data-label="Vendor">{row.vendorName}</td>
                          <td data-label="Received Date">
                            {row.receiptDateKnown && row.receiptDate ? (
                              row.receiptDate
                            ) : (
                              <span className="report-unavailable-value">Unknown receipt date</span>
                            )}
                          </td>
                          <td className="cell-num" data-label="Days on Hand">
                            {row.receiptDateKnown && row.daysOnHand !== null ? (
                              `${row.daysOnHand} d`
                            ) : (
                              <span className="report-unavailable-value">Age unavailable</span>
                            )}
                          </td>
                          <td className="cell-num" data-label="Sellable Qty">
                            {row.sellableQuantity}
                          </td>
                          <td className="cell-num" data-label="Unit Cost">
                            {row.costKnown && row.unitCost !== null ? (
                              formatInrDisplay(row.unitCost)
                            ) : (
                              <span className="report-unavailable-value">Unknown cost</span>
                            )}
                          </td>
                          <td className="cell-num" data-label="Stock Value">
                            {row.costKnown && row.stockValue !== null ? (
                              formatInrDisplay(row.stockValue)
                            ) : (
                              <span className="report-unavailable-value">Value unavailable</span>
                            )}
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
