import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { isAbortError, isApiClientError } from '../../api/errors.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { formatInrDisplay } from '../../utils/inrPrice.ts';
import type { InventoryApi } from '../inventoryApi.ts';
import {
  findLabelProfile,
  getDefaultLabelProfileId,
  LABEL_PRINT_PROFILES,
  type LabelPrintProfile,
} from '../labelProfiles.ts';
import type { BatchLabel } from '../types.ts';
import { BarcodeSvg } from './BarcodeSvg.tsx';

export type TagPrintMode = 'generate' | 'print' | 'reprint';

export interface TagPrintPreviewModalProps {
  open: boolean;
  batchId: string | null;
  mode: TagPrintMode;
  defaultCopies: number;
  api: InventoryApi;
  onClose: () => void;
  onLabelLoaded?: (batchId: string, code: string) => void;
  onPrinted?: (batchId: string) => void;
}

const MAX_PRINT_COPIES = 500;

function parseCopyCount(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    return { ok: false, error: 'Enter a whole number of copies greater than 0.' };
  }
  const num = Number(trimmed);
  if (!Number.isSafeInteger(num) || num < 1 || num > MAX_PRINT_COPIES) {
    return { ok: false, error: `Enter between 1 and ${MAX_PRINT_COPIES} tag copies.` };
  }
  return { ok: true, value: num };
}

function ProductTagCard({
  label,
  profile,
  isPreview = false,
}: {
  label: BatchLabel;
  profile: LabelPrintProfile;
  isPreview?: boolean;
}) {
  // Keep barcode and printed text bound strictly to the backend-saved code.
  const savedBarcode = label.barcode || label.code;
  const savedTextCode = label.textCode || savedBarcode;

  return (
    <article
      className={isPreview ? 'product-tag product-tag--screen-preview' : 'product-tag'}
      style={{
        inlineSize: `${profile.widthMm}mm`,
        blockSize: `${profile.heightMm}mm`,
        padding: `${profile.paddingMm}mm`,
      }}
      aria-label={`Product tag for ${label.productName}`}
    >
      <div className="product-tag__top">
        <span className="product-tag__shop">{label.shopName}</span>
        <span className="product-tag__price">{formatInrDisplay(label.displayPrice)}</span>
      </div>

      <div>
        <div className="product-tag__product" title={label.productName}>
          {label.productName}
        </div>
        {label.size ? <div className="product-tag__size">Size: {label.size}</div> : null}
      </div>

      <div className="product-tag__barcode-wrap">
        <BarcodeSvg code={savedBarcode} heightMm={profile.barcodeHeightMm} />
        <span className="product-tag__code">{savedTextCode}</span>
      </div>
    </article>
  );
}

