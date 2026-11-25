# OrderProof API overview

Base URL (dev): `http://localhost:4000/api`

All authenticated routes expect:

```http
Authorization: Bearer <jwt>
```

## Auth

| Method | Path | Description |
| --- | --- | --- |
| POST | `/auth/login` | `{ phone, password }` → `{ token, user }` |
| GET | `/auth/me` | Current user + business settings |

## Products

| Method | Path | Roles |
| --- | --- | --- |
| GET | `/products` | Both (`q`, `category`, `includeArchived`) |
| GET | `/products/meta/categories` | Both |
| GET | `/products/meta/highlights` | Both |
| POST | `/products` | Seller |
| PATCH | `/products/:id` | Seller |
| POST | `/products/:id/archive` | Seller |
| POST | `/products/:id/variants` | Seller |
| POST | `/products/:id/favourite` | Customer |

## Customers

| Method | Path | Roles |
| --- | --- | --- |
| GET | `/customers` | Seller |
| POST | `/customers` | Seller |
| GET | `/customers/:id` | Seller |
| PATCH | `/customers/:id` | Seller |
| GET | `/customers/outstanding/aging` | Seller |

## Orders

| Method | Path | Roles |
| --- | --- | --- |
| GET | `/orders/dashboard/seller` | Seller |
| GET | `/orders/dashboard/customer` | Customer |
| GET | `/orders` | Both (customer scoped automatically) |
| GET | `/orders/:id` | Both (includes timeline) |
| POST | `/orders` | Both (seller must pass `customerId`) |
| POST | `/orders/:id/prepare/start` | Seller |
| POST | `/orders/:id/prepare` | Seller |
| POST | `/orders/:id/respond` | Customer `{ action: ACCEPT \| REQUEST_CHANGE }` |
| POST | `/orders/:id/agree-phone` | Seller |
| POST | `/orders/:id/ready` | Seller |
| POST | `/orders/:id/dispatch` | Seller |
| POST | `/orders/:id/deliver` | Seller |
| POST | `/orders/:id/cancel` | Seller |

### Create order body (money-first)

```json
{
  "items": [
    {
      "variantId": "...",
      "requestedAmount": "40",
      "note": "optional"
    }
  ],
  "deliveryInstructions": "Gate 2",
  "estimatedDeliveryCharge": "0",
  "submit": true
}
```

### Prepare body

```json
{
  "items": [
    {
      "requestItemId": "...",
      "productNameSnapshot": "Salmon",
      "variantNameSnapshot": "Standard",
      "unitSnapshot": "KILOGRAM",
      "pricingTypeSnapshot": "PER_MEASUREMENT",
      "catalogueUnitPrice": "40.00",
      "confirmedUnitPrice": "40.00",
      "requestedAmount": "40.00",
      "estimatedQuantity": "1",
      "actualQuantity": "1.15"
    }
  ],
  "deliveryCharge": "0",
  "sendForApproval": true
}
```

## Payments

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/payments/order/:orderId` | Payment page payload |
| POST | `/payments/initiate` | Creates PENDING attempt |
| POST | `/payments/webhook` | Simulated provider callback (no JWT) |
| POST | `/payments/simulate/:attemptId` | Seller dev simulator |
| GET | `/payments` | Seller list |
| GET | `/payments/attempts` | Seller list |
| GET | `/payments/receipts/:id` | Digital receipt |
| GET | `/payments/history/me` | Customer history |

### Webhook body

```json
{
  "internalReference": "OPPAY-...",
  "status": "SUCCESS",
  "providerReference": "MOMO-..."
}
```

## Notifications

| Method | Path | Roles |
| --- | --- | --- |
| GET | `/notifications/me` | Customer's in-app order and payment updates |

## Reports & settings

| Method | Path | Roles |
| --- | --- | --- |
| GET | `/reports` | Seller |
| GET | `/reports/settings` | Seller |
| PATCH | `/reports/settings` | Seller |
