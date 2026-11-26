import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import '../purchasing/Purchasing.css';
import './Reports.css';

const REPORT_NAV_ITEMS = [
  { to: '/reports', label: 'Sales & Profit', end: true },
  { to: '/reports/vendors', label: 'Vendor Performance', end: false },
  { to: '/reports/stock-ageing', label: 'Stock Ageing', end: false },
  { to: '/reports/collections', label: 'Collections & Credit', end: false },
  { to: '/reports/stock-audits', label: 'Stock Audits', end: false },
] as const;

export function ReportsLayout() {
  const location = useLocation();
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    const activeLink = listRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (typeof activeLink?.scrollIntoView === 'function') {
      activeLink.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
      });
    }
  }, [location.pathname]);

  return (
    <div className="purchases-shell">
      <div className="products-header">
        <div className="products-header__title-group">
          <h1 id="main-content" tabIndex={-1}>
            Reports
          </h1>
          <p className="products-header__subtitle">
            Reconcile shop sales, margins, supplier sell-through, inventory ageing, credit
            collections, and posted stock audits.
          </p>
        </div>
      </div>

      <nav className="reports-subnav" aria-label="Owner report views">
        <ul ref={listRef} className="reports-subnav__list">
          {REPORT_NAV_ITEMS.map((item) => (
            <li key={item.to} className="reports-subnav__item">
              <NavLink to={item.to} end={item.end} className="reports-subnav__link">
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <Outlet />
    </div>
  );
}
