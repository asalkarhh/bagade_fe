import { useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { isAbortError, isApiClientError } from '../api/errors.ts';
import { triggerBrowserBlobDownload } from '../utils/blobDownload.ts';
import { formatInrDisplay } from '../utils/inrPrice.ts';
import { formatShopTimestamp } from '../utils/shopDate.ts';
import { billingApi, type BillingApi } from './billingApi.ts';
import { BillPrintPreviewModal } from './components/BillPrintPreviewModal.tsx';
import { getBillStatusDisplay } from './statusLabels.ts';
import type { BillDetail } from './types.ts';
import '../catalog/ProductsPage.css';
import '../purchasing/Purchasing.css';
import './Billing.css';

export interface BillDetailPageProps {
  api?: BillingApi;
}

interface BillDetailState {
  billId: string;
  bill: BillDetail | null;
  error: { message: string; code?: string; requestId?: string | null } | null;
}

export function BillDetailPage({ api = billingApi }: BillDetailPageProps) {
  const { billId = '' } = useParams<{ billId: string }>();
  const linesCaptionId = useId();
  const paymentsCaptionId = useId();
  const revisionSelectId = useId();

  const [refreshTick, setRefreshTick] = useState(0);
  const [detailState, setDetailState] = useState<BillDetailState | null>(null);
  const [selectedRevisionOverride, setSelectedRevisionOverride] = useState<{
    billId: string;
    revision: number;
  } | null>(null);
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
    selectedRevisionOverride?.billId === bill.billId
      ? selectedRevisionOverride.revision
      : bill.currentRevisionNumber;

  const handleDownloadPdf = async () => {
    if (isDownloadingPdf) {
      return;
    }
    setIsDownloadingPdf(true);
    setPdfError(null);

    try {
      const { blob, filename } = await api.downloadBillPdf(bill.billId, selectedRevision);
      triggerBrowserBlobDownload(blob, filename || `${bill.billNumber}-rev${selectedRevision}.pdf`);
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
            Saved bill snapshot, line totals, payments received, and 80 mm receipt printing.
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
                value={selectedRevision}
                onChange={(event) => {
                  setPdfError(null);
                  setSelectedRevisionOverride({
                    billId: bill.billId,
                    revision: Number(event.target.value),
                  });
                }}
              >
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
              Saved billed items with quantity, unit selling price, discount, and line total
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
                  <th scope="row">
                    {line.productName}
                    {line.returnedQuantity > 0 ? (
                      <div className="catalog-field-hint">
                        Returned: {line.returnedQuantity} · Returnable: {line.returnableQuantity}
                      </div>
                    ) : null}
                  </th>
                  <td data-label="SKU" className="cell-code">
                    <code>{line.skuCode}</code>
                  </td>
                  <td data-label="Size">{line.size ?? '—'}</td>
                  <td data-label="Qty" className="cell-num">
                    {line.quantity}
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

      <section className="surface-card catalog-results-card" aria-label="Payments and credit entries">
        <div className="catalog-results-bar">
          <span id={paymentsCaptionId} className="catalog-results-count">
            Recorded payments ({bill.payments.length})
          </span>
        </div>

        {bill.payments.length === 0 ? (
          <div className="catalog-empty-state">
            <p>
              No payments recorded at checkout (balance due: {formatInrDisplay(bill.balanceDue)}).
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
                Payments recorded on this bill
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
