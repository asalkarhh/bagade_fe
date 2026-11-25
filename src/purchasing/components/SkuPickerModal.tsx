import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { isAbortError, isApiClientError } from '../../api/errors.ts';
import type { CatalogApi } from '../../catalog/catalogApi.ts';
import type { SkuListItem } from '../../catalog/types.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { formatInrDisplay } from '../../utils/inrPrice.ts';

export interface SkuPickerModalProps {
  open: boolean;
  api: CatalogApi;
  onClose: () => void;
  onSelect: (sku: SkuListItem) => void;
}

const PICKER_PAGE_SIZE = 10;

interface SkuPickerState {
  key: string;
  items: SkuListItem[];
  total: number;
  error: string | null;
}

function SkuPickerContent({
  api,
  onSelect,
}: {
  api: CatalogApi;
  onSelect: (sku: SkuListItem) => void;
}) {
  const searchId = useId();
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const [resultState, setResultState] = useState<SkuPickerState | null>(null);
  const requestSeqRef = useRef(0);

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

  const activeKey = useMemo(
    () => JSON.stringify({ q: debouncedQuery, page, refreshTick }),
    [debouncedQuery, page, refreshTick],
  );

  useEffect(() => {
    const controller = new AbortController();
    const seq = ++requestSeqRef.current;

    api
      .listSkus(
        {
          q: debouncedQuery || undefined,
          status: 'ACTIVE',
          page,
          size: PICKER_PAGE_SIZE,
        },
        controller.signal,
      )
      .then((res) => {
        if (seq !== requestSeqRef.current || controller.signal.aborted) {
          return;
        }
        setResultState({
          key: activeKey,
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
        setResultState({
          key: activeKey,
          items: [],
          total: 0,
          error: isApiClientError(error) ? error.message : 'Unable to load active SKUs.',
        });
      });

    return () => {
      controller.abort();
    };
  }, [api, debouncedQuery, page, activeKey]);

  const isLoading = resultState?.key !== activeKey;
  const items = resultState?.items ?? [];
  const total = resultState?.total ?? 0;
  const errorMessage = resultState?.error ?? null;
  const totalPages = Math.max(1, Math.ceil(total / PICKER_PAGE_SIZE));

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

  return (
    <>
      <search>
        <form className="catalog-filters-form" onSubmit={handleSearchSubmit}>
          <div className="catalog-filter-field catalog-filter-field--search">
            <label htmlFor={searchId} className="catalog-label">
              Search active SKUs
            </label>
            <input
              id={searchId}
              type="search"
              className="catalog-input"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Product name, SKU code, or size"
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
      ) : isLoading && resultState === null ? (
        <div aria-busy="true">
          <p>Loading active SKUs…</p>
          <progress className="state-progress" aria-label="Loading active SKUs" />
        </div>
      ) : items.length === 0 ? (
        <p>
          {debouncedQuery
            ? 'No active SKUs match your search.'
            : 'No active SKUs available. Create products and SKUs first.'}
        </p>
      ) : (
        <div tabIndex={0} role="region" aria-label="Active SKUs" className="catalog-table-wrapper">
          <table className="catalog-table">
            <caption className="visually-hidden">Active SKUs available to order</caption>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">SKU code</th>
                <th scope="col">Size</th>
                <th scope="col" className="cell-num">
                  Price
                </th>
                <th scope="col">Select</th>
              </tr>
            </thead>
            <tbody>
              {items.map((sku) => (
                <tr key={sku.skuId}>
                  <th scope="row">{sku.productName}</th>
                  <td data-label="SKU code" className="cell-code">
                    <code>{sku.skuCode}</code>
                  </td>
                  <td data-label="Size">{sku.size ?? '—'}</td>
                  <td data-label="Price" className="cell-num">
                    {formatInrDisplay(sku.defaultSellingPrice)}
                  </td>
                  <td data-label="Select">
                    <button
                      type="button"
                      className="btn-table-action"
                      onClick={() => onSelect(sku)}
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
          Page {total === 0 ? 0 : page + 1} of {total === 0 ? 0 : totalPages} ({total} active SKUs)
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
            disabled={(page + 1) * PICKER_PAGE_SIZE >= total || isLoading}
            onClick={() => setPage((prev) => prev + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
}

export function SkuPickerModal({ open, api, onClose, onSelect }: SkuPickerModalProps) {
  return (
    <ModalDialog open={open} title="Select active SKU" onClose={onClose}>
      {open ? <SkuPickerContent api={api} onSelect={onSelect} /> : null}
    </ModalDialog>
  );
}
