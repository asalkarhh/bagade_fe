import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../auth/useSession.ts';
import { DEFAULT_AUTHENTICATED_HOME } from '../navigation/navItems.ts';
import './ModulePlaceholderPage.css';

export interface AccessDeniedPageProps {
  moduleName?: string;
}

export function AccessDeniedPage({ moduleName }: AccessDeniedPageProps) {
  const { session } = useSession();

  useEffect(() => {
    document.title = 'Access denied | Bagade Clothing';
  }, []);

  return (
    <section className="surface-card module-page" aria-labelledby="main-content">
      <div className="module-header">
        <h1 id="main-content" tabIndex={-1}>
          Access denied
        </h1>
        <span className="status-badge status-badge--denied">
          <svg
            className="status-badge__icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
          <span>Owner access required</span>
        </span>
      </div>

      <div className="alert-banner alert-banner--error" role="alert">
        <svg
          className="alert-banner__icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div className="alert-banner__content">
          <p>
            {moduleName
              ? `${moduleName} is restricted to accounts with the OWNER role.`
              : 'This page is restricted to accounts with the OWNER role.'}
          </p>
          {session ? (
            <p>
              Signed in as <strong>{session.name}</strong> ({session.role}). Your session remains
              active for operational modules.
            </p>
          ) : null}
        </div>
      </div>

      <div>
        <Link to={DEFAULT_AUTHENTICATED_HOME} className="btn-primary">
          Return to Billing
        </Link>
      </div>
    </section>
  );
}
