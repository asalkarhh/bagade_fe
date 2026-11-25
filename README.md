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

## Implemented Routes (FE01)

| Route | Access | Status |
| --- | --- | --- |
| `/login` | Unauthenticated users | Sign-in form with CSRF bootstrap |
| `/` | Authenticated users | Redirects to `/billing` |
| `/billing` | `OWNER`, `WORKER` | Placeholder (pending) |
| `/products` | `OWNER`, `WORKER` | Placeholder (pending) |
| `/purchases` | `OWNER`, `WORKER` | Placeholder (pending) |
| `/inventory` | `OWNER`, `WORKER` | Placeholder (pending) |
| `/customers` | `OWNER`, `WORKER` | Placeholder (pending) |
| `/expenses` | `OWNER`, `WORKER` | Placeholder (pending) |
| `/reports` | `OWNER` only | Placeholder (pending; shows Access Denied for `WORKER`) |
| `/what-to-buy` | `OWNER` only | Placeholder (pending; shows Access Denied for `WORKER`) |
