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
import { CustomersPage } from './billing/CustomersPage.tsx';
import { CreatePurchaseOrderPage } from './purchasing/CreatePurchaseOrderPage.tsx';
import { PurchaseOrderDetailPage } from './purchasing/PurchaseOrderDetailPage.tsx';
import { PurchaseOrdersPage } from './purchasing/PurchaseOrdersPage.tsx';
import { PurchasesLayout } from './purchasing/PurchasesLayout.tsx';
import { VendorsPage } from './purchasing/VendorsPage.tsx';
import { InventoryPage } from './inventory/InventoryPage.tsx';
import { ReceiveStockPage } from './inventory/ReceiveStockPage.tsx';
import { StockCountDetailPage } from './inventory/StockCountDetailPage.tsx';
import { StockCountsLandingPage } from './inventory/StockCountsLandingPage.tsx';
import { StockReceiptDetailPage } from './inventory/StockReceiptDetailPage.tsx';
import { ExpensesPage } from './expenses/ExpensesPage.tsx';
import { ReportsLayout } from './reports/ReportsLayout.tsx';
import { SalesReportPage } from './reports/SalesReportPage.tsx';
import { VendorReportPage } from './reports/VendorReportPage.tsx';
import { StockAgeingReportPage } from './reports/StockAgeingReportPage.tsx';
import { CollectionsReportPage } from './reports/CollectionsReportPage.tsx';
import { StockAuditReportPage } from './reports/StockAuditReportPage.tsx';
import { PurchasePlanningPage } from './planning/PurchasePlanningPage.tsx';

export function AppRoutes() {
  const placeholderModules = APP_MODULES.filter(
    (module) =>
      module.roles.includes('WORKER') &&
      module.id !== 'billing' &&
      module.id !== 'customers' &&
      module.id !== 'products' &&
      module.id !== 'purchases' &&
      module.id !== 'inventory' &&
      module.id !== 'expenses',
  );
  const ownerOnlyModules = APP_MODULES.filter(
    (module) =>
      module.roles.length === 1 &&
      module.roles[0] === 'OWNER' &&
      module.id !== 'reports' &&
      module.id !== 'what-to-buy',
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
          <Route path="/inventory/stock-counts" element={<StockCountsLandingPage />} />
          <Route path="/inventory/stock-counts/:countId" element={<StockCountDetailPage />} />

          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />

          <Route element={<RequireRole allowedRoles={['OWNER']} moduleName="Reports" />}>
            <Route path="/reports" element={<ReportsLayout />}>
              <Route index element={<SalesReportPage />} />
              <Route path="vendors" element={<VendorReportPage />} />
              <Route path="stock-ageing" element={<StockAgeingReportPage />} />
              <Route path="collections" element={<CollectionsReportPage />} />
              <Route path="stock-audits" element={<StockAuditReportPage />} />
            </Route>
          </Route>

          <Route element={<RequireRole allowedRoles={['OWNER']} moduleName="What to Buy" />}>
            <Route path="/what-to-buy" element={<PurchasePlanningPage />} />
          </Route>

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
