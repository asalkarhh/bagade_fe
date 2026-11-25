import { useCallback, useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { isAbortError, isApiClientError } from '../api/errors.ts';
import { useRecentSessionReceipts } from '../inventory/sessionReceipts.ts';
import { formatInrDisplay } from '../utils/inrPrice.ts';
import { CancelRemainderModal } from './components/CancelRemainderModal.tsx';
import { purchasingApi, type PurchasingApi } from './purchasingApi.ts';
import { getPoStatusDisplay } from './statusLabels.ts';
import type { PurchaseOrderDetail } from './types.ts';

export interface PurchaseOrderDetailPageProps {
  api?: PurchasingApi;
}

interface DetailState {
  poId: string;
  po: PurchaseOrderDetail | null;
  error: { message: string; code?: string; requestId?: string | null } | null;
}

export function PurchaseOrderDetailPage({ api = purchasingApi }: PurchaseOrderDetailPageProps) {
  const { poId = '' } = useParams<{ poId: string }>();
  const tableCaptionId = useId();

  const [refreshTick, setRefreshTick] = useState(0);
  const [detailState, setDetailState] = useState<DetailState | null>(null);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!poId) {
      return;
    }

    const controller = new AbortController();
    api
      .getPurchaseOrder(poId, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) {
          return;
        }
        document.title = `${loaded.poNumber} | Purchase Orders | Bagade Clothing`;
        setDetailState({ poId, po: loaded, error: null });
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || controller.signal.aborted) {
          return;
        }
        document.title = 'Purchase Order | Bagade Clothing';
        setDetailState({
          poId,
          po: null,
          error: isApiClientError(error)
            ? { message: error.message, code: error.code, requestId: error.requestId }
            : { message: 'Could not load purchase order.' },
        });
      });

    return () => {
      controller.abort();
    };
  }, [api, poId, refreshTick]);

  const reloadOrder = useCallback(async (): Promise<PurchaseOrderDetail | null> => {
    if (!poId) {
      return null;
    }
    try {
      const latest = await api.getPurchaseOrder(poId);
      setDetailState({ poId, po: latest, error: null });
      return latest;
    } catch {
      return null;
    }
  }, [api, poId]);

  const recentReceipts = useRecentSessionReceipts().filter((r) => r.poId === poId);
  const isLoading = Boolean(poId) && detailState?.poId !== poId;
  const po = detailState?.poId === poId ? detailState.po : null;
  const loadError = detailState?.poId === poId ? detailState.error : null;

  if (isLoading) {
    return (
      <section className="surface-card module-page" aria-busy="true">
        <h1 id="main-content" tabIndex={-1}>
          Loading purchase order…
        </h1>
        <progress className="state-progress" aria-label="Loading purchase order" />
      </section>
    );
  }

  if (loadError || !po) {
    return (
      <section className="surface-card module-page">
        <p>
          <Link to="/purchases">← Back to Purchase Orders</Link>
        </p>
        <h1 id="main-content" tabIndex={-1}>
          {loadError?.code === 'RESOURCE_NOT_FOUND'
            ? 'Purchase order not found'
            : 'Unable to load purchase order'}
        </h1>
        <div className="alert-banner alert-banner--error" role="alert">
          <div className="alert-banner__content">
            <p>{loadError?.message ?? 'Purchase order could not be retrieved.'}</p>
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

  const statusDisplay = getPoStatusDisplay(po.status);
  const canCancelRemainder =
    po.totalOpenQuantity > 0 && po.lines.some((line) => line.openQuantity > 0);

  return (
    <div className="products-page">
      <div className="products-header">
        <div className="products-header__title-group">
          <p>
            <Link to="/purchases">← Back to Purchase Orders</Link>
          </p>
          <h1 id="main-content" tabIndex={-1}>
            {po.poNumber}
          </h1>
          <p className="products-header__subtitle">
            Purchase order summary and line-level ordered, received, cancelled, and open
            quantities.
          </p>
        </div>

        <div className="products-header__actions">
          {canCancelRemainder ? (
            <>
              <Link to={`/purchases/${po.poId}/receive`} className="btn-primary">
                Receive Stock
              </Link>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsCancelModalOpen(true)}
              >
                Cancel Remaining Quantity
              </button>
            </>
          ) : null}
        </div>
      </div>

      {recentReceipts.length > 0 ? (
        <section className="surface-card" aria-label="Posted receipts for this purchase order">
          <div className="catalog-added-list">
            <span className="catalog-added-list__title">Posted receipts in this session</span>
            <ul>
              {recentReceipts.map((rcp) => (
                <li key={rcp.receiptId}>
                  <Link to={`/inventory/receipts/${rcp.receiptId}`} className="po-link">
                    {rcp.receiptNumber}
                  </Link>{' '}
                  — {rcp.totalUnits} unit{rcp.totalUnits === 1 ? '' : 's'} on {rcp.receivedDate}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {statusNotice ? (
        <div className="alert-banner alert-banner--info" role="status">
          <div className="alert-banner__content">
            <p>{statusNotice}</p>
          </div>
        </div>
      ) : null}

      <section className="surface-card" aria-label="Purchase order summary">
        <dl className="po-detail-meta">
          <div>
            <dt>Vendor</dt>
            <dd>{po.vendorName}</dd>
          </div>
          <div>
            <dt>Order date</dt>
            <dd>{po.orderDate}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <span className={`po-status-pill po-status-pill--${statusDisplay.variant}`}>
                <span aria-hidden="true">{statusDisplay.symbol}</span>
                <span>{statusDisplay.label}</span>
              </span>
            </dd>
          </div>
          <div>
            <dt>Total open quantity</dt>
            <dd>{po.totalOpenQuantity}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{po.version}</dd>
          </div>
        </dl>
      </section>

      <section className="surface-card catalog-results-card" aria-label="Purchase order lines">
        <div className="catalog-results-bar">
          <span id={tableCaptionId} className="catalog-results-count">
            {po.lines.length} order line{po.lines.length === 1 ? '' : 's'}
          </span>
        </div>

        <div
          tabIndex={0}
          role="region"
          aria-labelledby={tableCaptionId}
          className="catalog-table-wrapper"
        >
          <table className="catalog-table">
            <caption className="visually-hidden">
              Order lines showing SKU, size, agreed unit cost, ordered, received, cancelled, and
              open quantities
            </caption>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">SKU code</th>
                <th scope="col">Size</th>
                <th scope="col" className="cell-num">
                  Agreed cost
                </th>
                <th scope="col" className="cell-num">
                  Ordered
                </th>
                <th scope="col" className="cell-num">
                  Received
                </th>
                <th scope="col" className="cell-num">
                  Cancelled
                </th>
                <th scope="col" className="cell-num">
                  Open
                </th>
              </tr>
            </thead>
            <tbody>
              {po.lines.map((line) => (
                <tr key={line.poLineId}>
                  <th scope="row">{line.productName}</th>
                  <td data-label="SKU code" className="cell-code">
                    <code>{line.skuCode}</code>
                  </td>
                  <td data-label="Size">{line.size ?? '—'}</td>
                  <td data-label="Agreed cost" className="cell-num">
                    {line.agreedUnitCost !== null ? formatInrDisplay(line.agreedUnitCost) : '—'}
                  </td>
                  <td data-label="Ordered" className="cell-num">
                    {line.orderedQuantity}
                  </td>
                  <td data-label="Received" className="cell-num">
                    {line.receivedQuantity}
                  </td>
                  <td data-label="Cancelled" className="cell-num">
                    {line.cancelledQuantity}
                  </td>
                  <td data-label="Open" className="cell-num">
                    {line.openQuantity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <CancelRemainderModal
        open={isCancelModalOpen}
        po={po}
        api={api}
        onClose={() => setIsCancelModalOpen(false)}
        onCancelled={(updated) => {
          setDetailState({ poId, po: updated, error: null });
          setStatusNotice(
            `Updated ${updated.poNumber}: status is now ${getPoStatusDisplay(updated.status).label} with ${updated.totalOpenQuantity} open unit(s). Received quantities remain unchanged.`,
          );
        }}
        onReloadOrder={reloadOrder}
      />
    </div>
  );
}
