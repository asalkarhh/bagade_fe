import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { isAbortError, isApiClientError } from '../../api/errors.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import type { BillingApi } from '../billingApi.ts';
import type { Customer } from '../types.ts';

export interface CustomerPickerModalProps {
  open: boolean;
  api: BillingApi;
  allowCreate?: boolean;
  onClose: () => void;
  onSelectCustomer: (customer: Customer) => void;
}

const CUSTOMER_PAGE_SIZE = 10;

interface CustomerQueryState {
  key: string;
  items: Customer[];
  total: number;
  error: string | null;
}

function CustomerPickerContent({
  api,
  allowCreate,
  onClose,
  onSelectCustomer,
  isSubmitting,
  onSubmittingChange,
}: {
  api: BillingApi;
  allowCreate: boolean;
  onClose: () => void;
  onSelectCustomer: (customer: Customer) => void;
  isSubmitting: boolean;
  onSubmittingChange: (pending: boolean) => void;
}) {
  const searchId = useId();
  const nameId = useId();
  const nameErrorId = useId();
  const contactId = useId();
  const contactErrorId = useId();

  const [mode, setMode] = useState<'search' | 'create'>('search');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const [queryState, setQueryState] = useState<CustomerQueryState | null>(null);

  const [newName, setNewName] = useState('');
  const [newContact, setNewContact] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [contactError, setContactError] = useState<string | undefined>(undefined);
  const [createError, setCreateError] = useState<{
    message: string;
    requestId?: string | null;
  } | null>(null);

  const requestSeqRef = useRef(0);
  const creatingRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

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

  const queryKey = useMemo(
    () => JSON.stringify({ q: debouncedQuery, page, refreshTick }),
    [debouncedQuery, page, refreshTick],
  );

  useEffect(() => {
    if (mode !== 'search') {
      return;
    }

    const controller = new AbortController();
    const seq = ++requestSeqRef.current;

    api
      .listCustomers(
        {
          q: debouncedQuery || undefined,
          page,
          size: CUSTOMER_PAGE_SIZE,
        },
        controller.signal,
      )
      .then((res) => {
        if (seq !== requestSeqRef.current || controller.signal.aborted) {
          return;
        }
        setQueryState({
          key: queryKey,
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
        setQueryState({
          key: queryKey,
          items: [],
          total: 0,
          error: isApiClientError(error) ? error.message : 'Unable to load customers.',
        });
      });

    return () => {
      controller.abort();
    };
  }, [api, debouncedQuery, mode, page, queryKey]);

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

  const handleCreateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creatingRef.current || isSubmitting) {
      return;
    }

    const trimmedName = newName.trim();
    const trimmedContact = newContact.trim();
    let nextNameErr: string | undefined;
    let nextContactErr: string | undefined;

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

    if (nextNameErr || nextContactErr) {
      setCreateError({ message: 'Please fix the highlighted customer fields.' });
      nameInputRef.current?.focus();
      return;
    }

    creatingRef.current = true;
    onSubmittingChange(true);
    setCreateError(null);

    try {
      const created = await api.createCustomer({
        name: trimmedName,
        contact: trimmedContact || null,
      });
      onSelectCustomer(created);
      onClose();
    } catch (error) {
      if (isApiClientError(error)) {
        for (const item of error.fieldErrors) {
          if (item.field === 'name') setNameError(item.message);
          if (item.field === 'contact') setContactError(item.message);
        }
        setCreateError({
          message: error.message || 'Could not create customer.',
          requestId: error.requestId,
        });
      } else {
        setCreateError({ message: 'Unable to create customer. Try again.' });
      }
    } finally {
      creatingRef.current = false;
      onSubmittingChange(false);
    }
  };

  const isLoading = queryState?.key !== queryKey;
  const customers = queryState?.items ?? [];
  const total = queryState?.total ?? 0;
  const errorMessage = queryState?.error ?? null;
  const totalPages = Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE));

  return (
    <>
      {allowCreate ? (
        <div className="catalog-label-row">
          <span className="catalog-label">
            {mode === 'search' ? 'Search existing customers' : 'Create new customer'}
          </span>
          <button
            type="button"
            className="catalog-inline-link"
            disabled={isSubmitting}
            onClick={() => {
              setMode((prev) => (prev === 'search' ? 'create' : 'search'));
              setCreateError(null);
            }}
          >
            {mode === 'search' ? '+ New customer' : '← Back to search'}
          </button>
        </div>
      ) : null}

      {mode === 'create' ? (
        <form className="catalog-modal-form" onSubmit={handleCreateSubmit} noValidate>
          {createError ? (
            <div className="alert-banner alert-banner--error" role="alert">
              <div className="alert-banner__content">
                <p>{createError.message}</p>
                {createError.requestId ? (
                  <p className="alert-banner__meta">Request ID: {createError.requestId}</p>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="catalog-field">
            <label htmlFor={nameId} className="catalog-label">
              Customer name <span className="form-required" aria-hidden="true">*</span>
            </label>
            <input
              ref={nameInputRef}
              id={nameId}
              name="customerName"
              type="text"
              className="catalog-input"
              value={newName}
              maxLength={200}
              required
              autoFocus
              onChange={(event) => {
                setNewName(event.target.value);
                if (nameError && event.target.value.trim()) {
                  setNameError(undefined);
                }
              }}
              aria-invalid={nameError ? 'true' : 'false'}
              aria-describedby={nameError ? nameErrorId : undefined}
            />
            {nameError ? (
              <p id={nameErrorId} className="catalog-field-error">
                <span aria-hidden="true">!</span>
                <span>{nameError}</span>
              </p>
            ) : null}
          </div>

          <div className="catalog-field">
            <label htmlFor={contactId} className="catalog-label">
              Contact (optional)
            </label>
            <input
              id={contactId}
              name="customerContact"
              type="text"
              className="catalog-input"
              value={newContact}
              maxLength={200}
              placeholder="Phone number or email"
              onChange={(event) => {
                setNewContact(event.target.value);
                if (contactError && event.target.value.trim().length <= 200) {
                  setContactError(undefined);
                }
              }}
              aria-invalid={contactError ? 'true' : 'false'}
              aria-describedby={contactError ? contactErrorId : undefined}
            />
            {contactError ? (
              <p id={contactErrorId} className="catalog-field-error">
                <span aria-hidden="true">!</span>
                <span>{contactError}</span>
              </p>
            ) : null}
          </div>

          <div className="catalog-modal-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={isSubmitting}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? 'Saving…' : 'Create & select customer'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <search>
            <form className="catalog-filters-form" onSubmit={handleSearchSubmit}>
              <div className="catalog-filter-field catalog-filter-field--search">
                <label htmlFor={searchId} className="catalog-label">
                  Customer name or contact
                </label>
                <input
                  id={searchId}
                  type="search"
                  className="catalog-input"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Search by name or phone"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                />
              </div>
              <div className="catalog-filter-actions">
                <button type="submit" className="btn-secondary">
                  Search
                </button>
              </div>
            </form>
          </search>

          {errorMessage ? (
            <div className="alert-banner alert-banner--error" role="alert">
              <div className="alert-banner__content">
                <p>{errorMessage}</p>
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
          ) : isLoading && queryState === null ? (
            <div aria-busy="true">
              <p>Loading customers…</p>
              <progress className="state-progress" aria-label="Loading customers" />
            </div>
          ) : customers.length === 0 ? (
            <p>
              {debouncedQuery
                ? 'No customers match your search.'
                : 'No customers saved yet.'}{' '}
              {allowCreate ? 'Use + New customer above to add one.' : ''}
            </p>
          ) : (
            <div tabIndex={0} role="region" aria-label="Customers" className="catalog-table-wrapper">
              <table className="catalog-table">
                <caption className="visually-hidden">Customers matching search</caption>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Contact</th>
                    <th scope="col">Select</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <tr key={customer.customerId}>
                      <th scope="row">{customer.name}</th>
                      <td data-label="Contact">{customer.contact ?? '—'}</td>
                      <td data-label="Select">
                        <button
                          type="button"
                          className="btn-table-action"
                          onClick={() => {
                            onSelectCustomer(customer);
                            onClose();
                          }}
                        >
                          Select
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="po-picker-pager">
            <span>
              Page {total === 0 ? 0 : page + 1} of {total === 0 ? 0 : totalPages} ({total}{' '}
              customers)
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
                disabled={(page + 1) * CUSTOMER_PAGE_SIZE >= total || isLoading}
                onClick={() => setPage((prev) => prev + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export function CustomerPickerModal({
  open,
  api,
  allowCreate = true,
  onClose,
  onSelectCustomer,
}: CustomerPickerModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleClose = () => {
    if (isSubmitting) {
      return;
    }
    onClose();
  };

  return (
    <ModalDialog
      open={open}
      title="Select or create customer"
      onClose={handleClose}
      preventClose={isSubmitting}
    >
      {open ? (
        <CustomerPickerContent
          api={api}
          allowCreate={allowCreate}
          onClose={handleClose}
          onSelectCustomer={onSelectCustomer}
          isSubmitting={isSubmitting}
          onSubmittingChange={setIsSubmitting}
        />
      ) : null}
    </ModalDialog>
  );
}
