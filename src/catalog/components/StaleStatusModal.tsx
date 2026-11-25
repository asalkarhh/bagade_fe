import { useRef, useState } from 'react';
import { isApiClientError } from '../../api/errors.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { formatInrDisplay } from '../../utils/inrPrice.ts';
import type { CatalogApi } from '../catalogApi.ts';
import type { SkuDetail, SkuListItem } from '../types.ts';

export interface StaleStatusConflict {
  latestSku: SkuListItem;
  attemptedActive: boolean;
  requestId?: string | null;
}

export interface StaleStatusModalProps {
  conflict: StaleStatusConflict | null;
  api: CatalogApi;
  onClose: () => void;
  onResolved: (updated: SkuDetail) => Promise<void> | void;
}

export function StaleStatusModal({
  conflict,
  api,
  onClose,
  onResolved,
}: StaleStatusModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentConflict, setCurrentConflict] = useState<StaleStatusConflict | null>(null);
  const submittingRef = useRef(false);

  const activeConflict = currentConflict ?? conflict;

  const handleClose = () => {
    if (isSubmitting) {
      return;
    }
    setCurrentConflict(null);
    setErrorMessage(null);
    onClose();
  };

  const handleConfirm = async () => {
    if (!activeConflict || submittingRef.current || isSubmitting) {
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const updated = await api.updateSku(activeConflict.latestSku.skuId, {
        expectedVersion: activeConflict.latestSku.version,
        active: activeConflict.attemptedActive,
      });
      setCurrentConflict(null);
      await onResolved(updated);
      onClose();
    } catch (error) {
      if (isApiClientError(error) && error.code === 'STALE_VERSION') {
        const refreshed = await api
          .findLatestSkuById(
            activeConflict.latestSku.skuId,
            activeConflict.latestSku.skuCode,
          )
          .catch(() => null);
        if (refreshed) {
          setCurrentConflict({
            latestSku: refreshed,
            attemptedActive: activeConflict.attemptedActive,
            requestId: error.requestId,
          });
        }
        setErrorMessage(
          'This SKU changed again on the server. Review the latest values and confirm if you still want to apply the status change.',
        );
      } else if (isApiClientError(error)) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage('Could not apply status update. Please retry.');
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const targetActionLabel = activeConflict?.attemptedActive ? 'Activate SKU' : 'Deactivate SKU';

  return (
    <ModalDialog
      open={Boolean(conflict)}
      title="Review SKU status conflict"
      onClose={handleClose}
      preventClose={isSubmitting}
    >
      {activeConflict ? (
        <>
          <div className="alert-banner alert-banner--warning" role="alert">
            <div className="alert-banner__content">
              <p>
                {errorMessage ??
                  'This SKU was updated by another request before your status change ran. Review the current server values before submitting again.'}
              </p>
              {activeConflict.requestId ? (
                <p className="alert-banner__meta">Request ID: {activeConflict.requestId}</p>
              ) : null}
            </div>
          </div>

          <dl className="catalog-summary-grid">
            <div>
              <dt>Product</dt>
              <dd>{activeConflict.latestSku.productName}</dd>
            </div>
            <div>
              <dt>SKU code</dt>
              <dd>
                <code>{activeConflict.latestSku.skuCode}</code>
              </dd>
            </div>
            <div>
              <dt>Current price</dt>
              <dd>{formatInrDisplay(activeConflict.latestSku.defaultSellingPrice)}</dd>
            </div>
            <div>
              <dt>Current server status</dt>
              <dd>{activeConflict.latestSku.active ? 'Active' : 'Inactive'}</dd>
            </div>
            <div>
              <dt>Attempted status</dt>
              <dd>{activeConflict.attemptedActive ? 'Active' : 'Inactive'}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{activeConflict.latestSku.version}</dd>
            </div>
          </dl>

          <div className="catalog-modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
              onClick={() => {
                void handleConfirm();
              }}
            >
              {isSubmitting ? 'Applying…' : targetActionLabel}
            </button>
          </div>
        </>
      ) : null}
    </ModalDialog>
  );
}
