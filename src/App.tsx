import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { GuestOnlyRoute, RequireAuth, RequireRole } from './auth/RouteGuards.tsx';
import { SessionProvider } from './auth/SessionContext.tsx';
import { ProductsPage } from './catalog/ProductsPage.tsx';
import { AppLayout } from './layout/AppLayout.tsx';
import { APP_MODULES, DEFAULT_AUTHENTICATED_HOME } from './navigation/navItems.ts';
import { LoginPage } from './pages/LoginPage.tsx';
import { ModulePlaceholderPage } from './pages/ModulePlaceholderPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { BillDetailPage } from './billing/BillDetailPage.tsx';
import { BillHistoryPage } from './billing/BillHistoryPage.tsx';
import { BillingCounterPage } from './billing/BillingCounterPage.tsx';
import { BillingLayout } from './billing/BillingLayout.tsx';
import { CreatePurchaseOrderPage } from './purchasing/CreatePurchaseOrderPage.tsx';
import { PurchaseOrderDetailPage } from './purchasing/PurchaseOrderDetailPage.tsx';
import { PurchaseOrdersPage } from './purchasing/PurchaseOrdersPage.tsx';
import { PurchasesLayout } from './purchasing/PurchasesLayout.tsx';
import { VendorsPage } from './purchasing/VendorsPage.tsx';
import { InventoryPage } from './inventory/InventoryPage.tsx';
import { ReceiveStockPage } from './inventory/ReceiveStockPage.tsx';
import { StockReceiptDetailPage } from './inventory/StockReceiptDetailPage.tsx';

export function AppRoutes() {
  const placeholderModules = APP_MODULES.filter(
    (module) =>
      module.roles.includes('WORKER') &&
      module.id !== 'billing' &&
      module.id !== 'products' &&
      module.id !== 'purchases' &&
      module.id !== 'inventory',
  );
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

          <Route path="/billing" element={<BillingLayout />}>
            <Route index element={<BillingCounterPage />} />
            <Route path="history" element={<BillHistoryPage />} />
            <Route path=":billId" element={<BillDetailPage />} />
          </Route>

          <Route path="/products" element={<ProductsPage />} />

          <Route path="/purchases" element={<PurchasesLayout />}>
            <Route index element={<PurchaseOrdersPage />} />
            <Route path="vendors" element={<VendorsPage />} />
            <Route path="new" element={<CreatePurchaseOrderPage />} />
            <Route path="receive" element={<ReceiveStockPage />} />
            <Route path=":poId" element={<PurchaseOrderDetailPage />} />
            <Route path=":poId/receive" element={<ReceiveStockPage />} />
          </Route>

          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/inventory/receipts/:receiptId" element={<StockReceiptDetailPage />} />

          {placeholderModules.map((module) => (
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
