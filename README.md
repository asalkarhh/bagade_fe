# Bagade Clothing — Frontend (`bagade_fe`)

Frontend web application for the **Bagade Clothing Shop Inventory and Billing System**, built with React, Vite, and TypeScript.

## Prerequisites

- Node.js 22+ (tested on Node 26) and npm
- Running `bagade_be` Spring Boot backend (defaults to `http://localhost:8080`)

## Configuration

The frontend uses `/api/v1` as its default API base path so browser requests stay same-origin in both local development (via the Vite proxy) and production (when served behind the same HTTPS origin as the API).

Copy `.env.example` to `.env.local` if you need to override the local backend proxy target:

| Variable | Description | Default |
| --- | --- | --- |
| `VITE_API_PROXY_TARGET` | Backend origin that Vite proxies `/api/*` requests to during `npm run dev` and `npm run preview` (also supports `API_PROXY_TARGET`). | `http://localhost:8080` |
| `VITE_API_BASE_URL` | API path prefix used by the shared `fetch` client. Keep `/api/v1` for same-origin cookie auth. | `/api/v1` |

Example `.env.local` when the backend runs on a non-default port:

```dotenv
VITE_API_PROXY_TARGET=http://localhost:8090
```

Or pass it inline when starting the dev server:

```bash
VITE_API_PROXY_TARGET=http://localhost:8090 npm run dev
```

## Local Development

1. Start PostgreSQL and the backend in `../bagade_be`:

```bash
cd ../bagade_be
APP_FIRST_OWNER_USERNAME=owner \
APP_FIRST_OWNER_PASSWORD=your-strong-password \
APP_FIRST_OWNER_DISPLAY_NAME="Shop Owner" \
./mvnw spring-boot:run
```

2. Install dependencies and start the frontend dev server in `bagade_fe`:

```bash
npm install
npm run dev
```

The app will be available at `http://localhost:5173`. Vite proxies `/api` requests to `$VITE_API_PROXY_TARGET` so `JSESSIONID` cookies and `X-CSRF-Token` headers operate cleanly on `localhost` without CORS configuration.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite dev server on port `5173` with `/api` proxy |
| `npm run build` | Run TypeScript project build check and Vite production bundle |
| `npm run typecheck` | Run `tsc -b` type-checking |
| `npm run lint` | Run `oxlint` across the workspace |
| `npm test` | Run Vitest unit and UI integration test suite |
| `npm run preview` | Preview the production build locally on port `4173` |

## Implemented Routes

| Route | Access | Status |
| --- | --- | --- |
| `/login` | Unauthenticated users | Sign-in form with CSRF bootstrap (FE01) |
| `/` | Authenticated users | Redirects to `/billing` (FE01) |
| `/products` | `OWNER`, `WORKER` | Working product catalog, categories, size variants, INR price & status updates (FE02) |
| `/billing` | `OWNER`, `WORKER` | Placeholder (pending) |
| `/purchases` | `OWNER`, `WORKER` | Working Purchase Orders list with vendor, status, and date filters (FE03) |
| `/purchases/vendors` | `OWNER`, `WORKER` | Working Vendors list & creation with Active/Inactive/All filter (FE03) |
| `/purchases/new` | `OWNER`, `WORKER` | Create Purchase Order with inline vendor creation & SKU picker (FE03) |
| `/purchases/:poId` | `OWNER`, `WORKER` | Purchase Order detail view, Receive Stock action & Cancel Remaining Quantity workflow (FE03/FE04) |
| `/purchases/receive` | `OWNER`, `WORKER` | Direct Stock Receipt without a PO with barcode scan & SKU linking (FE04) |
| `/purchases/:poId/receive` | `OWNER`, `WORKER` | Receive Stock against an open Purchase Order (FE04) |
| `/inventory` | `OWNER`, `WORKER` | Working inventory stock balances, category/SKU filtering, expandable batches & tag reprinting (FE04) |
| `/inventory/receipts/:receiptId` | `OWNER`, `WORKER` | Posted Stock Receipt view with batch tag generation and Code 128 print preview (FE04) |
| `/customers` | `OWNER`, `WORKER` | Placeholder (pending) |
| `/expenses` | `OWNER`, `WORKER` | Placeholder (pending) |
| `/reports` | `OWNER` only | Placeholder (pending; shows Access Denied for `WORKER`) |
| `/what-to-buy` | `OWNER` only | Placeholder (pending; shows Access Denied for `WORKER`) |

## Backend API Dependencies Noted in FE02

- `GET /api/v1/skus` (`SkuListItemResponse`) does not yet return `productId`, and `GET /api/v1/products` does not exist. The frontend retains `productId` from `POST /api/v1/products` and `PATCH /api/v1/skus/{id}` within the session and reads `productId` from `GET /api/v1/skus` if provided, without inferring product identity from name or SKU code.
- `GET /api/v1/skus` treats an omitted `active` query param as `active=true`; when the **All** status filter is selected, the frontend merges `active=true` and `active=false` queries.
