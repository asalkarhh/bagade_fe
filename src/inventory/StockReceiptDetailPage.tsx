import { useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { isAbortError, isApiClientError } from '../api/errors.ts';
import { getPoStatusDisplay } from '../purchasing/statusLabels.ts';
import { formatInrDisplay } from '../utils/inrPrice.ts';
import { TagPrintPreviewModal, type TagPrintMode } from './components/TagPrintPreviewModal.tsx';
import { inventoryApi, type InventoryApi } from './inventoryApi.ts';
import { recordSessionReceipt } from './sessionReceipts.ts';
import type { StockReceiptDetail } from './types.ts';
import '../catalog/ProductsPage.css';
import './Inventory.css';

export interface StockReceiptDetailPageProps {
  api?: InventoryApi;
}

interface ReceiptState {
  receiptId: string;
  receipt: StockReceiptDetail | null;
  error: { message: string; code?: string; requestId?: string | null } | null;
}

export function StockReceiptDetailPage({ api = inventoryApi }: StockReceiptDetailPageProps) {
  const { receiptId = '' } = useParams<{ receiptId: string }>();
  const captionId = useId();

  const [refreshTick, setRefreshTick] = useState(0);
  const [receiptState, setReceiptState] = useState<ReceiptState | null>(null);
  const [printedBatchIds, setPrintedBatchIds] = useState<Record<string, boolean>>({});
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const [tagModalState, setTagModalState] = useState<{
    batchId: string;
    mode: TagPrintMode;
    defaultCopies: number;
  } | null>(null);

  useEffect(() => {
    if (!receiptId) {
      return;
    }

    const controller = new AbortController();
    api
      .getStockReceipt(receiptId, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) {
          return;
        }
        document.title = `${loaded.receiptNumber} | Stock Receipt | Bagade Clothing`;
        recordSessionReceipt(loaded);
        setReceiptState({ receiptId, receipt: loaded, error: null });
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || controller.signal.aborted) {
          return;
        }
        document.title = 'Stock Receipt | Bagade Clothing';
        setReceiptState({
          receiptId,
          receipt: null,
          error: isApiClientError(error)
            ? { message: error.message, code: error.code, requestId: error.requestId }
            : { message: 'Could not load stock receipt.' },
        });
      });

    return () => {
      controller.abort();
    };
  }, [api, receiptId, refreshTick]);

  const isLoading = Boolean(receiptId) && receiptState?.receiptId !== receiptId;
  const receipt = receiptState?.receiptId === receiptId ? receiptState.receipt : null;
  const loadError = receiptState?.receiptId === receiptId ? receiptState.error : null;

  if (isLoading) {
    return (
      <section className="surface-card module-page" aria-busy="true">
        <h1 id="main-content" tabIndex={-1}>
          Loading stock receipt…
        </h1>
        <progress className="state-progress" aria-label="Loading stock receipt" />
      </section>
    );
  }

  if (loadError || !receipt) {
    return (
      <section className="surface-card module-page">
        <p>
          <Link to="/inventory">← Back to Inventory</Link>
        </p>
        <h1 id="main-content" tabIndex={-1}>
          {loadError?.code === 'RESOURCE_NOT_FOUND'
            ? 'Stock receipt not found'
            : 'Unable to load stock receipt'}
        </h1>
        <div className="alert-banner alert-banner--error" role="alert">
          <div className="alert-banner__content">
            <p>{loadError?.message ?? 'Stock receipt could not be retrieved.'}</p>
            {loadError?.requestId ? (
              <p className="alert-banner__meta">Request ID: {loadError.requestId}</p>
            ) : null}
            {loadError?.code !== 'RESOURCE_NOT_FOUND' ? (
              <div className="alert-banner__actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setRefreshTick((prev) => prev + 1)}
                >
                  Retry
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  const receiptPath = `/inventory/receipts/${receipt.receiptId}`;
  const poStatusDisplay = receipt.poStatus ? getPoStatusDisplay(receipt.poStatus) : null;

  const handleCopyLink = async () => {
    const shareUrl =
      typeof window !== 'undefined' && window.location?.origin
        ? `${window.location.origin}${receiptPath}`
        : receiptPath;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setCopyStatus('Receipt link copied to clipboard.');
        return;
      } catch {
        // Fallback notice below
      }
    }
    setCopyStatus(`Reopen link: ${receiptPath}`);
  };

  return (
    <div className="products-page">
      <div className="products-header">
        <div className="products-header__title-group">
          <p>
            <Link to="/inventory">← View Inventory</Link>
            {receipt.poId && receipt.poNumber ? (
              <>
                {' · '}
                <Link to={`/purchases/${receipt.poId}`}>Back to {receipt.poNumber}</Link>
              </>
            ) : null}
          </p>
          <h1 id="main-content" tabIndex={-1}>
            {receipt.receiptNumber}
          </h1>
          <p className="products-header__subtitle">
            Stock receipt posted on {receipt.receivedDate}. Generate or print Code 128 garment tags
            for any created batch.
          </p>
        </div>

        <div className="products-header__actions">
          <Link to="/purchases/receive" className="btn-secondary">
            Direct Receipt
          </Link>
          {receipt.poId &&
          receipt.poTotalOpenQuantity !== null &&
          receipt.poTotalOpenQuantity > 0 ? (
            <Link to={`/purchases/${receipt.poId}/receive`} className="btn-primary">
              Receive more on {receipt.poNumber}
            </Link>
          ) : null}
        </div>
      </div>

      <section className="surface-card" aria-label="Receipt link">
        <div className="receipt-link-box">
          <span>Reopen receipt link:</span>
          <Link to={receiptPath} className="po-link">
            <code>{receiptPath}</code>
          </Link>
          <button
            type="button"
            className="btn-table-action"
            onClick={() => {
              void handleCopyLink();
            }}
          >
            Copy link
          </button>
          {copyStatus ? (
            <span className="catalog-refreshing" role="status">
              {copyStatus}
            </span>
          ) : null}
        </div>
      </section>

      <section className="surface-card" aria-label="Stock receipt summary">
        <dl className="po-detail-meta">
          <div>
            <dt>Vendor</dt>
            <dd>{receipt.vendorName}</dd>
          </div>
          <div>
            <dt>Received date</dt>
            <dd>{receipt.receivedDate}</dd>
          </div>
          <div>
            <dt>Vendor invoice ref</dt>
            <dd>{receipt.vendorInvoiceRef ?? '—'}</dd>
          </div>
          <div>
            <dt>Purchase order</dt>
            <dd>
              {receipt.poId && receipt.poNumber ? (
                <>
                  <Link to={`/purchases/${receipt.poId}`} className="po-link">
                    {receipt.poNumber}
                  </Link>{' '}
                  {poStatusDisplay ? (
                    <span className={`po-status-pill po-status-pill--${poStatusDisplay.variant}`}>
                      <span aria-hidden="true">{poStatusDisplay.symbol}</span>
                      <span>{poStatusDisplay.label}</span>
                    </span>
                  ) : null}
                </>
              ) : (
                'Direct purchase (no PO)'
              )}
            </dd>
          </div>
          {receipt.poTotalOpenQuantity !== null ? (
            <div>
              <dt>PO total open remaining</dt>
              <dd>{receipt.poTotalOpenQuantity}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="surface-card catalog-results-card" aria-label="Received batches">
        <div className="catalog-results-bar">
          <span id={captionId} className="catalog-results-count">
            {receipt.lines.length} received batch{receipt.lines.length === 1 ? '' : 'es'}
          </span>
        </div>

        <div
          tabIndex={0}
          role="region"
          aria-labelledby={captionId}
          className="catalog-table-wrapper"
        >
          <table className="catalog-table">
            <caption className="visually-hidden">
              Received stock lines, batches, PO balances, and tag printing controls
            </caption>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">SKU code</th>
                <th scope="col">Size</th>
                <th scope="col" className="cell-num">
                  Received
                </th>
                <th scope="col" className="cell-num">
                  Unit cost
                </th>
                <th scope="col" className="cell-num">
                  Printed MRP
                </th>
                {receipt.poId ? (
                  <th scope="col" className="cell-num">
                    PO line open
                  </th>
                ) : null}
                <th scope="col">Batch tag code</th>
                <th scope="col">Tag actions</th>
              </tr>
            </thead>
            <tbody>
              {receipt.lines.map((line) => {
                const hasBarcode = Boolean(line.internalBarcode);
                const hasPrintedInView = Boolean(printedBatchIds[line.batchId]);
                const defaultCopies = hasPrintedInView ? 1 : line.quantity;

                return (
                  <tr key={line.receiptLineId}>
                    <th scope="row">{line.productName}</th>
                    <td data-label="SKU code" className="cell-code">
                      <code>{line.skuCode}</code>
                    </td>
                    <td data-label="Size">{line.size ?? '—'}</td>
                    <td data-label="Received" className="cell-num">
                      {line.quantity}
                    </td>
                    <td data-label="Unit cost" className="cell-num">
                      {formatInrDisplay(line.unitCost)}
                    </td>
                    <td data-label="Printed MRP" className="cell-num">
                      {line.printedMrp !== null ? formatInrDisplay(line.printedMrp) : '—'}
                    </td>
                    {receipt.poId ? (
                      <td data-label="PO line open" className="cell-num">
                        {line.poLineOpenQuantity ?? '—'}
                      </td>
                    ) : null}
                    <td data-label="Batch tag code" className="cell-code">
                      {line.internalBarcode ? (
                        <code>{line.internalBarcode}</code>
                      ) : (
                        'Not generated'
                      )}
                    </td>
                    <td data-label="Tag actions" className="cell-actions">
                      <div className="cell-actions__group">
                        {hasBarcode ? (
                          <button
                            type="button"
                            className="btn-table-action"
                            onClick={() =>
                              setTagModalState({
                                batchId: line.batchId,
                                mode: hasPrintedInView ? 'reprint' : 'print',
                                defaultCopies,
                              })
                            }
                          >
                            {hasPrintedInView ? 'Reprint Tag' : 'Print Tag'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-table-action"
                            onClick={() =>
                              setTagModalState({
                                batchId: line.batchId,
                                mode: 'generate',
                                defaultCopies: line.quantity,
                              })
                            }
                          >
                            Generate Tag
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <TagPrintPreviewModal
        open={tagModalState !== null}
        batchId={tagModalState?.batchId ?? null}
        mode={tagModalState?.mode ?? 'print'}
        defaultCopies={tagModalState?.defaultCopies ?? 1}
        api={api}
        onClose={() => setTagModalState(null)}
        onLabelLoaded={(batchId, code) => {
          setReceiptState((prev) => {
            if (!prev || !prev.receipt || prev.receiptId !== receipt.receiptId) {
              return prev;
            }
            return {
              ...prev,
              receipt: {
                ...prev.receipt,
                lines: prev.receipt.lines.map((line) =>
                  line.batchId === batchId ? { ...line, internalBarcode: code } : line,
                ),
              },
            };
          });
        }}
        onPrinted={(batchId) => {
          setPrintedBatchIds((prev) => ({ ...prev, [batchId]: true }));
        }}
      />
    </div>
  );
}
