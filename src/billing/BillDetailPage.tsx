import { useCallback, useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { isAbortError, isApiClientError } from '../api/errors.ts';
import { catalogApi, type CatalogApi } from '../catalog/catalogApi.ts';
import { inventoryApi, type InventoryApi } from '../inventory/inventoryApi.ts';
import { triggerBrowserBlobDownload } from '../utils/blobDownload.ts';
import { formatInrDisplay, parseInrToPaise } from '../utils/inrPrice.ts';
import { formatShopTimestamp } from '../utils/shopDate.ts';
import { billingApi, type BillingApi } from './billingApi.ts';
import { BillCancelWorkflow } from './components/BillCancelWorkflow.tsx';
import { BillEditWorkflow } from './components/BillEditWorkflow.tsx';
import {
  BillExchangeWorkflow,
  ExchangeConfirmationBanner,
} from './components/BillExchangeWorkflow.tsx';
import { BillPrintPreviewModal } from './components/BillPrintPreviewModal.tsx';
import {
  BillReturnWorkflow,
  ReturnConfirmationBanner,
} from './components/BillReturnWorkflow.tsx';
import { CollectCreditPaymentWorkflow } from './components/CollectCreditPaymentWorkflow.tsx';
import { getBillStatusDisplay } from './statusLabels.ts';
import type {
  BillDetail,
  CancelBillResponse,
  CollectBillPaymentResponse,
  EditBillResponse,
  ExchangeBillResponse,
  ReturnBillResponse,
} from './types.ts';
import '../catalog/ProductsPage.css';
import '../purchasing/Purchasing.css';
import '../inventory/Inventory.css';
import './Billing.css';

export interface BillDetailPageProps {
  api?: BillingApi;
  inventory?: InventoryApi;
  catalog?: CatalogApi;
}

type ActiveWorkflowKind = 'edit' | 'return' | 'exchange' | 'cancel' | 'payment' | null;

type WorkflowConfirmationState =
  | { kind: 'edit'; message: string; result: EditBillResponse }
  | { kind: 'return'; message: string; result: ReturnBillResponse }
  | { kind: 'exchange'; message: string; result: ExchangeBillResponse }
  | { kind: 'cancel'; message: string; result: CancelBillResponse }
  | { kind: 'payment'; message: string; result: CollectBillPaymentResponse };

interface BillDetailState {
  billId: string;
  bill: BillDetail | null;
  error: { message: string; code?: string; requestId?: string | null } | null;
}

export function BillDetailPage({
  api = billingApi,
  inventory = inventoryApi,
  catalog = catalogApi,
}: BillDetailPageProps) {
  const { billId = '' } = useParams<{ billId: string }>();
  const linesCaptionId = useId();
  const paymentsCaptionId = useId();
  const eventsCaptionId = useId();
  const revisionSelectId = useId();

  const [refreshTick, setRefreshTick] = useState(0);
  const [detailState, setDetailState] = useState<BillDetailState | null>(null);
  const [selectedRevisionOverride, setSelectedRevisionOverride] = useState<{
    billId: string;
    revision: number | null;
  } | null>(null);
  const [activeWorkflow, setActiveWorkflow] = useState<ActiveWorkflowKind>(null);
  const [confirmation, setConfirmation] = useState<WorkflowConfirmationState | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    if (!billId) {
      return;
    }

    const controller = new AbortController();
    api
      .getBill(billId, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) {
          return;
        }
        document.title = `${loaded.billNumber} | Bills | Bagade Clothing`;
        setDetailState({ billId, bill: loaded, error: null });
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || controller.signal.aborted) {
          return;
        }
        document.title = 'Bill Detail | Bagade Clothing';
        setDetailState({
          billId,
          bill: null,
          error: isApiClientError(error)
            ? { message: error.message, code: error.code, requestId: error.requestId }
            : { message: 'Unable to load bill detail.' },
        });
      });

    return () => {
      controller.abort();
    };
  }, [api, billId, refreshTick]);

  const reloadBill = useCallback(async (): Promise<BillDetail | null> => {
    if (!billId) {
      return null;
    }
    try {
      const latest = await api.getBill(billId);
      setDetailState({ billId, bill: latest, error: null });
      return latest;
    } catch {
      return null;
    }
  }, [api, billId]);

  const refreshDependentCaches = useCallback(
    async (stockChanged: boolean) => {
      await reloadBill();
      void Promise.resolve(api.listBills({ page: 0, size: 25 })).catch(() => undefined);
      if (stockChanged) {
        void Promise.resolve(inventory.listInventory({ page: 0, size: 25 })).catch(() => undefined);
        void Promise.resolve(catalog.listSkus({ status: 'ACTIVE', page: 0, size: 25 })).catch(
          () => undefined,
        );
      }
    },
    [api, catalog, inventory, reloadBill],
  );

  const isLoading = Boolean(billId) && detailState?.billId !== billId;
  const bill = detailState?.billId === billId ? detailState.bill : null;
  const loadError = detailState?.billId === billId ? detailState.error : null;

  if (isLoading) {
    return (
      <section className="surface-card module-page" aria-busy="true">
        <h1 id="main-content" tabIndex={-1}>
          Loading bill…
        </h1>
        <progress className="state-progress" aria-label="Loading bill" />
      </section>
    );
  }

  if (loadError || !bill) {
    return (
      <section className="surface-card module-page">
        <p>
          <Link to="/billing/history">← Back to Bill History</Link>
        </p>
        <h1 id="main-content" tabIndex={-1}>
          {loadError?.code === 'RESOURCE_NOT_FOUND' ? 'Bill not found' : 'Unable to load bill'}
        </h1>
        <div className="alert-banner alert-banner--error" role="alert">
          <div className="alert-banner__content">
            <p>{loadError?.message ?? 'Bill details could not be retrieved.'}</p>
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

  const statusDisplay = getBillStatusDisplay(bill.status);
  const selectedRevision =
    selectedRevisionOverride?.billId === bill.billId ? selectedRevisionOverride.revision : null;

  const balanceDuePaise = parseInrToPaise(bill.balanceDue) ?? 0;
  const hasReturnableItems = bill.lines.some((line) => line.returnableQuantity > 0);
  const isCancelled = bill.status === 'CANCELLED';

  const canEdit = bill.status === 'ISSUED' || bill.status === 'PARTIALLY_RETURNED';
  const canReturnOrExchange = !isCancelled && hasReturnableItems;
  const canCancel = !isCancelled;
  const canCollectPayment = !isCancelled && balanceDuePaise > 0;

  const handleDownloadPdf = async () => {
    if (isDownloadingPdf) {
      return;
    }
    setIsDownloadingPdf(true);
    setPdfError(null);

    try {
      const { blob, filename } = await api.downloadBillPdf(bill.billId, selectedRevision);
      const fallbackSuffix = selectedRevision !== null ? `-rev${selectedRevision}` : '';
      triggerBrowserBlobDownload(blob, filename || `${bill.billNumber}${fallbackSuffix}.pdf`);
    } catch (error) {
      setPdfError(
        isApiClientError(error)
          ? error.message
          : 'Unable to download bill PDF. Please try again.',
      );
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const openWorkflow = (kind: ActiveWorkflowKind) => {
    setConfirmation(null);
    setActiveWorkflow(kind);
  };

  return (
    <div className="products-page">
      <div className="products-header">
        <div className="products-header__title-group">
          <p>
            <Link to="/billing/history">← Back to Bill History</Link>
          </p>
          <h1 id="main-content" tabIndex={-1}>
            {bill.billNumber}
          </h1>
          <p className="products-header__subtitle">
            Revision {bill.currentRevisionNumber} · Version {bill.version} · Corrections, returns,
            exchanges, credit collections, and 80 mm receipts.
          </p>
        </div>

        <div className="products-header__actions billing-revision-bar">
          {bill.revisions.length > 0 ? (
            <div className="catalog-filter-field">
              <label htmlFor={revisionSelectId} className="catalog-label">
                Receipt revision
              </label>
              <select
                id={revisionSelectId}
                className="catalog-select"
                value={selectedRevision === null ? 'current' : String(selectedRevision)}
                onChange={(event) => {
                  setPdfError(null);
                  const val = event.target.value;
                  setSelectedRevisionOverride({
                    billId: bill.billId,
                    revision: val === 'current' ? null : Number(val),
                  });
                }}
              >
                <option value="current">
                  Current receipt (Rev {bill.currentRevisionNumber} + corrections &amp; payments)
                </option>
                {bill.revisions.map((rev) => (
                  <option key={rev.revisionId} value={rev.revisionNumber}>
                    Rev {rev.revisionNumber} — {formatInrDisplay(rev.total)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <button
            type="button"
            className="btn-primary"
            onClick={() => setIsPrintModalOpen(true)}
          >
            Print Receipt (80 mm)
          </button>

          <button
            type="button"
            className="btn-secondary"
            disabled={isDownloadingPdf}
            aria-busy={isDownloadingPdf}
            onClick={() => {
              void handleDownloadPdf();
            }}
          >
            {isDownloadingPdf ? 'Downloading PDF…' : 'Download PDF'}
          </button>
        </div>
      </div>

      {isCancelled ? (
        <div className="alert-banner alert-banner--info" role="status">
          <div className="alert-banner__content">
            <p>
              <strong>{bill.billNumber} is cancelled.</strong> The bill remains viewable and
              printable, and no further edits, returns, exchanges, or credit collections can be
              posted.
            </p>
          </div>
        </div>
      ) : (
        <section className="surface-card billing-counter-panel" aria-label="Bill correction and payment actions">
          <div className="po-line-card__top">
            <span className="catalog-label">Operations on {bill.billNumber}</span>
            <span className="catalog-field-hint">
              Available actions reflect current status ({statusDisplay.label}) and remaining
              returnable quantities.
            </span>
          </div>
          <div className="billing-actions-bar">
            {canCollectPayment ? (
              <button
                type="button"
                className="btn-primary"
                aria-expanded={activeWorkflow === 'payment'}
                onClick={() => openWorkflow(activeWorkflow === 'payment' ? null : 'payment')}
              >
                Record Payment ({formatInrDisplay(bill.balanceDue)} due)
              </button>
            ) : null}
            {canEdit ? (
              <button
                type="button"
                className="btn-secondary"
                aria-expanded={activeWorkflow === 'edit'}
                onClick={() => openWorkflow(activeWorkflow === 'edit' ? null : 'edit')}
              >
                Edit Bill
              </button>
            ) : null}
            {canReturnOrExchange ? (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  aria-expanded={activeWorkflow === 'return'}
                  onClick={() => openWorkflow(activeWorkflow === 'return' ? null : 'return')}
                >
                  Return Items
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  aria-expanded={activeWorkflow === 'exchange'}
                  onClick={() => openWorkflow(activeWorkflow === 'exchange' ? null : 'exchange')}
                >
                  Exchange Items
                </button>
              </>
            ) : null}
            {canCancel ? (
              <button
                type="button"
                className="btn-secondary"
                aria-expanded={activeWorkflow === 'cancel'}
                onClick={() => openWorkflow(activeWorkflow === 'cancel' ? null : 'cancel')}
              >
                Cancel Bill
              </button>
            ) : null}
          </div>
        </section>
      )}

      {confirmation?.kind === 'return' ? (
        <ReturnConfirmationBanner message={confirmation.message} result={confirmation.result} />
      ) : confirmation?.kind === 'exchange' ? (
        <ExchangeConfirmationBanner message={confirmation.message} result={confirmation.result} />
      ) : confirmation ? (
        <div className="surface-card alert-banner--success" role="status">
          <p>
            <strong>{confirmation.message}</strong>
          </p>
        </div>
      ) : null}

      {activeWorkflow === 'edit' && canEdit ? (
        <BillEditWorkflow
          bill={bill}
          billing={api}
          inventory={inventory}
          catalog={catalog}
          onReloadBill={reloadBill}
          onCancelWorkflow={() => setActiveWorkflow(null)}
          onSuccess={({ message, result, stockChanged }) => {
            setActiveWorkflow(null);
            setSelectedRevisionOverride(null);
            setConfirmation({ kind: 'edit', message, result });
            void refreshDependentCaches(stockChanged);
          }}
        />
      ) : null}

      {activeWorkflow === 'return' && canReturnOrExchange ? (
        <BillReturnWorkflow
          bill={bill}
          api={api}
          onReloadBill={reloadBill}
          onCancelWorkflow={() => setActiveWorkflow(null)}
          onSuccess={({ message, result, stockChanged }) => {
            setActiveWorkflow(null);
            setSelectedRevisionOverride(null);
            setConfirmation({ kind: 'return', message, result });
            void refreshDependentCaches(stockChanged);
          }}
        />
      ) : null}

      {activeWorkflow === 'exchange' && canReturnOrExchange ? (
        <BillExchangeWorkflow
          bill={bill}
          billing={api}
          inventory={inventory}
          catalog={catalog}
          onReloadBill={reloadBill}
          onCancelWorkflow={() => setActiveWorkflow(null)}
          onSuccess={({ message, result, stockChanged }) => {
            setActiveWorkflow(null);
            setSelectedRevisionOverride(null);
            setConfirmation({ kind: 'exchange', message, result });
            void refreshDependentCaches(stockChanged);
          }}
        />
      ) : null}

      {activeWorkflow === 'cancel' && canCancel ? (
        <BillCancelWorkflow
          bill={bill}
          api={api}
          onReloadBill={reloadBill}
          onCancelWorkflow={() => setActiveWorkflow(null)}
          onSuccess={({ message, result, stockChanged }) => {
            setActiveWorkflow(null);
            setSelectedRevisionOverride(null);
            setConfirmation({ kind: 'cancel', message, result });
            void refreshDependentCaches(stockChanged);
          }}
        />
      ) : null}

      {activeWorkflow === 'payment' && canCollectPayment ? (
        <CollectCreditPaymentWorkflow
          bill={bill}
          api={api}
          onReloadBill={reloadBill}
          onCancelWorkflow={() => setActiveWorkflow(null)}
          onSuccess={({ message, result, stockChanged }) => {
            setActiveWorkflow(null);
            setConfirmation({ kind: 'payment', message, result });
            void refreshDependentCaches(stockChanged);
          }}
        />
      ) : null}

      {pdfError ? (
        <div className="alert-banner alert-banner--error" role="alert">
          <div className="alert-banner__content">
            <p>{pdfError}</p>
          </div>
        </div>
      ) : null}

      <section className="surface-card" aria-label="Bill summary">
        <dl className="po-detail-meta">
          <div>
            <dt>Status</dt>
            <dd>
              <span className={`bill-status-pill bill-status-pill--${statusDisplay.variant}`}>
                <span aria-hidden="true">{statusDisplay.symbol}</span>
                <span>{statusDisplay.label}</span>
              </span>
            </dd>
          </div>
          <div>
            <dt>Revision / Version</dt>
            <dd>
              Rev {bill.currentRevisionNumber} · v{bill.version}
            </dd>
          </div>
          <div>
            <dt>Issued on</dt>
            <dd>{formatShopTimestamp(bill.issuedAt)}</dd>
          </div>
          <div>
            <dt>Customer</dt>
            <dd>
              {bill.customerName
                ? `${bill.customerName}${bill.customerContact ? ` (${bill.customerContact})` : ''}`
                : 'Walk-in customer'}
            </dd>
          </div>
          <div>
            <dt>Subtotal</dt>
            <dd>{formatInrDisplay(bill.subtotal)}</dd>
          </div>
          <div>
            <dt>Discount</dt>
            <dd>-{formatInrDisplay(bill.discountTotal)}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{formatInrDisplay(bill.total)}</dd>
          </div>
          <div>
            <dt>Paid</dt>
            <dd>{formatInrDisplay(bill.paid)}</dd>
          </div>
          <div>
            <dt>Balance due</dt>
            <dd>{formatInrDisplay(bill.balanceDue)}</dd>
          </div>
        </dl>
      </section>

      <section className="surface-card catalog-results-card" aria-label="Billed items">
        <div className="catalog-results-bar">
          <span id={linesCaptionId} className="catalog-results-count">
            Billed items ({bill.lines.length} line{bill.lines.length === 1 ? '' : 's'}) — Current
            revision {bill.currentRevisionNumber}
          </span>
        </div>

        <div
          tabIndex={0}
          role="region"
          aria-labelledby={linesCaptionId}
          className="catalog-table-wrapper"
        >
          <table className="catalog-table">
            <caption className="visually-hidden">
              Saved billed items with sold, returned, and remaining returnable quantities, prices,
              and totals
            </caption>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">SKU</th>
                <th scope="col">Size</th>
                <th scope="col" className="cell-num">
                  Qty
                </th>
                <th scope="col" className="cell-num">
                  Returned
                </th>
                <th scope="col" className="cell-num">
                  Returnable
                </th>
                <th scope="col" className="cell-num">
                  Unit selling price
                </th>
                <th scope="col" className="cell-num">
                  Discount
                </th>
                <th scope="col" className="cell-num">
                  Line total
                </th>
              </tr>
            </thead>
            <tbody>
              {bill.lines.map((line) => (
                <tr key={line.billLineId}>
                  <th scope="row">{line.productName}</th>
                  <td data-label="SKU" className="cell-code">
                    <code>{line.skuCode}</code>
                  </td>
                  <td data-label="Size">{line.size ?? '—'}</td>
                  <td data-label="Qty" className="cell-num">
                    {line.quantity}
                  </td>
                  <td data-label="Returned" className="cell-num">
                    {line.returnedQuantity}
                  </td>
                  <td data-label="Returnable" className="cell-num">
                    {line.returnableQuantity}
                  </td>
                  <td data-label="Unit selling price" className="cell-num">
                    {formatInrDisplay(line.unitSellingPrice)}
                  </td>
                  <td data-label="Discount" className="cell-num">
                    -{formatInrDisplay(line.discountAmount)}
                  </td>
                  <td data-label="Line total" className="cell-num">
                    {formatInrDisplay(line.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface-card catalog-results-card" aria-label="Payments and refunds">
        <div className="catalog-results-bar">
          <span id={paymentsCaptionId} className="catalog-results-count">
            Payments &amp; refunds ({bill.payments.length})
          </span>
        </div>

        {bill.payments.length === 0 ? (
          <div className="catalog-empty-state">
            <p>
              No payments or refunds recorded (balance due: {formatInrDisplay(bill.balanceDue)}).
            </p>
          </div>
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-labelledby={paymentsCaptionId}
            className="catalog-table-wrapper"
          >
            <table className="catalog-table">
              <caption className="visually-hidden">
                Payments and refunds recorded on this bill
              </caption>
              <thead>
                <tr>
                  <th scope="col">Direction</th>
                  <th scope="col">Mode</th>
                  <th scope="col" className="cell-num">
                    Amount
                  </th>
                  <th scope="col">Reference</th>
                  <th scope="col">Posted at</th>
                </tr>
              </thead>
              <tbody>
                {bill.payments.map((payment) => (
                  <tr key={payment.paymentId}>
                    <th scope="row">{payment.direction}</th>
                    <td data-label="Mode">{payment.mode}</td>
                    <td data-label="Amount" className="cell-num">
                      {payment.direction === 'REFUND' ? '-' : ''}
                      {formatInrDisplay(payment.amount)}
                    </td>
                    <td data-label="Reference">{payment.reference ?? '—'}</td>
                    <td data-label="Posted at">{formatShopTimestamp(payment.postedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {bill.events.length > 0 ? (
        <section className="surface-card catalog-results-card" aria-label="Bill audit and corrections">
          <div className="catalog-results-bar">
            <span id={eventsCaptionId} className="catalog-results-count">
              Billing &amp; correction events ({bill.events.length})
            </span>
          </div>
          <div
            tabIndex={0}
            role="region"
            aria-labelledby={eventsCaptionId}
            className="catalog-table-wrapper"
          >
            <table className="catalog-table">
              <caption className="visually-hidden">
                Issue, revision, return, exchange, and cancellation events for this bill
              </caption>
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col" className="cell-num">
                    Revision
                  </th>
                  <th scope="col">Reason</th>
                  <th scope="col">Occurred at</th>
                </tr>
              </thead>
              <tbody>
                {bill.events.map((ev) => (
                  <tr key={ev.eventId}>
                    <th scope="row">{ev.eventType}</th>
                    <td data-label="Revision" className="cell-num">
                      Rev {ev.revisionNumber}
                    </td>
                    <td data-label="Reason">{ev.reason ?? '—'}</td>
                    <td data-label="Occurred at">{formatShopTimestamp(ev.occurredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <BillPrintPreviewModal
        open={isPrintModalOpen}
        billId={bill.billId}
        revision={selectedRevision}
        api={api}
        onClose={() => setIsPrintModalOpen(false)}
      />
    </div>
  );
}
