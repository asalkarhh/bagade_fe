import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import './Purchasing.css';

export function PurchasesLayout() {
  const location = useLocation();
  const isCreateRoute = location.pathname === '/purchases/new';

  return (
    <div className="purchases-shell">
      <div className="purchases-top">
        <nav className="purchases-subnav" aria-label="Purchases sections">
          <ul className="purchases-subnav__list">
            <li>
              <NavLink to="/purchases" end className="purchases-subnav__link">
                Purchase Orders
              </NavLink>
            </li>
            <li>
              <NavLink to="/purchases/vendors" className="purchases-subnav__link">
                Vendors
              </NavLink>
            </li>
          </ul>
        </nav>

        {!isCreateRoute ? (
          <Link to="/purchases/new" className="btn-primary">
            New Purchase Order
          </Link>
        ) : null}
      </div>

      <Outlet />
    </div>
  );
}
