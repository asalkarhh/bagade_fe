import { Link } from 'react-router-dom';
import type { ApiClientError } from '../api/errors.ts';

export function AuthLoadingScreen() {
  return (
    <main className="state-screen" aria-busy="true">
      <section className="surface-card state-card" aria-labelledby="loading-heading">
        <h1 id="loading-heading">Bagade Clothing</h1>
        <p>Checking your active session…</p>
        <progress className="state-progress" aria-label="Checking session" />
      </section>
    </main>
  );
}

export interface SessionUnavailableScreenProps {
  error: ApiClientError | null;
  onRetry: () => void;
  requestedPath?: string;
}

export function SessionUnavailableScreen({
  error,
  onRetry,
  requestedPath,
}: SessionUnavailableScreenProps) {
  return (
    <main className="state-screen">
      <section className="surface-card state-card" aria-labelledby="unavailable-heading">
        <h1 id="unavailable-heading">Cannot reach server</h1>
        <div className="alert-banner alert-banner--error" role="alert">
          <svg
            className="alert-banner__icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div className="alert-banner__content">
            <p>
              {error?.message ||
                'Unable to reach the server. Check that the backend is running and try again.'}
            </p>
            {error?.requestId ? (
              <p className="alert-banner__meta">Request ID: {error.requestId}</p>
            ) : null}
          </div>
        </div>
        <div className="state-card__actions">
          <button type="button" className="btn-primary" onClick={onRetry}>
            Retry connection
          </button>
          <Link
            to="/login"
            state={requestedPath ? { from: requestedPath } : undefined}
            className="btn-secondary"
          >
            Go to sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
