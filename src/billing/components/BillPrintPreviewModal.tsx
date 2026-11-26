import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { isAbortError, isApiClientError } from '../../api/errors.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { triggerBrowserBlobDownload } from '../../utils/blobDownload.ts';
import { formatInrDisplay } from '../../utils/inrPrice.ts';
import { formatShopTimestamp } from '../../utils/shopDate.ts';
import type { BillingApi } from '../billingApi.ts';
import type { BillPrintData } from '../types.ts';

export interface BillPrintPreviewModalProps {
  open: boolean;
  billId: string | null;
  revision?: number | null;
  api: BillingApi;
  onClose: () => void;
}

function Receipt80mmSheet({ data }: { data: BillPrintData }) {
  return (
    <article className="receipt-80mm" aria-label={`80mm receipt for ${data.billNumber}`}>
      <header className="receipt-80mm__header">
        <div className="receipt-80mm__shop">{data.shopName}</div>
        <div>
          Bill: <strong>{data.billNumber}</strong> (Rev {data.revisionNumber})
        </div>
        {data.status && data.status !== 'ISSUED' ? <div>Status: {data.status}</div> : null}
        <div>Date: {formatShopTimestamp(data.issuedAt)}</div>
        {data.customerName ? (
          <div>
            Customer: {data.customerName}
            {data.customerContact ? ` (${data.customerContact})` : ''}
          </div>
        ) : null}
      </header>

      <hr className="receipt-80mm__divider" />

      <ul className="receipt-80mm__items" aria-label="Billed items">
        {data.lines.map((line, index) => (
          <li key={`${line.skuCode}-${index}`}>
            <div className="receipt-80mm__item-name">
              {line.productName}
              {line.size ? ` [${line.size}]` : ''}
            </div>
            <div className="receipt-80mm__pair">
              <span>
                {line.quantity} × {formatInrDisplay(line.unitSellingPrice)} ({line.skuCode})
              </span>
              <span>{formatInrDisplay(line.lineTotal)}</span>
            </div>
            {line.discountAmount !== '0.00' ? (
              <div className="receipt-80mm__pair">
                <span>Discount</span>
                <span>-{formatInrDisplay(line.discountAmount)}</span>
              </div>
            ) : null}
            {line.returnedQuantity > 0 ? (
              <div>Returned qty: {line.returnedQuantity}</div>
            ) : null}
          </li>
        ))}
      </ul>

      <hr className="receipt-80mm__divider" />

      <div className="receipt-80mm__pair">
        <span>Subtotal</span>
        <span>{formatInrDisplay(data.subtotal)}</span>
      </div>
      <div className="receipt-80mm__pair">
        <span>Discount</span>
        <span>-{formatInrDisplay(data.discountTotal)}</span>
      </div>
      <div className="receipt-80mm__pair receipt-80mm__pair--total">
        <span>TOTAL</span>
        <span>{formatInrDisplay(data.total)}</span>
      </div>
      <div className="receipt-80mm__pair">
        <span>Paid</span>
        <span>{formatInrDisplay(data.paid)}</span>
      </div>
      <div className="receipt-80mm__pair">
        <span>Balance due</span>
        <span>{formatInrDisplay(data.balanceDue)}</span>
      </div>

      {data.payments.length > 0 ? (
        <>
          <hr className="receipt-80mm__divider" />
          <div>PAYMENTS</div>
          {data.payments.map((payment, idx) => (
            <div key={`${payment.mode}-${idx}`} className="receipt-80mm__pair">
              <span>
                {payment.direction === 'REFUND' ? 'REFUND ' : ''}
                {payment.mode}
                {payment.reference ? ` (${payment.reference})` : ''}
              </span>
              <span>
                {payment.direction === 'REFUND' ? '-' : ''}
                {formatInrDisplay(payment.amount)}
              </span>
            </div>
          ))}
        </>
      ) : null}

      {data.corrections.length > 0 ? (
        <>
          <hr className="receipt-80mm__divider" />
          <div>CORRECTIONS</div>
          {data.corrections.map((corr, idx) => (
            <div key={`${corr.eventType}-${idx}`}>
              <div className="receipt-80mm__pair">
                <span>{corr.eventType}</span>
                <span>{corr.amountDelta}</span>
              </div>
              {corr.reason ? <div>{corr.reason}</div> : null}
            </div>
          ))}
        </>
      ) : null}

      <hr className="receipt-80mm__divider" />
      <footer className="receipt-80mm__footer">Thank you for shopping!</footer>
    </article>
  );
}

