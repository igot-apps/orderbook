# In-app notifications

Order and payment updates are stored in PostgreSQL and shown in **Customer → More → Notifications**. Approval, order, payment, and receipt links open the relevant screen in the app. No SMS provider or simulated SMS sender is used.

The shop follows requests and price issues from its dashboard and order detail pages. Customer and seller order timelines preserve the shared order history.
