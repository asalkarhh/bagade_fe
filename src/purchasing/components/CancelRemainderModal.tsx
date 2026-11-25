import { useId, useRef, useState, type FormEvent } from 'react';
import { isApiClientError } from '../../api/errors.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import type { PurchasingApi } from '../purchasingApi.ts';
import type {
  CancelPurchaseOrderRemainderInput,
  PurchaseOrderDetail,
} from '../types.ts';

export interface CancelRemainderModalProps {
  open: boolean;
  po: PurchaseOrderDetail;
  api: PurchasingApi;
  onClose: () => void;
  onCancelled: (updated: PurchaseOrderDetail) => void;
  onReloadOrder: () => Promise<PurchaseOrderDetail | null>;
}

interface PendingCancelAttempt {
  idempotencyKey: string;
  payload: CancelPurchaseOrderRemainderInput;
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cancel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function CancelRemainderContent({
  po,
  api,
  isSubmitting,
  onSubmittingChange,
  onClose,
  onCancelled,
  onReloadOrder,
}: {
  po: PurchaseOrderDetail;
  api: PurchasingApi;
  isSubmitting: boolean;
  onSubmittingChange: (pending: boolean) => void;
  onClose: () => void;
  onCancelled: (updated: PurchaseOrderDetail) => void;
  onReloadOrder: () => Promise<PurchaseOrderDetail | null>;
}) {
  const reasonId = useId();
  const reasonErrorId = useId();
  const linesErrorId = useId();

  const openLines = po.lines.filter((line) => line.openQuantity > 0);
  const [cancelScope, setCancelScope] = useState<'ALL' | 'SELECTED'>('ALL');
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  const [linesError, setLinesError] = useState<string | undefined>(undefined);
  const [staleReviewNotice, setStaleReviewNotice] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<{
    message: string;
    requestId?: string | null;
    isRetryableNetwork?: boolean;
  } | null>(null);

  // Retained across network/5xx errors so retrying sends the exact same Idempotency-Key & payload.
  const [pendingAttempt, setPendingAttempt] = useState<PendingCancelAttempt | null>(null);

  const submittingRef = useRef(false);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);

  const toggleLine = (poLineId: string) => {
    setPendingAttempt(null);
    setLinesError(undefined);
    setSelectedLineIds((prev) =>
      prev.includes(poLineId) ? prev.filter((id) => id !== poLineId) : [...prev, poLineId],
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current || isSubmitting) {
      return;
    }

    const trimmedReason = reason.trim();
    const validSelectedIds = selectedLineIds.filter((id) =>
      openLines.some((line) => line.poLineId === id),
    );

    if (!trimmedReason) {
      setReasonError('Enter a cancellation reason.');
      setSubmitError({ message: 'Cancellation reason is required.' });
      reasonRef.current?.focus();
      return;
    }
    if (trimmedReason.length > 500) {
      setReasonError('Cancellation reason must not exceed 500 characters.');
      setSubmitError({ message: 'Cancellation reason must not exceed 500 characters.' });
      reasonRef.current?.focus();
      return;
    }
    if (cancelScope === 'SELECTED' && validSelectedIds.length === 0) {
      setLinesError('Select at least one open line to cancel.');
      setSubmitError({ message: 'Select at least one open line or choose Cancel all open.' });
      return;
    }

    const attempt: PendingCancelAttempt = pendingAttempt ?? {
      idempotencyKey: generateIdempotencyKey(),
      payload: {
        expectedVersion: po.version,
        reason: trimmedReason,
        ...(cancelScope === 'SELECTED' ? { poLineIds: validSelectedIds } : {}),
      },
    };

    submittingRef.current = true;
    onSubmittingChange(true);
    setReasonError(undefined);
    setLinesError(undefined);
    setSubmitError(null);
    setStaleReviewNotice(null);

    try {
      const updated = await api.cancelPurchaseOrderRemainder(
        po.poId,
        attempt.payload,
        attempt.idempotencyKey,
      );
      setPendingAttempt(null);
      onCancelled(updated);
      onClose();
    } catch (error) {
      if (isApiClientError(error) && error.code === 'STALE_VERSION') {
        // Reload latest PO so staff can review updated quantities before sending a new request.
        setPendingAttempt(null);
        const reloaded = await onReloadOrder();
        if (reloaded) {
          setSelectedLineIds((prev) =>
            prev.filter((id) =>
              reloaded.lines.some((line) => line.poLineId === id && line.openQuantity > 0),
            ),
          );
          setStaleReviewNotice(
            `This purchase order was updated elsewhere (now version ${reloaded.version} with ${reloaded.totalOpenQuantity} total open units). Review the current line quantities below before confirming cancellation.`,
          );
        } else {
          setSubmitError({
            message:
              'This purchase order was modified elsewhere, and reloading its latest state failed. Close and refresh the page before retrying.',
            requestId: error.requestId,
          });
        }
      } else if (
        isApiClientError(error) &&
        (error.kind === 'network' || error.kind === 'server')
      ) {
        setPendingAttempt(attempt);
        setSubmitError({
          message:
            'Connection error while cancelling — the outcome is unknown. Retry with the same request to avoid applying cancellation twice.',
          requestId: error.requestId,
          isRetryableNetwork: true,
        });
      } else if (isApiClientError(error)) {
        setPendingAttempt(null);
        for (const fieldErr of error.fieldErrors) {
          if (fieldErr.field === 'reason') {
            setReasonError(fieldErr.message);
          } else if (fieldErr.field === 'poLineIds') {
            setLinesError(fieldErr.message);
          }
        }
        setSubmitError({
          message: error.message || 'Could not cancel remaining quantities.',
          requestId: error.requestId,
        });
      } else {
        setPendingAttempt(attempt);
        setSubmitError({
          message: 'Unexpected error during cancellation. Retry to confirm safely.',
          isRetryableNetwork: true,
        });
      }
    } finally {
      submittingRef.current = false;
      onSubmittingChange(false);
    }
  };

