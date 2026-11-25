import { useId, useRef, useState, type FormEvent } from 'react';
import { isApiClientError } from '../../api/errors.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { formatInrDisplay, normalizeInrPriceInput } from '../../utils/inrPrice.ts';
import type { CatalogApi } from '../catalogApi.ts';
import type { SkuDetail, SkuListItem } from '../types.ts';

export interface EditPriceModalProps {
  sku: SkuListItem | null;
  api: CatalogApi;
  onClose: () => void;
  onUpdated: (updated: SkuDetail) => Promise<void> | void;
  onObservedLatest: (latest: SkuListItem) => void;
}

interface EditPriceFormProps {
  sku: SkuListItem;
  api: CatalogApi;
  isSubmitting: boolean;
  onSubmittingChange: (pending: boolean) => void;
  onClose: () => void;
  onUpdated: (updated: SkuDetail) => Promise<void> | void;
  onObservedLatest: (latest: SkuListItem) => void;
}

function EditPriceForm({
  sku,
  api,
  isSubmitting,
  onSubmittingChange,
  onClose,
  onUpdated,
  onObservedLatest,
}: EditPriceFormProps) {
  const priceInputId = useId();
  const priceHintId = useId();
  const priceErrorId = useId();

  const [priceInput, setPriceInput] = useState(sku.defaultSellingPrice);
  const [expectedVersion, setExpectedVersion] = useState(sku.version);
  const [serverSnapshot, setServerSnapshot] = useState<SkuListItem>(sku);
  const [staleConflict, setStaleConflict] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [submitError, setSubmitError] = useState<{
    message: string;
    requestId?: string | null;
  } | null>(null);

  const submittingRef = useRef(false);
  const priceRef = useRef<HTMLInputElement | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current || isSubmitting) {
      return;
    }

    const normalized = normalizeInrPriceInput(priceInput);
    if (!normalized.ok) {
      setFieldError(normalized.error);
      setSubmitError({ message: 'Please correct the selling price before saving.' });
      priceRef.current?.focus();
      return;
    }

    submittingRef.current = true;
    onSubmittingChange(true);
    setFieldError(undefined);
    setSubmitError(null);

    try {
      const updated = await api.updateSku(sku.skuId, {
        expectedVersion,
        defaultSellingPrice: normalized.value,
      });
      await onUpdated(updated);
      onClose();
    } catch (error) {
      if (isApiClientError(error) && error.code === 'STALE_VERSION') {
        setStaleConflict(true);
        try {
          const latest = await api.findLatestSkuById(sku.skuId, sku.skuCode);
          if (latest) {
            setServerSnapshot(latest);
            setExpectedVersion(latest.version);
            onObservedLatest(latest);
            setSubmitError({
              message:
                'This SKU was updated elsewhere before your save. Review the latest server values below before submitting your edit again.',
              requestId: error.requestId,
            });
          } else {
            setSubmitError({
              message:
                'This SKU was updated elsewhere, and its latest values could not be fetched. Close and refresh the catalog before trying again.',
              requestId: error.requestId,
            });
          }
        } catch {
          setSubmitError({
            message:
              'This SKU was updated elsewhere, and fetching its latest values failed. Close and refresh the catalog.',
            requestId: error.requestId,
          });
        }
      } else if (isApiClientError(error)) {
        const priceMsg = error.fieldErrors.find(
          (item) => item.field === 'defaultSellingPrice',
        )?.message;
        if (priceMsg) {
          setFieldError(priceMsg);
        }
        setSubmitError({
          message: error.message || 'Could not update SKU price.',
          requestId: error.requestId,
        });
      } else {
        setSubmitError({ message: 'Could not update SKU price. Please retry.' });
      }
    } finally {
      submittingRef.current = false;
      onSubmittingChange(false);
    }
  };

  const describedBy = fieldError ? `${priceHintId} ${priceErrorId}` : priceHintId;

  return (
    <>
      <dl className="catalog-summary-grid">
        <div>
          <dt>Product</dt>
          <dd>{serverSnapshot.productName}</dd>
        </div>
        <div>
          <dt>SKU code</dt>
          <dd>
            <code>{serverSnapshot.skuCode}</code>
          </dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{serverSnapshot.size ?? '—'}</dd>
        </div>
        <div>
          <dt>{staleConflict ? 'Current server price' : 'Current price'}</dt>
          <dd>{formatInrDisplay(serverSnapshot.defaultSellingPrice)}</dd>
        </div>
        <div>
          <dt>Current status</dt>
          <dd>{serverSnapshot.active ? 'Active' : 'Inactive'}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{serverSnapshot.version}</dd>
        </div>
      </dl>

      {submitError ? (
        <div
          className={
            staleConflict
              ? 'alert-banner alert-banner--warning'
              : 'alert-banner alert-banner--error'
          }
          role="alert"
        >
          <div className="alert-banner__content">
            <p>{submitError.message}</p>
            {staleConflict ? (
              <p>
                Attempted new price: <strong>{formatInrDisplay(priceInput)}</strong> vs server
                price: <strong>{formatInrDisplay(serverSnapshot.defaultSellingPrice)}</strong>
              </p>
            ) : null}
            {submitError.requestId ? (
              <p className="alert-banner__meta">Request ID: {submitError.requestId}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <form className="catalog-modal-form" onSubmit={handleSubmit} noValidate>
        <div className="catalog-field">
          <label htmlFor={priceInputId} className="catalog-label">
            New selling price (INR) <span className="form-required" aria-hidden="true">*</span>
          </label>
          <span id={priceHintId} className="catalog-field-hint">
            Enter rupees with up to 2 decimal places (for example, 1599.50).
          </span>
          <input
            ref={priceRef}
            id={priceInputId}
            name="defaultSellingPrice"
            type="text"
            inputMode="decimal"
            className="catalog-input"
            value={priceInput}
            onChange={(event) => {
              setPriceInput(event.target.value);
              if (fieldError) {
                const check = normalizeInrPriceInput(event.target.value);
                if (check.ok) {
                  setFieldError(undefined);
                }
              }
            }}
            required
            autoFocus
            aria-invalid={fieldError ? 'true' : 'false'}
            aria-describedby={describedBy}
          />
          {fieldError ? (
            <p id={priceErrorId} className="catalog-field-error">
              <span aria-hidden="true">!</span>
              <span>{fieldError}</span>
            </p>
          ) : null}
        </div>

        <div className="catalog-modal-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          {staleConflict ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={isSubmitting}
              onClick={() => {
                setPriceInput(serverSnapshot.defaultSellingPrice);
                setFieldError(undefined);
              }}
            >
              Use server price
            </button>
          ) : null}
          <button
            type="submit"
            className="btn-primary"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting
              ? 'Saving…'
              : staleConflict
                ? 'Submit update again'
                : 'Save price'}
          </button>
        </div>
      </form>
    </>
  );
}

export function EditPriceModal({
  sku,
  api,
  onClose,
  onUpdated,
  onObservedLatest,
}: EditPriceModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleClose = () => {
    if (isSubmitting) {
      return;
    }
    onClose();
  };

  return (
    <ModalDialog
      open={Boolean(sku)}
      title="Edit SKU price"
      onClose={handleClose}
      preventClose={isSubmitting}
    >
      {sku ? (
        <EditPriceForm
          key={`${sku.skuId}-${sku.version}`}
          sku={sku}
          api={api}
          isSubmitting={isSubmitting}
          onSubmittingChange={setIsSubmitting}
          onClose={handleClose}
          onUpdated={onUpdated}
          onObservedLatest={onObservedLatest}
        />
      ) : null}
    </ModalDialog>
  );
}
