import type { EligibleBatch } from '../../inventory/types.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { formatInrDisplay } from '../../utils/inrPrice.ts';

export interface BatchSelectionTarget {
  productName: string;
  size: string | null;
  skuCode?: string | null;
  defaultSellingPrice: string;
  batches: EligibleBatch[];
}

export interface BatchSelectionModalProps {
  open: boolean;
  target: BatchSelectionTarget | null;
  onClose: () => void;
  onSelectBatch: (batch: EligibleBatch) => void;
}

export function BatchSelectionModal({
  open,
  target,
  onClose,
  onSelectBatch,
}: BatchSelectionModalProps) {
  return (
    <ModalDialog
      open={open && Boolean(target)}
      title="Select stock batch (differing printed MRPs)"
      onClose={onClose}
    >
      {open && target ? (
        <>
          <div className="alert-banner alert-banner--info" role="status">
            <div className="alert-banner__content">
              <p>
                <strong>{target.productName}</strong>
                {target.size ? ` · Size: ${target.size}` : ' · Unsized'}
                {target.skuCode ? ` · SKU: ${target.skuCode}` : ''}
              </p>
              <p>
                Shop selling price: <strong>{formatInrDisplay(target.defaultSellingPrice)}</strong>.
                Select which printed-MRP batch is being billed:
              </p>
            </div>
          </div>

          <ul className="cancel-lines-list" aria-label="Eligible sellable batches">
            {target.batches.map((batch) => (
              <li key={batch.batchId} className="cancel-line-item">
                <div className="po-line-card__top">
                  <span>
                    Printed MRP:{' '}
                    <strong>
                      {batch.printedMrp !== null ? formatInrDisplay(batch.printedMrp) : 'Unprinted'}
                    </strong>
                  </span>
                  <button
                    type="button"
                    className="btn-table-action"
                    onClick={() => onSelectBatch(batch)}
                  >
                    Select batch
                  </button>
                </div>
                <p className="cancel-line-item__counts">
                  Available sellable: <strong>{batch.sellableQuantity}</strong> · Received:{' '}
                  {batch.receivedDate}
                  {batch.internalBarcode ? ` · Tag: ${batch.internalBarcode}` : ''}
                </p>
              </li>
            ))}
          </ul>

          <div className="catalog-modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      ) : null}
    </ModalDialog>
  );
}
