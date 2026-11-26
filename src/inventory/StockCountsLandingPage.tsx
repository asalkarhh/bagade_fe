import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isAbortError, isApiClientError } from '../api/errors.ts';
import { catalogApi, type CatalogApi } from '../catalog/catalogApi.ts';
import { buildCategoryOptions } from '../catalog/categoryUtils.ts';
import type { Category } from '../catalog/types.ts';
import { formatShopTimestamp } from '../utils/shopDate.ts';
import { inventoryApi, type InventoryApi } from './inventoryApi.ts';
import { recordSessionStockCount, useRecentSessionStockCounts } from './sessionStockCounts.ts';
import type { StockCountScope } from './types.ts';
import '../catalog/ProductsPage.css';
import './Inventory.css';

export interface StockCountsLandingPageProps {
  api?: InventoryApi;
  catalog?: CatalogApi;
}

export function StockCountsLandingPage({
  api = inventoryApi,
  catalog = catalogApi,
}: StockCountsLandingPageProps) {
  const navigate = useNavigate();
  const categorySelectId = useId();
  const openCountInputId = useId();

  const [scope, setScope] = useState<StockCountScope>('SHOP');
  const [categoryId, setCategoryId] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [catReloadTick, setCatReloadTick] = useState(0);

  const [isCreating, setIsCreating] = useState(false);
  const [formError, setFormError] = useState<{ message: string; requestId?: string | null } | null>(
    null,
  );
  const [categoryFieldError, setCategoryFieldError] = useState<string | null>(null);

  const [openCountIdInput, setOpenCountIdInput] = useState('');
  const [openCountError, setOpenCountError] = useState<string | null>(null);

  const recentCounts = useRecentSessionStockCounts();

  useEffect(() => {
    document.title = 'Physical Stock Counts | Bagade Clothing';
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function loadCategories() {
      setLoadingCategories(true);
      setCategoryError(null);
      try {
        const list = await catalog.listAllCategories(controller.signal);
        if (!active || controller.signal.aborted) {
          return;
        }
        setCategories(list);
      } catch (err) {
        if (!active || isAbortError(err)) {
          return;
        }
        setCategoryError(
          isApiClientError(err) ? err.message : 'Unable to load product categories right now.',
        );
      } finally {
        if (active && !controller.signal.aborted) {
          setLoadingCategories(false);
        }
      }
    }

    void loadCategories();

    return () => {
      active = false;
      controller.abort();
    };
  }, [catalog, catReloadTick]);

  const categoryOptions = useMemo(() => buildCategoryOptions(categories), [categories]);

  const categoryLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of categoryOptions) {
      map.set(option.categoryId, option.label);
    }
    return map;
  }, [categoryOptions]);

  const handleStartCount = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setFormError(null);
      setCategoryFieldError(null);

      if (scope === 'CATEGORY' && !categoryId.trim()) {
        setCategoryFieldError('Select a category to start a category stock count.');
        return;
      }

      setIsCreating(true);
      try {
        const created = await api.createStockCount({
          scope,
          categoryId: scope === 'CATEGORY' ? categoryId : null,
        });

        const categoryLabel =
          created.scope === 'CATEGORY' && created.categoryId
            ? (categoryLabelMap.get(created.categoryId) ?? null)
            : null;

        recordSessionStockCount(
          {
            countId: created.countId,
            scope: created.scope,
            categoryId: created.categoryId,
            status: created.status,
            version: created.version,
            createdAt: new Date().toISOString(),
            postedAt: null,
            lines: created.scopedSkus.map((sku) => ({
              skuId: sku.skuId,
              skuCode: sku.skuCode,
              productName: sku.productName,
              size: sku.size,
              countedQuantity: null,
              expectedQuantity: null,
              currentQuantity: 0,
              observedStockVersion: null,
              currentStockVersion: 0,
              reason: null,
            })),
          },
          categoryLabel,
        );

        navigate(`/inventory/stock-counts/${encodeURIComponent(created.countId)}`);
      } catch (err) {
        if (isApiClientError(err)) {
          setFormError({ message: err.message, requestId: err.requestId });
        } else {
          setFormError({ message: 'Unable to start stock count. Please try again.' });
        }
      } finally {
        setIsCreating(false);
      }
    },
    [api, categoryId, categoryLabelMap, navigate, scope],
  );

  const handleOpenById = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = openCountIdInput.trim();
    if (!trimmed) {
      setOpenCountError('Enter a saved stock count ID to open.');
      return;
    }
    setOpenCountError(null);
    navigate(`/inventory/stock-counts/${encodeURIComponent(trimmed)}`);
  };

  return (
    <div className="products-page">
      <div className="products-header">
        <div className="products-header__title-group">
          <h1 id="main-content" tabIndex={-1}>
            Physical Stock Counts
          </h1>
          <p className="products-header__subtitle">
            Start a full-shop or category stock count, scan shelf tags, record discrepancies, and
            post inventory adjustments.
          </p>
        </div>

        <div className="products-header__actions">
          <Link to="/inventory" className="btn-secondary">
            Back to Inventory
          </Link>
        </div>
      </div>

      <section className="surface-card catalog-modal-form" aria-label="Start a new stock count">
        <h2>Start Stock Count</h2>
        <form className="catalog-modal-form" onSubmit={handleStartCount} noValidate>
          <fieldset className="catalog-status-fieldset">
            <legend>Count Scope</legend>
            <div className="stock-count-scope-grid">
              <label className="stock-count-scope-card">
                <input
                  type="radio"
                  name="stockCountScope"
                  value="SHOP"
                  checked={scope === 'SHOP'}
                  onChange={() => {
                    setScope('SHOP');
                    setCategoryFieldError(null);
                    setFormError(null);
                  }}
                />
                <span className="stock-count-scope-card__title">Whole Shop</span>
                <span className="stock-count-scope-card__desc">
                  Include all active SKUs across the store.
                </span>
              </label>

              <label className="stock-count-scope-card">
                <input
                  type="radio"
                  name="stockCountScope"
                  value="CATEGORY"
                  checked={scope === 'CATEGORY'}
                  onChange={() => {
                    setScope('CATEGORY');
                    setFormError(null);
                  }}
                />
                <span className="stock-count-scope-card__title">Specific Category</span>
                <span className="stock-count-scope-card__desc">
                  Include active SKUs in one category and all its subcategories.
                </span>
              </label>
            </div>
          </fieldset>

          {scope === 'CATEGORY' ? (
            <div className="catalog-field">
              <div className="catalog-label-row">
                <label htmlFor={categorySelectId} className="catalog-label">
                  Category
                </label>
                {categoryError ? (
                  <button
                    type="button"
                    className="catalog-inline-link"
                    onClick={() => setCatReloadTick((tick) => tick + 1)}
                  >
                    Retry categories
                  </button>
                ) : null}
              </div>

              <select
                id={categorySelectId}
                className="catalog-select"
                value={categoryId}
                disabled={loadingCategories || isCreating}
                aria-invalid={categoryFieldError ? 'true' : undefined}
                onChange={(event) => {
                  setCategoryId(event.target.value);
                  setCategoryFieldError(null);
                }}
              >
                <option value="">
                  {loadingCategories ? 'Loading categories…' : 'Select a category'}
                </option>
                {categoryOptions.map((option) => (
                  <option key={option.categoryId} value={option.categoryId}>
                    {option.label}
                  </option>
                ))}
              </select>

              {categoryFieldError ? (
                <p className="catalog-field-error" role="alert">
                  {categoryFieldError}
                </p>
              ) : null}
              {categoryError ? (
                <p className="catalog-field-error" role="alert">
                  {categoryError}
                </p>
              ) : null}
            </div>
          ) : null}

          {formError ? (
            <div className="alert-banner alert-banner--error" role="alert">
              <div className="alert-banner__content">
                <p>{formError.message}</p>
                {formError.requestId ? (
                  <p className="alert-banner__meta">Request ID: {formError.requestId}</p>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="catalog-modal-actions">
            <button type="submit" className="btn-primary" disabled={isCreating}>
              {isCreating ? 'Creating Draft…' : 'Start Stock Count'}
            </button>
          </div>
        </form>
      </section>

      <section className="surface-card catalog-modal-form" aria-label="Reopen stock count">
        <h2>Reopen Saved Stock Count</h2>
        <form className="stock-count-open-form" onSubmit={handleOpenById} noValidate>
          <div className="catalog-field stock-count-open-form__field">
            <label htmlFor={openCountInputId} className="catalog-label">
              Stock Count ID
            </label>
            <input
              id={openCountInputId}
              type="text"
              className="catalog-input"
              value={openCountIdInput}
              onChange={(event) => {
                setOpenCountIdInput(event.target.value);
                setOpenCountError(null);
              }}
              placeholder="Paste saved count ID (UUID)"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={openCountError ? 'true' : undefined}
            />
            {openCountError ? (
              <p className="catalog-field-error" role="alert">
                {openCountError}
              </p>
            ) : null}
          </div>
          <button type="submit" className="btn-secondary">
            Open Count
          </button>
        </form>

        {recentCounts.length > 0 ? (
          <div className="catalog-added-list">
            <span className="catalog-added-list__title">Counts opened in this session</span>
            <ul>
              {recentCounts.map((item) => (
                <li key={item.countId}>
                  <Link to={`/inventory/stock-counts/${encodeURIComponent(item.countId)}`}>
                    {item.scope === 'SHOP'
                      ? 'Whole Shop'
                      : item.categoryLabel || `Category (${item.categoryId ?? '—'})`}
                  </Link>{' '}
                  — <strong>{item.status}</strong> (v{item.version}) · {item.countedSkus}/
                  {item.totalSkus} SKUs counted · Created {formatShopTimestamp(item.createdAt)} ·{' '}
                  <code>{item.countId}</code>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="catalog-field-hint">
            No stock counts started or opened in this browser session yet.
          </p>
        )}

        <p className="catalog-field-hint">
          Note: The backend currently provides single-count endpoints (
          <code>POST /api/v1/stock-counts</code> and <code>GET /api/v1/stock-counts/&#123;id&#125;</code>)
          without a server-wide draft list endpoint. Bookmark or copy the draft page URL (or Count
          ID) to reopen saved drafts across browser restarts.
        </p>
      </section>
    </div>
  );
}
