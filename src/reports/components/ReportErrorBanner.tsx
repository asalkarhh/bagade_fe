export interface ReportErrorBannerProps {
  message: string;
  requestId?: string | null;
  onRetry?: () => void;
}

export function ReportErrorBanner({
  message,
  requestId,
  onRetry,
}: ReportErrorBannerProps) {
  return (
    <div className="alert-banner alert-banner--error" role="alert">
      <div className="alert-banner__content">
        <p>{message}</p>
        {requestId ? <p className="alert-banner__meta">Request ID: {requestId}</p> : null}
        {onRetry ? (
          <div className="alert-banner__actions">
            <button type="button" className="btn-secondary" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
