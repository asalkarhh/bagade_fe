import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { resolvePostLoginPath } from '../navigation/navItems.ts';
import { AccessDeniedPage } from '../pages/AccessDeniedPage.tsx';
import { AuthLoadingScreen, SessionUnavailableScreen } from '../pages/SessionStateScreens.tsx';
import type { UserRole } from './types.ts';
import { useSession } from './useSession.ts';

interface LocationStateWithFrom {
  from?: unknown;
}

export function RequireAuth() {
  const {
    status,
    session,
    sessionError,
    suppressNextReturnTo,
    retrySessionRestore,
  } = useSession();
  const location = useLocation();

  if (status === 'loading') {
    return <AuthLoadingScreen />;
  }

  if (status === 'unavailable') {
    return (
      <SessionUnavailableScreen
        error={sessionError}
        onRetry={() => {
          void retrySessionRestore();
        }}
        requestedPath={`${location.pathname}${location.search}${location.hash}`}
      />
    );
  }

  if (status !== 'authenticated' || !session) {
    const requestedPath = `${location.pathname}${location.search}${location.hash}`;
    return (
      <Navigate
        to="/login"
        replace
        state={suppressNextReturnTo ? undefined : { from: requestedPath }}
      />
    );
  }

  return <Outlet />;
}

export interface RequireRoleProps {
  allowedRoles: readonly UserRole[];
  moduleName?: string;
}

export function RequireRole({ allowedRoles, moduleName }: RequireRoleProps) {
  const { session } = useSession();

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (!allowedRoles.includes(session.role)) {
    return <AccessDeniedPage moduleName={moduleName} />;
  }

  return <Outlet />;
}

export function GuestOnlyRoute() {
  const { status, session, suppressNextReturnTo, consumeSuppressNextReturnTo } = useSession();
  const location = useLocation();

  useEffect(() => {
    if (suppressNextReturnTo) {
      consumeSuppressNextReturnTo();
    }
  }, [suppressNextReturnTo, consumeSuppressNextReturnTo]);

  if (status === 'loading') {
    return <AuthLoadingScreen />;
  }

  if (status === 'authenticated' && session) {
    const state = location.state as LocationStateWithFrom | null;
    const destination = resolvePostLoginPath(state?.from, session.role);
    return <Navigate to={destination} replace />;
  }

  return <Outlet />;
}
