import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { DEFAULT_AUTHENTICATED_HOME } from '../navigation/navItems.ts';
import './ModulePlaceholderPage.css';

export function NotFoundPage() {
  useEffect(() => {
    document.title = 'Page not found | Bagade Clothing';
  }, []);

  return (
    <section className="surface-card module-page" aria-labelledby="main-content">
      <div className="module-header">
        <h1 id="main-content" tabIndex={-1}>
          Page not found
        </h1>
      </div>
      <p className="module-summary">
        The requested route does not exist in this application. Use the navigation bar or return to
        the counter workspace.
      </p>
      <div>
        <Link to={DEFAULT_AUTHENTICATED_HOME} className="btn-primary">
          Go to Billing
        </Link>
      </div>
    </section>
  );
}
