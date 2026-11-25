# Order state machine

Statuses are enforced on the backend. Arbitrary jumps are rejected.

## Happy path

```
DRAFT
  → SUBMITTED
  → PREPARING
  → AWAITING_CUSTOMER_APPROVAL   (if the prepared total differs)
  → AGREED
  → DELIVERED
  → COMPLETED
```

If the prepared total exactly matches the customer request, preparation may go:

```
PREPARING → AGREED
```

with the automatic agreement method. Any monetary difference requires explicit customer approval.

## Alternate paths

```
AWAITING_CUSTOMER_APPROVAL → CHANGE_REQUESTED → PREPARING → …
*
→ CANCELLED   (from most non-terminal states)
DELIVERED → COMPLETED   (also auto when payment clears after delivery)
```

## Approval rule

There is no price-difference allowance. If `preparedTotal` does not equal `requestedTotal`, the customer must approve the revision digitally or the seller must record telephone approval.

## Immutability

- Each preparation save that is sent creates a **new revision** (never overwrites).
- On agreement, the revision is **locked**.
- Further changes require a new revision + new agreement.
- Catalogue price edits never mutate historical snapshots on orders.

## Delivery vs payment

Independent:

- An order may be **delivered while unpaid** if the customer has credit.
- An order may be **paid before delivery**.
- When both delivered and fully paid, status becomes **COMPLETED**.