function BillPrintPreviewContent({
  billId,
  revision,
  api,
  onClose,
}: {
  billId: string;
  revision?: number | null;
  api: BillingApi;
  onClose: () => void;
}) {
  const [reloadTick, setReloadTick] = useState(0);
  const [data, setData] = useState<BillPrintData | null>(null);
  const [loadError, setLoadError] = useState<{
    message: string;
    requestId?: string | null;
  } | null>(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [printNotice, setPrintNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    api
      .getBillPrintData(billId, revision, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) {
          return;
        }
        setData(loaded);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || controller.signal.aborted) {
          return;
        }
        setLoadError(
          isApiClientError(error)
            ? { message: error.message, requestId: error.requestId }
            : { message: 'Unable to load printable bill data.' },
        );
      });

    return () => {
      controller.abort();
    };
  }, [api, billId, revision, reloadTick]);

  const handleBrowserPrint = () => {
    setPrintNotice(null);
    try {
      window.print();
      setPrintNotice(
        'Print dialog triggered for 80 mm receipt. If printing was cancelled or the printer is unavailable, keep this preview open to retry or download PDF.',
      );
    } catch {
      setPrintNotice(
        'Browser print dialog could not be opened. Try Download PDF or retry printing.',
      );
    }
  };

  const handleDownloadPdf = async () => {
    if (isDownloadingPdf || !data) {
      return;
    }
    setIsDownloadingPdf(true);
    setPdfError(null);

    try {
      const { blob, filename } = await api.downloadBillPdf(billId, revision);
      triggerBrowserBlobDownload(
        blob,
        filename || `${data.billNumber}-rev${data.revisionNumber}.pdf`,
      );
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

  const isLoading = data === null && loadError === null;

  return (
    <>
      {isLoading ? (
        <div aria-busy="true">
          <p>Loading 80 mm receipt preview…</p>
          <progress className="state-progress" aria-label="Loading receipt" />
        </div>
      ) : loadError || !data ? (
        <div className="alert-banner alert-banner--error" role="alert">
          <div className="alert-banner__content">
            <p>{loadError?.message ?? 'Receipt data unavailable.'}</p>
            {loadError?.requestId ? (
              <p className="alert-banner__meta">Request ID: {loadError.requestId}</p>
            ) : null}
            <div className="alert-banner__actions">
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
              <button type="button" className="btn-secondary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {printNotice ? (
            <div className="alert-banner alert-banner--info" role="status">
              <div className="alert-banner__content">
                <p>{printNotice}</p>
              </div>
            </div>
          ) : null}

          {pdfError ? (
            <div className="alert-banner alert-banner--error" role="alert">
              <div className="alert-banner__content">
                <p>{pdfError}</p>
              </div>
            </div>
          ) : null}

          <div className="receipt-80mm-stage">
            <Receipt80mmSheet data={data} />
          </div>

          <div className="catalog-modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Close
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
            <button type="button" className="btn-primary" onClick={handleBrowserPrint}>
              {printNotice ? 'Print again' : 'Print 80mm receipt'}
            </button>
          </div>

          {typeof document !== 'undefined'
            ? createPortal(
                <div className="bill-print-portal print-output-portal" aria-hidden="true">
                  <style media="print">{`@page { size: 80mm auto; margin: 2mm; }`}</style>
                  <Receipt80mmSheet data={data} />
                </div>,
                document.body,
              )
            : null}
        </>
      )}
    </>
  );
}

export function BillPrintPreviewModal({
  open,
  billId,
  revision = null,
  api,
  onClose,
}: BillPrintPreviewModalProps) {
  return (
    <ModalDialog
      open={open && Boolean(billId)}
      title={revision ? `Bill Receipt Preview — Rev ${revision}` : 'Bill Receipt Preview (80 mm)'}
      onClose={onClose}
    >
      {open && billId ? (
        <BillPrintPreviewContent
          key={`${billId}-${revision ?? 'current'}`}
          billId={billId}
          revision={revision}
          api={api}
          onClose={onClose}
        />
      ) : null}
    </ModalDialog>
  );
}
