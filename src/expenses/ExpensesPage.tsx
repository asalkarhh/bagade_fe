import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { isAbortError, isApiClientError } from '../api/errors.ts';
import { formatInrDisplay, formatPaiseToInr, parseInrToPaise } from '../utils/inrPrice.ts';
import { ExpenseFormModal } from './components/ExpenseFormModal.tsx';
import { expensesApi, type ExpensesApi } from './expensesApi.ts';
import { OPERATING_EXPENSE_CATEGORY_SUGGESTIONS, type Expense } from './types.ts';
import '../catalog/ProductsPage.css';

export interface ExpensesPageProps {
  api?: ExpensesApi;
}

const DEFAULT_PAGE_SIZE = 25;

interface ExpensesQueryState {
  key: string;
  items: Expense[];
  total: number;
  error: { message: string; requestId?: string | null } | null;
}

export function ExpensesPage({ api = expensesApi }: ExpensesPageProps) {
  const fromDateId = useId();
  const toDateId = useId();
  const categoryFilterId = useId();
  const categoryListId = useId();
  const pageSizeId = useId();
  const tableHeadingId = useId();

  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [categoryInput, setCategoryInput] = useState('');

  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');
  const [appliedCategory, setAppliedCategory] = useState('');
  const [filterValidationError, setFilterValidationError] = useState<string | null>(null);

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [refreshTick, setRefreshTick] = useState(0);

  const [queryState, setQueryState] = useState<ExpensesQueryState | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [modalState, setModalState] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    expense: Expense | null;
  }>({
    open: false,
    mode: 'create',
    expense: null,
  });

  const requestSeqRef = useRef(0);

  useEffect(() => {
    document.title = 'Operating Expenses | Bagade Clothing';
  }, []);

  const currentQueryKey = useMemo(
    () =>
      JSON.stringify({
        from: appliedFrom,
        to: appliedTo,
        category: appliedCategory,
        page,
        size: pageSize,
      }),
    [appliedCategory, appliedFrom, appliedTo, page, pageSize],
  );

  const fetchExpensesNow = useCallback(
    async (signal?: AbortSignal): Promise<readonly Expense[]> => {
      const requestSeq = ++requestSeqRef.current;
      const result = await api.listExpenses(
        {
          from: appliedFrom || undefined,
          to: appliedTo || undefined,
          category: appliedCategory || undefined,
          page,
          size: pageSize,
        },
        signal,
      );

      if (signal?.aborted || requestSeq !== requestSeqRef.current) {
        return result.items;
      }

      setQueryState({
        key: currentQueryKey,
        items: result.items,
        total: result.total,
        error: null,
      });
      return result.items;
    },
    [api, appliedCategory, appliedFrom, appliedTo, currentQueryKey, page, pageSize],
  );

  useEffect(() => {
    const controller = new AbortController();
    const requestSeq = ++requestSeqRef.current;

    async function load() {
      try {
        const result = await api.listExpenses(
          {
            from: appliedFrom || undefined,
            to: appliedTo || undefined,
            category: appliedCategory || undefined,
            page,
            size: pageSize,
          },
          controller.signal,
        );

        if (controller.signal.aborted || requestSeq !== requestSeqRef.current) {
          return;
        }

        setQueryState({
          key: currentQueryKey,
          items: result.items,
          total: result.total,
          error: null,
        });
      } catch (err) {
        if (controller.signal.aborted || isAbortError(err) || requestSeq !== requestSeqRef.current) {
          return;
        }
        setQueryState((prev) => ({
          key: currentQueryKey,
          items: prev?.items ?? [],
          total: prev?.total ?? 0,
          error: isApiClientError(err)
            ? { message: err.message, requestId: err.requestId }
            : { message: 'Unable to load expenses right now.' },
        }));
      }
    }

    void load();

    return () => {
      controller.abort();
    };
  }, [api, appliedCategory, appliedFrom, appliedTo, currentQueryKey, page, pageSize, refreshTick]);

  const isLoading = queryState === null || queryState.key !== currentQueryKey;
  const items = useMemo(() => queryState?.items ?? [], [queryState]);
  const totalItems = queryState?.total ?? 0;
  const error = queryState?.key === currentQueryKey ? queryState.error : null;

  const knownCategories = useMemo(() => {
    const set = new Set<string>(OPERATING_EXPENSE_CATEGORY_SUGGESTIONS);
    for (const item of items) {
      if (item.category.trim()) {
        set.add(item.category.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const pageTotalDisplay = useMemo(() => {
    let totalPaise = 0;
    for (const item of items) {
      const p = parseInrToPaise(item.amount);
      if (p !== null) {
        totalPaise += p;
      }
    }
    return formatInrDisplay(formatPaiseToInr(totalPaise));
  }, [items]);

  const handleApplyFilters = (event: FormEvent) => {
    event.preventDefault();
    setFilterValidationError(null);

    if (fromInput && toInput && fromInput > toInput) {
      setFilterValidationError('Start date ("From") must be on or before end date ("To").');
      return;
    }

    setAppliedFrom(fromInput.trim());
    setAppliedTo(toInput.trim());
    setAppliedCategory(categoryInput.trim());
    setPage(0);
  };

  const handleResetFilters = () => {
    setFromInput('');
    setToInput('');
    setCategoryInput('');
    setAppliedFrom('');
    setAppliedTo('');
    setAppliedCategory('');
    setFilterValidationError(null);
    setPage(0);
  };

  const handleOpenCreate = () => {
    setStatusMessage(null);
    setModalState({ open: true, mode: 'create', expense: null });
  };

  const handleOpenEdit = (expense: Expense) => {
    setStatusMessage(null);
    setModalState({ open: true, mode: 'edit', expense });
  };

  const handleModalSaved = (savedExpense: Expense, savedMode: 'create' | 'edit') => {
    setModalState({ open: false, mode: 'create', expense: null });
    setStatusMessage(
      savedMode === 'create'
        ? `Recorded expense: ${savedExpense.category} (${formatInrDisplay(savedExpense.amount)}) on ${savedExpense.expenseDate}.`
        : `Updated expense: ${savedExpense.category} (${formatInrDisplay(savedExpense.amount)}) on ${savedExpense.expenseDate}.`,
    );
    setRefreshTick((tick) => tick + 1);
  };

  const hasActiveFilters = Boolean(appliedFrom || appliedTo || appliedCategory);
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const rangeStart = totalItems === 0 ? 0 : page * pageSize + 1;
  const rangeEnd = Math.min(totalItems, page * pageSize + items.length);

  return (
    <div className="products-page">
      <div className="products-header">
        <div className="products-header__title-group">
          <h1 id="main-content" tabIndex={-1}>
            Operating Expenses
          </h1>
          <p className="products-header__subtitle">
            Record day-to-day shop operating expenses such as rent, utilities, transport, and
            alteration costs. Vendor merchandise purchases belong under{' '}
            <Link to="/purchases/receive">Purchases / Stock Receiving</Link>.
          </p>
        </div>

        <div className="products-header__actions">
          <button type="button" className="btn-primary" onClick={handleOpenCreate}>
            Add Expense
          </button>
        </div>
      </div>

      {statusMessage ? (
        <div className="alert-banner alert-banner--info" role="status">
          <div className="alert-banner__content">
            <p>{statusMessage}</p>
          </div>
        </div>
      ) : null}

      <section className="surface-card catalog-filters-card" aria-label="Expense filters">
        <search>
          <form className="catalog-filters-form" onSubmit={handleApplyFilters} noValidate>
            <div className="catalog-filter-field">
              <label htmlFor={fromDateId} className="catalog-label">
                From Date
              </label>
              <input
                id={fromDateId}
                type="date"
                className="catalog-input"
                value={fromInput}
                onChange={(event) => {
                  setFromInput(event.target.value);
                  setFilterValidationError(null);
                }}
              />
            </div>

            <div className="catalog-filter-field">
              <label htmlFor={toDateId} className="catalog-label">
                To Date
              </label>
              <input
                id={toDateId}
                type="date"
                className="catalog-input"
                value={toInput}
                onChange={(event) => {
                  setToInput(event.target.value);
                  setFilterValidationError(null);
                }}
              />
            </div>

            <div className="catalog-filter-field catalog-filter-field--category">
              <label htmlFor={categoryFilterId} className="catalog-label">
                Category (exact match)
              </label>
              <input
                id={categoryFilterId}
                type="search"
                list={categoryListId}
                className="catalog-input"
                value={categoryInput}
                onChange={(event) => setCategoryInput(event.target.value)}
                placeholder="e.g. Rent"
                enterKeyHint="search"
              />
              <datalist id={categoryListId}>
                {knownCategories.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </div>

            <div className="catalog-filter-actions">
              <button type="submit" className="btn-primary">
                Apply Filters
              </button>
              {hasActiveFilters || fromInput || toInput || categoryInput ? (
                <button type="button" className="btn-secondary" onClick={handleResetFilters}>
                  Reset Filters
                </button>
              ) : null}
            </div>
          </form>
        </search>

        {filterValidationError ? (
          <p className="catalog-field-error" role="alert">
            {filterValidationError}
          </p>
        ) : null}
      </section>

      <section className="surface-card catalog-results-card" aria-label="Expenses list">
        <div className="catalog-results-bar">
          <div>
            <h2 id={tableHeadingId} className="catalog-results-count">
              {totalItems === 0
                ? '0 expenses'
                : `Showing ${rangeStart}–${rangeEnd} of ${totalItems} expense${totalItems === 1 ? '' : 's'}`}
            </h2>
            {items.length > 0 ? (
              <p className="catalog-field-hint">
                Page total across {items.length} shown row{items.length === 1 ? '' : 's'}:{' '}
                <strong>{pageTotalDisplay}</strong>
              </p>
            ) : null}
          </div>

          <div className="catalog-filter-actions">
            {isLoading ? <span className="catalog-refreshing">Loading…</span> : null}
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

        {error ? (
          <div className="catalog-empty-state">
            <div className="alert-banner alert-banner--error" role="alert">
              <div className="alert-banner__content">
                <p>{error.message}</p>
                {error.requestId ? (
                  <p className="alert-banner__meta">Request ID: {error.requestId}</p>
                ) : null}
                <div className="alert-banner__actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setRefreshTick((tick) => tick + 1)}
                  >
                    Retry
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : queryState === null ? (
          <div className="catalog-empty-state" aria-busy="true">
            <p>Loading operating expenses…</p>
          </div>
        ) : items.length === 0 ? (
          <div className="catalog-empty-state">
            {hasActiveFilters ? (
              <>
                <p>No operating expenses match the selected date range or category.</p>
                <button type="button" className="btn-secondary" onClick={handleResetFilters}>
                  Reset Filters
                </button>
              </>
            ) : (
              <>
                <p>No operating expenses recorded yet.</p>
                <button type="button" className="btn-primary" onClick={handleOpenCreate}>
                  Add Expense
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <div
              className="catalog-table-wrapper"
              role="region"
              aria-labelledby={tableHeadingId}
              tabIndex={0}
            >
              <table className="catalog-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Category</th>
                    <th scope="col" className="cell-num">
                      Amount
                    </th>
                    <th scope="col">Payment Mode</th>
                    <th scope="col">Notes</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.expenseId}>
                      <th scope="row">{item.expenseDate}</th>
                      <td data-label="Category">{item.category}</td>
                      <td className="cell-num" data-label="Amount">
                        {formatInrDisplay(item.amount)}
                      </td>
                      <td data-label="Payment Mode">{item.paymentMode}</td>
                      <td data-label="Notes">{item.notes || '—'}</td>
                      <td className="cell-actions" data-label="Actions">
                        <div className="cell-actions__group">
                          <button
                            type="button"
                            className="btn-table-action"
                            onClick={() => handleOpenEdit(item)}
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 ? (
              <div className="catalog-pagination">
                <span>
                  Page {page + 1} of {totalPages}
                </span>
                <div className="catalog-pagination__controls">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={page === 0 || isLoading}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={page + 1 >= totalPages || isLoading}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>

      {modalState.open ? (
        <ExpenseFormModal
          key={`${modalState.mode}:${modalState.expense?.expenseId ?? 'new'}`}
          open={modalState.open}
          mode={modalState.mode}
          expense={modalState.expense}
          api={api}
          categorySuggestions={knownCategories}
          onClose={() => setModalState((prev) => ({ ...prev, open: false }))}
          onSaved={handleModalSaved}
          onRefreshList={() => fetchExpensesNow()}
        />
      ) : null}
    </div>
  );
}
