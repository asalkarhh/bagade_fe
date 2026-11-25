import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { GuestOnlyRoute, RequireAuth, RequireRole } from './auth/RouteGuards.tsx';
import { SessionProvider } from './auth/SessionContext.tsx';
import { AppLayout } from './layout/AppLayout.tsx';
import { APP_MODULES, DEFAULT_AUTHENTICATED_HOME } from './navigation/navItems.ts';
import { LoginPage } from './pages/LoginPage.tsx';
import { ModulePlaceholderPage } from './pages/ModulePlaceholderPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';

export function AppRoutes() {
  const operationalModules = APP_MODULES.filter((module) => module.roles.includes('WORKER'));
  const ownerOnlyModules = APP_MODULES.filter(
    (module) => module.roles.length === 1 && module.roles[0] === 'OWNER',
  );

  return (
    <Routes>
      <Route element={<GuestOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to={DEFAULT_AUTHENTICATED_HOME} replace />} />

          {operationalModules.map((module) => (
            <Route
              key={module.id}
              path={module.path}
              element={<ModulePlaceholderPage module={module} />}
            />
          ))}

          {ownerOnlyModules.map((module) => (
            <Route
              key={module.id}
              element={<RequireRole allowedRoles={module.roles} moduleName={module.label} />}
            >
              <Route path={module.path} element={<ModulePlaceholderPage module={module} />} />
            </Route>
          ))}

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </SessionProvider>
  );
}

export default App;
