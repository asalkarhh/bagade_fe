import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../auth/useSession.ts';
import {
  DEFAULT_AUTHENTICATED_HOME,
  getVisibleNavItems,
} from '../navigation/navItems.ts';
import './AppLayout.css';

function safeMatchesPopoverOpen(element: HTMLElement): boolean {
  try {
    return element.matches(':popover-open') || element.classList.contains(':popover-open');
  } catch {
    return element.classList.contains(':popover-open');
  }
}

export function AppLayout() {
  const { session, signOut, logoutError, isLoggingOut, clearLogoutError } = useSession();
  const location = useLocation();
  const navigate = useNavigate();

  const headerRef = useRef<HTMLElement | null>(null);
  const navRowRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  const lastMeasuredWidthRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);

  const [isWide, setIsWide] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const navItems = useMemo(
    () => (session ? getVisibleNavItems(session.role) : []),
    [session],
  );

  const activeNavItem = useMemo(
    () =>
      navItems.find(
        (item) =>
          location.pathname === item.path ||
          location.pathname.startsWith(`${item.path}/`),
      ),
    [navItems, location.pathname],
  );

  const measureNavigation = useCallback((force = false) => {
    const header = headerRef.current;
    const navRow = navRowRef.current;
    const menu = menuRef.current;
    if (!header || !navRow || !menu) {
      return;
    }

    if (navRow.clientWidth === 0) {
      menu.removeAttribute('popover');
      header.classList.add('is-wide');
      setIsWide(true);
      setIsMenuOpen(false);
      return;
    }

    const currentHeaderWidth = header.getBoundingClientRect().width;
    const currentlyWide = header.classList.contains('is-wide');

    // While collapsed, only remeasure when the header grows (avoids thrashing on shrinks).
    if (!force && !currentlyWide && currentHeaderWidth <= lastMeasuredWidthRef.current) {
      return;
    }

    const wasOpen = menu.hasAttribute('popover') && safeMatchesPopoverOpen(menu);

    header.classList.add('is-measuring');
    menu.removeAttribute('popover');
    header.classList.add('is-wide');

    const fitsInline = navRow.scrollWidth <= navRow.clientWidth + 1;

    if (fitsInline) {
      setIsWide(true);
      setIsMenuOpen(false);
    } else {
      header.classList.remove('is-wide');
      menu.setAttribute('popover', 'auto');
      setIsWide(false);
      if (wasOpen && typeof menu.showPopover === 'function') {
        try {
          menu.showPopover();
        } catch {
          // Ignore if popover cannot be reopened during transition.
        }
      }
    }

    lastMeasuredWidthRef.current = currentHeaderWidth;

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    rafIdRef.current = requestAnimationFrame(() => {
      header.classList.remove('is-measuring');
      rafIdRef.current = null;
    });
  }, []);

  useLayoutEffect(() => {
    measureNavigation(true);
  }, [measureNavigation, navItems.length]);

  const hasSession = Boolean(session);

  useEffect(() => {
    const header = headerRef.current;
    const menu = menuRef.current;
    if (!hasSession || !header || !menu) {
      return;
    }

    const handleToggle = (event: Event) => {
      const toggleEvent = event as Event & { newState?: string };
      if (toggleEvent.newState === 'open' || toggleEvent.newState === 'closed') {
        setIsMenuOpen(toggleEvent.newState === 'open');
      } else {
        setIsMenuOpen(safeMatchesPopoverOpen(menu));
      }
    };

    menu.addEventListener('toggle', handleToggle);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        measureNavigation(false);
      });
      observer.observe(header);
      observer.observe(menu);
    }

    return () => {
      menu.removeEventListener('toggle', handleToggle);
      observer?.disconnect();
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [hasSession, measureNavigation]);

  const handleNavLinkClick = () => {
    const menu = menuRef.current;
    if (!isWide && menu && menu.hasAttribute('popover') && safeMatchesPopoverOpen(menu)) {
      if (typeof menu.hidePopover === 'function') {
        try {
          menu.hidePopover();
        } catch {
          // Ignore if already closed.
        }
      }
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch {
      // Logout failure is surfaced via logoutError banner in the shell for retry.
    }
  };

  if (!session) {
    return null;
  }

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link visually-hidden">
        Skip to main content
      </a>

      <header
        ref={headerRef}
        className={isWide ? 'site-header is-wide' : 'site-header'}
      >
        <div className="header-inner">
          <div className="header-top">
            <Link to={DEFAULT_AUTHENTICATED_HOME} className="site-logo">
              <span className="site-logo__mark" aria-hidden="true">
                B
              </span>
              <span>Bagade Clothing</span>
            </Link>

            <div className="header-account">
              <div className="user-identity" aria-label="Signed in user">
                <span className="user-identity__name">{session.name}</span>
                <span className="role-badge" data-role={session.role}>
                  {session.role}
                </span>
              </div>

              <button
                type="button"
                className="btn-signout"
                onClick={() => {
                  void handleSignOut();
                }}
                disabled={isLoggingOut}
                aria-busy={isLoggingOut}
              >
                {isLoggingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          </div>

          <div ref={navRowRef} className="header-nav-row">
            <nav className="site-nav" aria-label="Primary">
              <button
                type="button"
                className="menu-button"
                aria-controls="primary-nav-menu"
                aria-expanded={isMenuOpen}
                popoverTarget="primary-nav-menu"
                popoverTargetAction="toggle"
              >
                <svg
                  className="menu-button__icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
                <span>Menu</span>
              </button>

              {activeNavItem ? (
                <span className="mobile-current-route">{activeNavItem.label}</span>
              ) : null}

              <ul id="primary-nav-menu" ref={menuRef} className="site-menu">
                {navItems.map((item) => (
                  <li key={item.id}>
                    <NavLink
                      to={item.path}
                      className="site-menu__link"
                      onClick={handleNavLinkClick}
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>
      </header>

      {logoutError ? (
        <div className="logout-banner-region">
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
                <strong>Sign-out failed:</strong> {logoutError.message}
              </p>
              {logoutError.requestId ? (
                <p className="alert-banner__meta">Request ID: {logoutError.requestId}</p>
              ) : null}
              <div className="alert-banner__actions">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={isLoggingOut}
                  onClick={() => {
                    void handleSignOut();
                  }}
                >
                  {isLoggingOut ? 'Retrying…' : 'Retry sign out'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={isLoggingOut}
                  onClick={clearLogoutError}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