function TagPrintPreviewContent({
  batchId,
  mode,
  defaultCopies,
  api,
  onClose,
  onLabelLoaded,
  onPrinted,
}: {
  batchId: string;
  mode: TagPrintMode;
  defaultCopies: number;
  api: InventoryApi;
  onClose: () => void;
  onLabelLoaded?: (batchId: string, code: string) => void;
  onPrinted?: (batchId: string) => void;
}) {
  const copiesId = useId();
  const copiesErrorId = useId();
  const profileIdInput = useId();

  const [effectiveMode, setEffectiveMode] = useState<TagPrintMode>(mode);
  const [reloadTick, setReloadTick] = useState(0);
  const [label, setLabel] = useState<BatchLabel | null>(null);
  const [loadError, setLoadError] = useState<{
    message: string;
    code?: string;
    requestId?: string | null;
  } | null>(null);

  const [copiesRaw, setCopiesRaw] = useState(() => String(Math.max(1, defaultCopies)));
  const [copiesError, setCopiesError] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState(() => getDefaultLabelProfileId());
  const [printStatusNotice, setPrintStatusNotice] = useState<string | null>(null);

  const copiesInputRef = useRef<HTMLInputElement | null>(null);
  const onLabelLoadedRef = useRef(onLabelLoaded);

  useEffect(() => {
    onLabelLoadedRef.current = onLabelLoaded;
  }, [onLabelLoaded]);

  useEffect(() => {
    const controller = new AbortController();

    const request =
      effectiveMode === 'generate'
        ? api.generateBatchLabel(batchId)
        : api.getBatchLabel(batchId, controller.signal);

    request
      .then((loaded) => {
        if (controller.signal.aborted) {
          return;
        }
        setLabel(loaded);
        setLoadError(null);
        onLabelLoadedRef.current?.(loaded.batchId, loaded.code);
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || controller.signal.aborted) {
          return;
        }
        setLoadError(
          isApiClientError(error)
            ? { message: error.message, code: error.code, requestId: error.requestId }
            : { message: 'Unable to load batch tag.' },
        );
      });

    return () => {
      controller.abort();
    };
  }, [api, batchId, effectiveMode, reloadTick]);

  const profile = findLabelProfile(selectedProfileId);
  const copyCheck = parseCopyCount(copiesRaw);
  const validCopies = copyCheck.ok ? copyCheck.value : 1;

  const handlePrintSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const check = parseCopyCount(copiesRaw);
    if (!check.ok) {
      setCopiesError(check.error);
      copiesInputRef.current?.focus();
      return;
    }

    setCopiesError(null);
    setPrintStatusNotice(null);

    try {
      window.print();
      onPrinted?.(batchId);
      setPrintStatusNotice(
        `Print requested for ${check.value} tag cop${check.value === 1 ? 'y' : 'ies'} (${profile.label}). If you cancelled or the printer was unavailable, you can print again without changing inventory.`,
      );
    } catch {
      setPrintStatusNotice(
        'Browser print dialog could not be opened. You can retry or keep this tag code visible.',
      );
    }
  };

  const isLoading = label === null && loadError === null;

  return (
    <>
      {isLoading ? (
        <div aria-busy="true">
          <p>{effectiveMode === 'generate' ? 'Generating tag code…' : 'Loading saved tag…'}</p>
          <progress className="state-progress" aria-label="Loading tag label" />
        </div>
      ) : loadError || !label ? (
        <div className="alert-banner alert-banner--error" role="alert">
          <div className="alert-banner__content">
            <p>{loadError?.message ?? 'Could not load tag details.'}</p>
            {loadError?.requestId ? (
              <p className="alert-banner__meta">Request ID: {loadError.requestId}</p>
            ) : null}
            <div className="alert-banner__actions">
              {loadError?.code === 'LABEL_NOT_FOUND' ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setLoadError(null);
                    setEffectiveMode('generate');
                    setReloadTick((prev) => prev + 1);
                  }}
                >
                  Generate Tag
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setLoadError(null);
                    setReloadTick((prev) => prev + 1);
                  }}
                >
                  Retry
                </button>
              )}
              <button type="button" className="btn-secondary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {mode === 'reprint' ? (
            <div className="alert-banner alert-banner--info" role="status">
              <div className="alert-banner__content">
                <p>
                  Reprinting existing code <code>{label.code}</code>. Inventory quantities remain
                  unchanged.
                </p>
              </div>
            </div>
          ) : null}

          {printStatusNotice ? (
            <div className="alert-banner alert-banner--info" role="status">
              <div className="alert-banner__content">
                <p>{printStatusNotice}</p>
              </div>
            </div>
          ) : null}

          <form className="catalog-modal-form" onSubmit={handlePrintSubmit} noValidate>
            <div className="tag-preview-controls">
              <div className="catalog-field tag-preview-controls__copies">
                <label htmlFor={copiesId} className="catalog-label">
                  Copies <span className="form-required" aria-hidden="true">*</span>
                </label>
                <input
                  ref={copiesInputRef}
                  id={copiesId}
                  name="copies"
                  type="text"
                  inputMode="numeric"
                  className="catalog-input"
                  value={copiesRaw}
                  onChange={(event) => {
                    setCopiesRaw(event.target.value);
                    if (copiesError && parseCopyCount(event.target.value).ok) {
                      setCopiesError(null);
                    }
                  }}
                  required
                  aria-invalid={copiesError ? 'true' : 'false'}
                  aria-describedby={copiesError ? copiesErrorId : undefined}
                />
              </div>

              <div className="catalog-field tag-preview-controls__profile">
                <label htmlFor={profileIdInput} className="catalog-label">
                  Label size profile
                </label>
                <select
                  id={profileIdInput}
                  name="labelProfile"
                  className="catalog-select"
                  value={selectedProfileId}
                  onChange={(event) => setSelectedProfileId(event.target.value)}
                >
                  {LABEL_PRINT_PROFILES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {copiesError ? (
              <p id={copiesErrorId} className="catalog-field-error">
                <span aria-hidden="true">!</span>
                <span>{copiesError}</span>
              </p>
            ) : null}

            <div className="tag-preview-stage" aria-label="Tag print preview">
              <ProductTagCard label={label} profile={profile} isPreview />
              <p className="tag-preview-stage__meta">
                Previewing 1 of {validCopies} tag{validCopies === 1 ? '' : 's'} · {profile.label} ·{' '}
                {profile.barcodeFormat} · Code: <code>{label.textCode}</code>
              </p>
            </div>

            <div className="catalog-modal-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Close
              </button>
              <button type="submit" className="btn-primary">
                {printStatusNotice ? 'Print again' : 'Print tags'}
              </button>
            </div>
          </form>

          {typeof document !== 'undefined'
            ? createPortal(
                <div className="tag-print-portal" aria-hidden="true">
                  <style media="print">
                    {`@page { size: ${profile.widthMm}mm ${profile.heightMm}mm; margin: 0; }`}
                  </style>
                  {Array.from({ length: validCopies }, (_, idx) => (
                    <ProductTagCard key={`${label.batchId}-${idx}`} label={label} profile={profile} />
                  ))}
                </div>,
                document.body,
              )
            : null}
        </>
      )}
    </>
  );
}

export function TagPrintPreviewModal({
  open,
  batchId,
  mode,
  defaultCopies,
  api,
  onClose,
  onLabelLoaded,
  onPrinted,
}: TagPrintPreviewModalProps) {
  const title =
    mode === 'generate'
      ? 'Generate & Print Product Tag'
      : mode === 'reprint'
        ? 'Reprint Product Tag'
        : 'Print Product Tag';

  return (
    <ModalDialog open={open && Boolean(batchId)} title={title} onClose={onClose}>
      {open && batchId ? (
        <TagPrintPreviewContent
          key={`${batchId}-${mode}-${defaultCopies}`}
          batchId={batchId}
          mode={mode}
          defaultCopies={defaultCopies}
          api={api}
          onClose={onClose}
          onLabelLoaded={onLabelLoaded}
          onPrinted={onPrinted}
        />
      ) : null}
    </ModalDialog>
  );
}
