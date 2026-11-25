import { useEffect } from 'react';
import type { AppNavItem } from '../navigation/navItems.ts';
import './ModulePlaceholderPage.css';

export interface ModulePlaceholderPageProps {
  module: AppNavItem;
}

export function ModulePlaceholderPage({ module }: ModulePlaceholderPageProps) {
  useEffect(() => {
    document.title = `${module.label} | Bagade Clothing`;
  }, [module.label]);

  return (
    <section className="surface-card module-page" aria-labelledby="main-content">
      <div className="module-header">
        <h1 id="main-content" tabIndex={-1}>
          {module.label}
        </h1>
        <span className="status-badge status-badge--pending">
          <svg
            className="status-badge__icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span>Pending implementation</span>
        </span>
      </div>

      <p className="module-summary">{module.summary}</p>
      <p className="module-summary">
        This section is pending implementation. Navigation and role permissions are active, and
        interactive workflows will be added in upcoming frontend modules.
      </p>

      <div className="module-meta">
        <div className="module-meta__row">
          <span className="module-meta__label">Access scope:</span>
          <span>{module.accessNote}</span>
        </div>
        <div className="module-meta__row">
          <span className="module-meta__label">Backend API endpoints:</span>
          <ul className="endpoint-list">
            {module.plannedEndpoints.map((endpoint) => (
              <li key={endpoint}>
                <code className="endpoint-chip">{endpoint}</code>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
