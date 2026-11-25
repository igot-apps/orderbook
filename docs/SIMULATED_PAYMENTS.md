# Simulated Mobile Money

No real MoMo aggregator is integrated. The flow mirrors a real provider:

1. Customer opens payment page after the order is **AGREED**
2. Chooses full or partial amount, network, and MoMo number
3. Backend creates a `PaymentAttempt` with status **PENDING** and unique `internalReference`
4. Provider outcome is applied only via **webhook**
5. Successful webhooks create a `Payment` + `PaymentAllocation` inside a DB transaction
6. Only then is `order.amountPaid` / `outstandingBalance` updated
7. A digital receipt number is issued

## Networks

- MTN Mobile Money (`MTN`)
- Telecel Cash (`TELECEL`)
- AT Money (`AT_MONEY`)

## Dev simulator

Seller path: **Payments → attempt → Open simulator**  
or `/seller/payments/simulate/:attemptId`

Actions:

| Action | Effect |
| --- | --- |
| Simulate successful payment | Webhook `SUCCESS` + provider ref |
| Simulate failed payment | Webhook `FAILED` — balance unchanged |
| Simulate cancelled payment | Webhook `CANCELLED` — balance unchanged |
| Leave pending | Do nothing |
| Resend same webhook | Idempotent replay |

## Idempotency rules

- Unique `internalReference` per attempt
- Unique `providerReference` per successful payment
- Replaying the same success webhook returns `idempotent: true` and does **not** create a second payment or double-allocate
- Failed/cancelled attempts never reduce outstanding balance
- Partial payments are supported until allocations equal `agreedTotal`

## API webhook

```http
POST /api/payments/webhook
Content-Type: application/json

{
  "internalReference": "OPPAY-...",
  "status": "SUCCESS",
  "providerReference": "MOMO-OPTIONAL"
}
```

No JWT is required on the webhook endpoint (simulating a provider callback).
