import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { isAbortError, isApiClientError } from '../../api/errors.ts';
import type { CatalogApi } from '../../catalog/catalogApi.ts';
import { buildCategoryOptions } from '../../catalog/categoryUtils.ts';
import {
  ProductAndSkuModal,
  type ProductAndSkuModalMode,
} from '../../catalog/components/ProductAndSkuModal.tsx';
import type { Category, CreateSkuResponse, ProductResponse, SkuListItem } from '../../catalog/types.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { formatInrDisplay } from '../../utils/inrPrice.ts';
import type { InventoryApi } from '../inventoryApi.ts';
import type { BarcodeLookupResult } from '../types.ts';

export interface BarcodeLinkModalProps {
  open: boolean;
  barcode: string;
  inventoryApi: InventoryApi;
  catalogApi: CatalogApi;
  onClose: () => void;
  onLinked: (sku: SkuListItem, code: string) => void;
  onUseExistingMapping?: (lookup: BarcodeLookupResult) => void;
}

const SKU_PAGE_SIZE = 8;

interface SkuQueryState {
  key: string;
  items: SkuListItem[];
  total: number;
  error: string | null;
}

function BarcodeLinkContent({
  barcode,
  inventoryApi,
  catalogApi,
  selectedSku,
  onSelectSku,
  onOpenProductModal,
  onClose,
  onLinked,
  onUseExistingMapping,
  isSubmitting,
  onSubmittingChange,
}: {
  barcode: string;
  inventoryApi: InventoryApi;
  catalogApi: CatalogApi;
  selectedSku: SkuListItem | null;
  onSelectSku: (sku: SkuListItem | null) => void;
  onOpenProductModal: (mode: ProductAndSkuModalMode) => void;
  onClose: () => void;
  onLinked: (sku: SkuListItem, code: string) => void;
  onUseExistingMapping?: (lookup: BarcodeLookupResult) => void;
  isSubmitting: boolean;
  onSubmittingChange: (pending: boolean) => void;
}) {
  const searchInputId = useId();
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const [skuState, setSkuState] = useState<SkuQueryState | null>(null);
  const [linkError, setLinkError] = useState<{
    message: string;
    requestId?: string | null;
    conflictLookup?: BarcodeLookupResult | null;
  } | null>(null);

  const requestSeqRef = useRef(0);
  const linkingRef = useRef(false);

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
    const controller = new AbortController();
    const seq = ++requestSeqRef.current;

    catalogApi
      .listSkus(
        {
          q: debouncedQuery || undefined,
          status: 'ACTIVE',
          page,
          size: SKU_PAGE_SIZE,
        },
        controller.signal,
      )
      .then((res) => {
        if (seq !== requestSeqRef.current || controller.signal.aborted) {
          return;
        }
        setSkuState({
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
        setSkuState({
          key: queryKey,
          items: [],
          total: 0,
          error: isApiClientError(error) ? error.message : 'Unable to load active SKUs.',
        });
      });

    return () => {
      controller.abort();
    };
  }, [catalogApi, debouncedQuery, page, queryKey]);

  const isLoadingSkus = skuState?.key !== queryKey;
  const skus = skuState?.items ?? [];
  const totalSkus = skuState?.total ?? 0;
  const skuLoadError = skuState?.error ?? null;
  const totalPages = Math.max(1, Math.ceil(totalSkus / SKU_PAGE_SIZE));

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

  const handleConfirmLink = async () => {
    if (!selectedSku || linkingRef.current || isSubmitting) {
      return;
    }

    linkingRef.current = true;
    onSubmittingChange(true);
    setLinkError(null);

    try {
      const mapping = await inventoryApi.registerBarcode({
        code: barcode,
        skuId: selectedSku.skuId,
      });
      onLinked(selectedSku, mapping.code);
      onClose();
    } catch (error) {
      if (isApiClientError(error) && error.code === 'BARCODE_CONFLICT') {
        let existingLookup: BarcodeLookupResult | null = null;
        try {
          existingLookup = await inventoryApi.lookupBarcode(barcode);
        } catch {
          existingLookup = null;
        }
        setLinkError({
          message: error.message || 'This barcode is already linked to another SKU or batch.',
          requestId: error.requestId,
          conflictLookup: existingLookup,
        });
      } else if (isApiClientError(error)) {
        setLinkError({
          message: error.message || 'Could not link barcode.',
          requestId: error.requestId,
        });
      } else {
        setLinkError({
          message: 'Could not link barcode. Please check your connection and try again.',
        });
      }
    } finally {
      linkingRef.current = false;
      onSubmittingChange(false);
    }
  };

  return (
    <>
      <div className="alert-banner alert-banner--info" role="status">
        <div className="alert-banner__content">
          <p>
            Barcode <code>{barcode}</code> is not linked to any SKU yet. Choose an existing SKU or
            create a new product / size variant, then link it to keep receiving without losing your
            draft.
          </p>
        </div>
      </div>

      {linkError ? (
        <div className="alert-banner alert-banner--error" role="alert">
          <div className="alert-banner__content">
            <p>{linkError.message}</p>
            {linkError.conflictLookup ? (
              <>
                <p>
                  Existing mapping ({linkError.conflictLookup.mappingType}):{' '}
                  <strong>{linkError.conflictLookup.name}</strong> (Size:{' '}
                  {linkError.conflictLookup.size ?? '—'}, Selling price:{' '}
                  {formatInrDisplay(linkError.conflictLookup.defaultSellingPrice)})
                </p>
                {onUseExistingMapping ? (
                  <div className="alert-banner__actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        onUseExistingMapping(linkError.conflictLookup!);
                        onClose();
                      }}
                    >
                      Use mapped SKU on receipt
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}
            {linkError.requestId ? (
              <p className="alert-banner__meta">Request ID: {linkError.requestId}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="catalog-label-row">
        <span className="catalog-label">Option 1: Select existing SKU</span>
        <button
          type="button"
          className="catalog-inline-link"
          disabled={isSubmitting}
          onClick={() => onOpenProductModal({ kind: 'create-product' })}
        >
          + Create new product / size
        </button>
      </div>

      {selectedSku ? (
        <div className="po-sku-box">
          <div className="po-sku-box__info">
            <span className="po-sku-box__name">Selected SKU: {selectedSku.productName}</span>
            <span className="po-sku-box__meta">
              <code>{selectedSku.skuCode}</code> · Size: {selectedSku.size ?? '—'} · Selling price:{' '}
              {formatInrDisplay(selectedSku.defaultSellingPrice)}
            </span>
          </div>
          <button
            type="button"
            className="btn-table-action"
            disabled={isSubmitting}
            onClick={() => onSelectSku(null)}
          >
            Clear
          </button>
        </div>
      ) : null}

      <search>
        <form className="catalog-filters-form" onSubmit={handleSearchSubmit}>
          <div className="catalog-filter-field catalog-filter-field--search">
            <label htmlFor={searchInputId} className="catalog-label">
              Search active SKUs
            </label>
            <input
              id={searchInputId}
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

      {skuLoadError ? (
        <div className="alert-banner alert-banner--error" role="alert">
          <div className="alert-banner__content">
            <p>{skuLoadError}</p>
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
      ) : isLoadingSkus && skuState === null ? (
        <div aria-busy="true">
          <p>Loading active SKUs…</p>
          <progress className="state-progress" aria-label="Loading active SKUs" />
        </div>
      ) : skus.length === 0 ? (
        <p>No active SKUs match your search. Use + Create new product / size above.</p>
      ) : (
        <div tabIndex={0} role="region" aria-label="Active SKUs to link" className="catalog-table-wrapper">
          <table className="catalog-table">
            <caption className="visually-hidden">Active SKUs available for barcode linking</caption>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">SKU code</th>
                <th scope="col">Size</th>
                <th scope="col" className="cell-num">
                  Price
                </th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {skus.map((sku) => {
                const isSelected = selectedSku?.skuId === sku.skuId;
                return (
                  <tr key={sku.skuId}>
                    <th scope="row">{sku.productName}</th>
                    <td data-label="SKU code" className="cell-code">
                      <code>{sku.skuCode}</code>
                    </td>
                    <td data-label="Size">{sku.size ?? '—'}</td>
                    <td data-label="Price" className="cell-num">
                      {formatInrDisplay(sku.defaultSellingPrice)}
                    </td>
                    <td data-label="Action" className="cell-actions">
                      <div className="cell-actions__group">
                        <button
                          type="button"
                          className="btn-table-action"
                          disabled={isSubmitting}
                          onClick={() => {
                            onSelectSku(sku);
                            setLinkError(null);
                          }}
                        >
                          {isSelected ? 'Selected' : 'Select'}
                        </button>
                        {sku.productId ? (
                          <button
                            type="button"
                            className="btn-table-action"
                            disabled={isSubmitting}
                            onClick={() =>
                              onOpenProductModal({
                                kind: 'add-sku',
                                productId: sku.productId!,
                                productName: sku.productName,
                              })
                            }
                          >
                            + Size
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="po-picker-pager">
        <span>
          Page {totalSkus === 0 ? 0 : page + 1} of {totalSkus === 0 ? 0 : totalPages} ({totalSkus}{' '}
          active SKUs)
        </span>
        <div className="catalog-pagination__controls">
          <button
            type="button"
            className="btn-secondary"
            disabled={page <= 0 || isLoadingSkus}
            onClick={() => setPage((prev) => Math.max(0, prev - 1))}
          >
            Previous
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={(page + 1) * SKU_PAGE_SIZE >= totalSkus || isLoadingSkus}
            onClick={() => setPage((prev) => prev + 1)}
          >
            Next
          </button>
        </div>
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
          type="button"
          className="btn-primary"
          disabled={!selectedSku || isSubmitting}
          aria-busy={isSubmitting}
          onClick={() => {
            void handleConfirmLink();
          }}
        >
          {isSubmitting ? 'Linking barcode…' : 'Link barcode'}
        </button>
      </div>
    </>
  );
}

export function BarcodeLinkModal({
  open,
  barcode,
  inventoryApi,
  catalogApi,
  onClose,
  onLinked,
  onUseExistingMapping,
}: BarcodeLinkModalProps) {
  const [selectedSku, setSelectedSku] = useState<SkuListItem | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [productModalMode, setProductModalMode] = useState<ProductAndSkuModalMode | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [createdProductNames, setCreatedProductNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || categories.length > 0) {
      return;
    }
    const controller = new AbortController();
    catalogApi
      .listAllCategories(controller.signal)
      .then((loaded) => {
        if (!controller.signal.aborted) {
          setCategories(loaded);
        }
      })
      .catch(() => {
        // Non-blocking: ProductAndSkuModal allows creating categories inline too.
      });
    return () => {
      controller.abort();
    };
  }, [open, categories.length, catalogApi]);

  const categoryOptions = useMemo(() => buildCategoryOptions(categories), [categories]);

  const handleCloseMain = () => {
    if (isSubmitting) {
      return;
    }
    setSelectedSku(null);
    setProductModalMode(null);
    onClose();
  };

  const handleCategoryCreated = (created: Category) => {
    setCategories((prev) => [...prev, created]);
  };

  const handleProductCreated = (product: ProductResponse) => {
    setCreatedProductNames((prev) => ({ ...prev, [product.productId]: product.name }));
  };

  const handleSkuCreated = (productId: string, createdSku: CreateSkuResponse) => {
    const productName =
      createdProductNames[productId] ??
      (productModalMode?.kind === 'add-sku' ? productModalMode.productName : 'New product');
    setSelectedSku({
      skuId: createdSku.skuId,
      productId,
      productName,
      size: createdSku.size,
      skuCode: createdSku.skuCode,
      defaultSellingPrice: createdSku.defaultSellingPrice,
      sellableQuantity: 0,
      active: true,
      version: createdSku.version,
    });
  };

  return (
    <>
      <ModalDialog
        open={open && productModalMode === null}
        title="Link unknown barcode"
        onClose={handleCloseMain}
        preventClose={isSubmitting}
      >
        {open && productModalMode === null ? (
          <BarcodeLinkContent
            key={barcode}
            barcode={barcode}
            inventoryApi={inventoryApi}
            catalogApi={catalogApi}
            selectedSku={selectedSku}
            onSelectSku={setSelectedSku}
            onOpenProductModal={setProductModalMode}
            onClose={handleCloseMain}
            onLinked={onLinked}
            onUseExistingMapping={onUseExistingMapping}
            isSubmitting={isSubmitting}
            onSubmittingChange={setIsSubmitting}
          />
        ) : null}
      </ModalDialog>

      <ProductAndSkuModal
        open={open && productModalMode !== null}
        mode={productModalMode}
        api={catalogApi}
        categoryOptions={categoryOptions}
        onClose={() => setProductModalMode(null)}
        onCategoryCreated={handleCategoryCreated}
        onProductCreated={handleProductCreated}
        onSkuCreated={handleSkuCreated}
      />
    </>
  );
}
