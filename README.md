# OrderProof

Mobile-first ordering, preparation, delivery, agreement, and Mobile Money payment-record MVP for a Ghanaian food business.

OrderProof prevents disputes by preserving a shared history of:

- what the customer requested (money-first)
- what was actually prepared and weighed
- the finalized price and customer approval
- delivery
- verified Mobile Money payment

This is a **working simulated MVP** with PostgreSQL persistence, in-app notifications, and simulated MoMo payments.

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | React, Vite, TypeScript, Tailwind CSS, React Router, TanStack Query |
| Backend | Node.js, Express, TypeScript, Prisma, PostgreSQL, Zod |
| Money | `decimal.js` (no raw JS floats for currency) |

```
OrderProof/
├── frontend/
├── backend/
├── docs/
├── docker-compose.yml
└── README.md
```

## Quick start

### Prerequisites

- Node.js 20+
- Docker (for PostgreSQL)

### 1. Install

```bash
cd OrderProof
npm install
npm install --prefix backend
npm install --prefix frontend
```

### 2. Start database

Postgres is mapped to host port **5433** (to avoid clashing with local 5432 services):

```bash
docker compose up -d
```

### 3. Environment

`backend/.env` is preconfigured for local Docker:

```env
DATABASE_URL="postgresql://orderproof:orderproof@localhost:5433/orderproof?schema=public"
JWT_SECRET="orderproof-dev-secret-change-in-production"
JWT_EXPIRES_IN="7d"
PORT=4000
NODE_ENV=development
CORS_ORIGIN="http://localhost:5173"
```

Copy from `backend/.env.example` if needed.

### 4. Migrate & seed

```bash
cd backend
npx prisma migrate deploy
npx prisma generate
npm run db:seed
cd ..
```

### 5. Run both apps

From the repo root:

```bash
npm run dev
```

- Frontend: http://localhost:5173  
- Backend API: http://localhost:4000/api/health  

Or separately:

```bash
npm run dev:backend
npm run dev:frontend
```

## Demo accounts

Shown on the login screen. Password for all: **`123456789`**

| Role | Name | Phone |
| --- | --- | --- |
| Seller | OrderProof Store | `0240000000` |
| Customer | Ama Mensah | `0241111111` |
| Customer | Kofi Asante | `0242222222` |

## End-to-end demo scenario

1. Log in as **Ama** (`0241111111`).
2. Open **Catalogue** or **Place order**.
3. Select **Salmon** at **GH₵40/kg**.
4. Enter **GH₵40** as the amount you want → see **approximately 1 kg**.
5. Submit the order (no payment yet).
6. Log out; log in as seller (`0240000000`).
7. Dashboard → open the new order → **Open preparation**.
8. Set actual weight to **1.15 kg** → actual total **GH₵46**.
9. **Send for approval / finalize**.
10. The customer sees the approval request in **Notifications** and on the order page.
11. Log in as Ama → accept the adjustment.
12. The invoice locks and the payment link appears in the app.
13. Open **Pay with MoMo** → full payment → Pay (creates PENDING attempt).
14. As seller, open **Payments** → simulator → **Simulate successful payment**.
15. Confirm receipt and **GH₵0.00** outstanding (try **Resend webhook** — still one payment).
16. Seller: Ready → Dispatch → Deliver.
17. Open the order timeline for the full shared history.

## Testing

```bash
# Backend (unit + API e2e against the dev database)
npm run test --prefix backend

# Frontend unit tests
npm run test --prefix frontend
```

Backend coverage includes login/roles, money-first estimates, preparation totals, tolerance, status transitions, agreements, partial/failed payments, webhook idempotency, allocations, balances, and cross-business isolation.

## Documentation

- [API overview](docs/API.md)
- [Order state machine](docs/ORDER_STATES.md)
- [In-app notifications](docs/IN_APP_NOTIFICATIONS.md)
- [Simulated Mobile Money](docs/SIMULATED_PAYMENTS.md)

## Core product rule

Customers always order by **money value**, never by weight:

```
estimated quantity = requested amount ÷ catalogue unit price
actual line total  = actual quantity × confirmed unit price
```

If the prepared grand total differs from the request by more than  
`max(GH₵2, 5% of requested)` (configurable), the order enters  
`AWAITING_CUSTOMER_APPROVAL`.

## Architecture notes

- Modular monolith under `backend/src` (auth, products, customers, orders, payments, notifications, reports, audit).
- Business logic lives in services; React is a client only.
- Historical orders store product/variant/unit/price **snapshots**.
- Revisions and agreements are append-only; locked revisions are not edited.
- Payments reduce outstanding balance only after a successful **webhook**.
- All business rows are scoped by `businessId` for future multi-tenant use.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | API + Vite together |
| `npm run db:up` | Start Postgres container |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Reseed demo data |
| `npm test` | Backend + frontend tests |
