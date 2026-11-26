import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { isAbortError, isApiClientError } from '../api/errors.ts';
import { ModalDialog } from '../components/ModalDialog.tsx';
import { billingApi, type BillingApi } from './billingApi.ts';
import type { Customer } from './types.ts';
import '../catalog/ProductsPage.css';
import '../purchasing/Purchasing.css';

export interface CustomersPageProps {
  api?: BillingApi;
}

const DEFAULT_PAGE_SIZE = 25;

interface CustomersQueryState {
  key: string;
  items: Customer[];
  total: number;
  error: { message: string; requestId?: string | null } | null;
}

export function CustomersPage({ api = billingApi }: CustomersPageProps) {
  const searchId = useId();
  const pageSizeId = useId();
  const captionId = useId();
  const nameId = useId();
  const nameErrorId = useId();
  const contactId = useId();
  const contactErrorId = useId();

  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [refreshTick, setRefreshTick] = useState(0);

  const [queryState, setQueryState] = useState<CustomersQueryState | null>(null);
  const requestSeqRef = useRef(0);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContact, setNewContact] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
  const [createSubmitError, setCreateSubmitError] = useState<{
    message: string;
    requestId?: string | null;
  } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const creatingRef = useRef(false);

  useEffect(() => {
    document.title = 'Customers | Bagade Clothing';
  }, []);

  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === debouncedQuery) {
      return;
    }
    const timer = window.setTimeout(() => {
      setDebouncedQuery(trimmed);
      setPage(0);
    }, 220);
    return () => {
      window.clearTimeout(timer);
    };
  }, [searchInput, debouncedQuery]);

  const activeQueryKey = useMemo(
    () => JSON.stringify({ q: debouncedQuery, page, size: pageSize, refreshTick }),
    [debouncedQuery, page, pageSize, refreshTick],
  );

  useEffect(() => {
    const controller = new AbortController();
    const seq = ++requestSeqRef.current;

    api
      .listCustomers(
        {
          q: debouncedQuery || undefined,
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
            message: isApiClientError(error) ? error.message : 'Unable to load customers.',
            requestId: isApiClientError(error) ? error.requestId : null,
          },
        }));
      });

    return () => {
      controller.abort();
    };
  }, [api, debouncedQuery, page, pageSize, activeQueryKey]);

  const customers = queryState?.items ?? [];
  const totalCustomers = queryState?.total ?? 0;
  const loadError = queryState?.error ?? null;
  const hasLoadedOnce = queryState !== null && queryState.error === null;
  const isLoading = queryState?.key !== activeQueryKey;

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

  const openCreateModal = () => {
    setNewName('');
    setNewContact('');
    setNameTouched(false);
    setNameError(null);
    setContactError(null);
    setCreateSubmitError(null);
    setIsCreateOpen(true);
  };

  const handleCreateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creatingRef.current) {
      return;
    }

    setNameTouched(true);
    const trimmedName = newName.trim();
    const trimmedContact = newContact.trim();

    let nextNameErr: string | null = null;
    let nextContactErr: string | null = null;

    if (!trimmedName) {
      nextNameErr = 'Enter the customer name.';
    } else if (trimmedName.length > 200) {
      nextNameErr = 'Customer name must not exceed 200 characters.';
    }
    if (trimmedContact.length > 200) {
      nextContactErr = 'Contact must not exceed 200 characters.';
    }

    setNameError(nextNameErr);
    setContactError(nextContactErr);
    setCreateSubmitError(null);

    if (nextNameErr || nextContactErr) {
      return;
    }

    creatingRef.current = true;
    setIsCreating(true);
    try {
      await api.createCustomer({
        name: trimmedName,
        ...(trimmedContact ? { contact: trimmedContact } : {}),
      });
      setIsCreateOpen(false);
      setRefreshTick((prev) => prev + 1);
    } catch (error) {
      if (isApiClientError(error)) {
        for (const fe of error.fieldErrors) {
          if (fe.field === 'name') setNameError(fe.message);
          if (fe.field === 'contact') setContactError(fe.message);
        }
        setCreateSubmitError({
          message: error.message || 'Unable to create customer.',
          requestId: error.requestId,
        });
      } else {
        setCreateSubmitError({
          message: 'Unable to reach the server. Your customer form values were preserved.',
        });
      }
    } finally {
      creatingRef.current = false;
      setIsCreating(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalCustomers / pageSize));
  const rangeStart = totalCustomers === 0 ? 0 : page * pageSize + 1;
  const rangeEnd = Math.min(totalCustomers, page * pageSize + customers.length);

  return (
    <div className="products-page">
      <div className="products-header">
        <div className="products-header__title-group">
          <h1 id="main-content" tabIndex={-1}>
            Customers
          </h1>
          <p className="products-header__subtitle">
            Search shop customers by name or contact and open their bills to review or collect
            outstanding credit.
          </p>
        </div>

        <div className="products-header__actions">
          <button type="button" className="btn-primary" onClick={openCreateModal}>
            + Add Customer
          </button>
        </div>
      </div>

      <section className="surface-card catalog-filters-card" aria-label="Customer search">
        <search>
          <form className="catalog-filters-form" onSubmit={handleSearchSubmit}>
            <div className="catalog-filter-field catalog-filter-field--search">
              <label htmlFor={searchId} className="catalog-label">
                Search name or contact
              </label>
              <input
                id={searchId}
                name="q"
                type="search"
                className="catalog-input"
                placeholder="Customer name or phone number"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
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
                Search
              </button>
              {searchInput.trim().length > 0 ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setSearchInput('');
                    setDebouncedQuery('');
                    setPage(0);
                  }}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </form>
        </search>
      </section>

      <section className="surface-card catalog-results-card" aria-label="Customer directory">
        <div className="catalog-results-bar">
          <span id={captionId} className="catalog-results-count">
            {totalCustomers === 0
              ? '0 customers'
              : `Showing ${rangeStart}–${rangeEnd} of ${totalCustomers} customers`}
          </span>
          {isLoading ? (
            <span className="catalog-refreshing" aria-live="polite">
              Loading customers…
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
            <p>Loading customers…</p>
            <progress className="state-progress" aria-label="Loading customers" />
          </div>
        ) : customers.length === 0 ? (
          <div className="catalog-empty-state">
            {debouncedQuery ? (
              <>
                <p>No customers match &ldquo;{debouncedQuery}&rdquo;.</p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setSearchInput('');
                    setDebouncedQuery('');
                    setPage(0);
                  }}
                >
                  Clear search
                </button>
              </>
            ) : (
              <>
                <p>No customers have been added yet.</p>
                <button type="button" className="btn-primary" onClick={openCreateModal}>
                  Add first customer
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
              <caption className="visually-hidden">
                Customer directory with contact details and link to view bills
              </caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Contact</th>
                  <th scope="col">Bills</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => {
                  const billsUrlParams = new URLSearchParams({
                    customerId: customer.customerId,
                    customerName: customer.name,
                  });
                  if (customer.contact) {
                    billsUrlParams.set('customerContact', customer.contact);
                  }
                  return (
                    <tr key={customer.customerId}>
                      <th scope="row">{customer.name}</th>
                      <td data-label="Contact">{customer.contact ?? '—'}</td>
                      <td data-label="Bills">
                        <Link
                          to={`/billing/history?${billsUrlParams.toString()}`}
                          className="btn-table-action"
                        >
                          View bills
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
            Page {totalCustomers === 0 ? 0 : page + 1} of{' '}
            {totalCustomers === 0 ? 0 : totalPages}
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
              disabled={(page + 1) * pageSize >= totalCustomers || isLoading}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>

      <ModalDialog
        open={isCreateOpen}
        title="Add customer"
        preventClose={isCreating}
        onClose={() => {
          if (!isCreating) {
            setIsCreateOpen(false);
          }
        }}
      >
        {isCreateOpen ? (
          <form className="catalog-modal-form" onSubmit={handleCreateSubmit} noValidate>
            {createSubmitError ? (
              <div className="alert-banner alert-banner--error" role="alert">
                <div className="alert-banner__content">
                  <p>{createSubmitError.message}</p>
                  {createSubmitError.requestId ? (
                    <p className="alert-banner__meta">Request ID: {createSubmitError.requestId}</p>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="catalog-field">
              <label htmlFor={nameId} className="catalog-label">
                Customer name <span aria-hidden="true">*</span>
              </label>
              <input
                id={nameId}
                type="text"
                className="catalog-input"
                maxLength={200}
                required
                autoFocus
                value={newName}
                disabled={isCreating}
                onBlur={() => setNameTouched(true)}
                onChange={(event) => {
                  setNewName(event.target.value);
                  if (nameError && event.target.value.trim()) {
                    setNameError(null);
                  }
                }}
                aria-invalid={nameTouched && nameError ? 'true' : 'false'}
                aria-describedby={nameErrorId}
              />
              {nameError ? (
                <p id={nameErrorId} className="catalog-field-error" role="alert">
                  {nameError}
                </p>
              ) : null}
            </div>

            <div className="catalog-field">
              <label htmlFor={contactId} className="catalog-label">
                Contact (optional)
              </label>
              <input
                id={contactId}
                type="text"
                className="catalog-input"
                maxLength={200}
                placeholder="Phone number or email"
                value={newContact}
                disabled={isCreating}
                onChange={(event) => {
                  setNewContact(event.target.value);
                  if (contactError) {
                    setContactError(null);
                  }
                }}
                aria-invalid={contactError ? 'true' : 'false'}
                aria-describedby={contactErrorId}
              />
              {contactError ? (
                <p id={contactErrorId} className="catalog-field-error" role="alert">
                  {contactError}
                </p>
              ) : null}
            </div>

            <div className="catalog-modal-actions">
              <button
                type="button"
                className="btn-secondary"
                disabled={isCreating}
                onClick={() => setIsCreateOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={isCreating}
                aria-busy={isCreating}
              >
                {isCreating ? 'Saving customer…' : 'Save customer'}
              </button>
            </div>
          </form>
        ) : null}
      </ModalDialog>
    </div>
  );
}
