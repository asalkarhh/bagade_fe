import type { UserRole } from '../auth/types.ts';

export interface AppNavItem {
  id: string;
  label: string;
  path: string;
  roles: readonly UserRole[];
  summary: string;
  plannedEndpoints: readonly string[];
  accessNote: string;
}

export const DEFAULT_AUTHENTICATED_HOME = '/billing';

export const APP_MODULES: readonly AppNavItem[] = [
  {
    id: 'billing',
    label: 'Billing',
    path: '/billing',
    roles: ['OWNER', 'WORKER'],
    summary:
      'Counter sales billing, bill lookup, returns, exchanges, payment collection, and receipt printing.',
    plannedEndpoints: ['/api/v1/bills', '/api/v1/bills/preview'],
    accessNote: 'Operational module — accessible to Owner and Worker',
  },
  {
    id: 'products',
    label: 'Products',
    path: '/products',
    roles: ['OWNER', 'WORKER'],
    summary:
      'Categories, clothing product catalog, SKU variants, sizing, and pricing rules.',
    plannedEndpoints: ['/api/v1/categories', '/api/v1/products', '/api/v1/skus'],
    accessNote: 'Operational module — accessible to Owner and Worker',
  },
  {
    id: 'purchases',
    label: 'Purchases',
    path: '/purchases',
    roles: ['OWNER', 'WORKER'],
    summary:
      'Vendor records, purchase orders, and remainder cancellations.',
    plannedEndpoints: ['/api/v1/vendors', '/api/v1/purchase-orders'],
    accessNote: 'Operational module — accessible to Owner and Worker',
  },
  {
    id: 'inventory',
    label: 'Inventory',
    path: '/inventory',
    roles: ['OWNER', 'WORKER'],
    summary:
      'Stock receipts, barcode registration and lookup, batch labels, stock balances, and physical stock counts.',
    plannedEndpoints: [
      '/api/v1/inventory',
      '/api/v1/stock-receipts',
      '/api/v1/barcodes',
      '/api/v1/stock-batches',
      '/api/v1/stock-counts',
    ],
    accessNote: 'Operational module — accessible to Owner and Worker',
  },
  {
    id: 'customers',
    label: 'Customers',
    path: '/customers',
    roles: ['OWNER', 'WORKER'],
    summary:
      'Customer directory, contact lookup, and customer dues tracking.',
    plannedEndpoints: ['/api/v1/customers'],
    accessNote: 'Operational module — accessible to Owner and Worker',
  },
  {
    id: 'expenses',
    label: 'Expenses',
    path: '/expenses',
    roles: ['OWNER', 'WORKER'],
    summary:
      'Daily shop expense recording, categories, and adjustments.',
    plannedEndpoints: ['/api/v1/expenses'],
    accessNote: 'Operational module — accessible to Owner and Worker',
  },
  {
    id: 'reports',
    label: 'Reports',
    path: '/reports',
    roles: ['OWNER'],
    summary:
      'Sales reports, vendor performance, stock ageing, customer collections, and stock audit summaries.',
    plannedEndpoints: [
      '/api/v1/reports/sales',
      '/api/v1/reports/vendors',
      '/api/v1/reports/stock-ageing',
      '/api/v1/reports/collections',
      '/api/v1/reports/stock-audits',
    ],
    accessNote: 'Owner-only module',
  },
  {
    id: 'what-to-buy',
    label: 'What to Buy',
    path: '/what-to-buy',
    roles: ['OWNER'],
    summary:
      'Minimum stock targets and purchase replenishment recommendations.',
    plannedEndpoints: ['/api/v1/purchase-planning', '/api/v1/purchase-targets/{skuId}'],
    accessNote: 'Owner-only module',
  },
] as const;

export function getVisibleNavItems(role: UserRole): AppNavItem[] {
  return APP_MODULES.filter((item) => item.roles.includes(role));
}

export function isRoutePermittedForRole(pathname: string, role: UserRole): boolean {
  if (pathname === '/' || pathname === DEFAULT_AUTHENTICATED_HOME) {
    return true;
  }
  const matched = APP_MODULES.find(
    (item) => pathname === item.path || pathname.startsWith(`${item.path}/`),
  );
  if (!matched) {
    return true;
  }
  return matched.roles.includes(role);
}

export function sanitizeInternalPath(candidate: unknown): string | null {
  if (typeof candidate !== 'string') {
    return null;
  }
  const trimmed = candidate.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return null;
  }
  if (trimmed === '/login' || trimmed.startsWith('/login?') || trimmed.startsWith('/login/')) {
    return null;
  }
  return trimmed;
}

export function resolvePostLoginPath(fromCandidate: unknown, role: UserRole): string {
  const internalPath = sanitizeInternalPath(fromCandidate);
  if (!internalPath || internalPath === '/') {
    return DEFAULT_AUTHENTICATED_HOME;
  }
  const pathname = internalPath.split(/[?#]/, 1)[0] || '/';
  if (!isRoutePermittedForRole(pathname, role)) {
    return DEFAULT_AUTHENTICATED_HOME;
  }
  return internalPath;
}
