import { NavLink, Outlet } from 'react-router-dom';
import '../purchasing/Purchasing.css';
import './Billing.css';

export function BillingLayout() {
  return (
    <div className="purchases-shell">
      <div className="purchases-top">
        <nav className="purchases-subnav" aria-label="Billing sections">
          <ul className="purchases-subnav__list">
            <li>
              <NavLink to="/billing" end className="purchases-subnav__link">
                Billing Counter
              </NavLink>
            </li>
            <li>
              <NavLink to="/billing/history" className="purchases-subnav__link">
                Bill History
              </NavLink>
            </li>
          </ul>
        </nav>
      </div>

      <Outlet />
    </div>
  );
}
