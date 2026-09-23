# Notification Event Contract

`@aideal/shared` exports the organization-scoped notification event vocabulary
for in-app and email consumers. The contract is a delivery boundary; it does
not choose recipients or implement a delivery provider.

## Envelope

Every event includes:

- `eventId`: unique identifier for one emission.
- `schemaVersion`: currently `1`.
- `eventType`: one of the exported `notificationEventTypes`.
- `organizationId`: mandatory tenant scope. Consumers must reject or quarantine
  events without a matching organization context.
- `occurredAt`: ISO timestamp from the producer.
- `dedupeKey`: stable identifier for the logical event.
- `priority`, `actor`, and a typed `payload`.

## Delivery policy

Delivery is at least once. A redelivery may have a new `eventId`, so consumers
must deduplicate on `organizationId` plus `dedupeKey` before creating a
notification or sending email. The publisher should return `{ duplicate: true }`
when that key was already accepted.

`publishNotificationEventSafely` catches publisher failures and returns
`{ accepted: false, failure: "delivery_failed" }`. Originating deal, document,
research, review, and job workflows must treat this as an isolated delivery
failure. A retry or reconciliation worker may publish the same logical event
later. Provider errors must not mark the originating workflow failed.

Payloads contain identifiers and bounded status metadata, not secrets, full
documents, source contents, or provider credentials. Email and UI consumers
should resolve display details through organization-scoped application APIs.
