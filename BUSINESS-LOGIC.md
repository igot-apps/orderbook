# OrderProof business logic

## Accounts and persistence

- Customers and shop staff sign in with their phone number and password. The current seeded credentials are for local testing only.
- PostgreSQL stores customers, catalogue products, order requests, invoice revisions, agreements, payment attempts, payments, receipts, delivery completion, notifications, and audit history.
- Customer data is scoped to the customer's store and account. The shop sees requests only for its own store.
- The normal seed command creates the initial store only when missing; it does not erase existing orders or payments.

## Catalogue and request

- The catalogue shows a reference unit price, such as GH₵40 per kg. Stock and exact weight are not promised by the catalogue.
- A customer requests a money amount per item, such as GH₵40 of salmon. The app derives only an estimated quantity from the catalogue price.
- Submission creates an immutable original request and an estimated total. Submission does not record a payment or final price.
- The shop receives a new request. The customer sees that the order was received and is being prepared.

## Shop review and invoice

- The shop opens the request detail and edits the complete invoice in one place. Each changed item needs a reason. Delivery charge changes are part of the final invoice.
- The shop can mark an item unavailable and give a reason. If no items can be supplied, the shop cancels the request instead.
- Each send creates a numbered revision. The original customer request remains visible as evidence.
- An invoice is **unchanged** only when every item identity, quantity, unit price, line amount, and delivery charge matches the request. Matching grand totals alone are insufficient.
- If the invoice is unchanged and the customer's auto-approval preference is on, it is agreed at the requested total. This preference defaults to on.
- If the preference is off, or any invoice detail changed, the revision waits for customer approval. The shop may record a phone agreement with a note, or the customer may accept digitally.
- A customer may request changes or flag an agreed price before paying. This pauses payment until the shop sends a new revision and agreement is recorded.

## Fulfilment and payment

- The shop marks an agreed order completed with one action. An untouched request can be completed directly when auto-approval is on; otherwise that action sends it for approval first.
- Completion and payment are independent. A completed order can have an outstanding balance, shown clearly to both sides.
- Payment becomes available only after agreement. The customer chooses full or partial payment and a Mobile Money network and number.
- The current checkout simulates provider success on the server, then persists a payment, updates the balance, and issues a receipt. Repeated callback processing cannot create a duplicate payment for the same attempt.
- The shop sees verified payments and receipts. The simulated provider can later be replaced without changing the order and balance rules.

## Cancellation and history

- The shop may cancel an unfinished, unpaid order with a reason. An order with recorded payments cannot be cancelled through this flow.
- Completed, cancelled, and revised orders remain in PostgreSQL history. Test transactions belong in the separate `orderproof_test` database.