  return (
    <>
      <div className="alert-banner alert-banner--info" role="status">
        <div className="alert-banner__content">
          <p>
            <strong>{po.poNumber}</strong> — {po.totalOpenQuantity} total open unit(s) (version{' '}
            {po.version}). Previously received units remain unchanged.
          </p>
        </div>
      </div>

      {staleReviewNotice ? (
        <div className="alert-banner alert-banner--warning" role="alert">
          <div className="alert-banner__content">
            <p>{staleReviewNotice}</p>
          </div>
        </div>
      ) : null}

      {submitError ? (
        <div
          className={
            submitError.isRetryableNetwork
              ? 'alert-banner alert-banner--warning'
              : 'alert-banner alert-banner--error'
          }
          role="alert"
        >
          <div className="alert-banner__content">
            <p>{submitError.message}</p>
            {submitError.requestId ? (
              <p className="alert-banner__meta">Request ID: {submitError.requestId}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <form className="catalog-modal-form" onSubmit={handleSubmit} noValidate>
        <fieldset className="catalog-inline-fieldset">
          <legend>Cancellation scope</legend>
          <label>
            <input
              type="radio"
              name="cancelScope"
              value="ALL"
              checked={cancelScope === 'ALL'}
              onChange={() => {
                setCancelScope('ALL');
                setLinesError(undefined);
                setPendingAttempt(null);
              }}
            />{' '}
            Cancel all remaining open quantities ({po.totalOpenQuantity} units across{' '}
            {openLines.length} line{openLines.length === 1 ? '' : 's'})
          </label>
          <label>
            <input
              type="radio"
              name="cancelScope"
              value="SELECTED"
              checked={cancelScope === 'SELECTED'}
              onChange={() => {
                setCancelScope('SELECTED');
                setLinesError(undefined);
                setPendingAttempt(null);
              }}
            />{' '}
            Select specific open lines
          </label>
        </fieldset>

        {cancelScope === 'SELECTED' ? (
          <div className="catalog-field">
            <span className="catalog-label">Open order lines</span>
            <ul className="cancel-lines-list" aria-describedby={linesError ? linesErrorId : undefined}>
              {openLines.map((line) => (
                <li key={line.poLineId} className="cancel-line-item">
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedLineIds.includes(line.poLineId)}
                      onChange={() => toggleLine(line.poLineId)}
                    />
                    <span>
                      {line.productName} — <code>{line.skuCode}</code> (Size:{' '}
                      {line.size ?? '—'})
                    </span>
                  </label>
                  <p className="cancel-line-item__counts">
                    Ordered: {line.orderedQuantity} · Received: {line.receivedQuantity} ·
                    Cancelled: {line.cancelledQuantity} · Open to cancel:{' '}
                    <strong>{line.openQuantity}</strong>
                  </p>
                </li>
              ))}
            </ul>
            {linesError ? (
              <p id={linesErrorId} className="catalog-field-error">
                <span aria-hidden="true">!</span>
                <span>{linesError}</span>
              </p>
            ) : null}
          </div>
        ) : (
          <div className="catalog-added-list" aria-label="Open lines that will be cancelled">
            <p className="catalog-added-list__title">Open lines affected:</p>
            <ul>
              {openLines.map((line) => (
                <li key={line.poLineId}>
                  <code>{line.skuCode}</code> ({line.productName}
                  {line.size ? `, Size ${line.size}` : ''}) — Received: {line.receivedQuantity},
                  Open to cancel: <strong>{line.openQuantity}</strong>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="catalog-field">
          <label htmlFor={reasonId} className="catalog-label">
            Cancellation reason <span className="form-required" aria-hidden="true">*</span>
          </label>
          <textarea
            ref={reasonRef}
            id={reasonId}
            name="reason"
            className="cancel-reason-textarea"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setPendingAttempt(null);
              if (reasonError && event.target.value.trim()) {
                setReasonError(undefined);
              }
            }}
            maxLength={500}
            required
            aria-invalid={reasonError ? 'true' : 'false'}
            aria-describedby={reasonError ? reasonErrorId : undefined}
          />
          {reasonError ? (
            <p id={reasonErrorId} className="catalog-field-error">
              <span aria-hidden="true">!</span>
              <span>{reasonError}</span>
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
            Close
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={isSubmitting || openLines.length === 0}
            aria-busy={isSubmitting}
          >
            {isSubmitting
              ? 'Cancelling…'
              : pendingAttempt
                ? 'Retry cancellation'
                : 'Confirm cancellation'}
          </button>
        </div>
      </form>
    </>
  );
}

export function CancelRemainderModal({
  open,
  po,
  api,
  onClose,
  onCancelled,
  onReloadOrder,
}: CancelRemainderModalProps) {
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
      title="Cancel remaining quantity"
      onClose={handleClose}
      preventClose={isSubmitting}
    >
      {open ? (
        <CancelRemainderContent
          po={po}
          api={api}
          isSubmitting={isSubmitting}
          onSubmittingChange={setIsSubmitting}
          onClose={handleClose}
          onCancelled={onCancelled}
          onReloadOrder={onReloadOrder}
        />
      ) : null}
    </ModalDialog>
  );
}
