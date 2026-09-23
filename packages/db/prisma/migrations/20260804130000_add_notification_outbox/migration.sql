-- Durable notification intent. This migration is additive; apply only through
-- the verified migration runner after review. It is never run by application code.
CREATE TYPE "NotificationOutboxStatus" AS ENUM ('pending', 'processing', 'delivered', 'dead_letter');

CREATE TABLE "notification_outbox" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "priority" TEXT NOT NULL,
    "actor_json" JSONB NOT NULL,
    "payload_json" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "NotificationOutboxStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(3),
    "locked_by" TEXT,
    "last_error" TEXT,
    "delivered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_outbox_organization_id_dedupe_key_key"
  ON "notification_outbox"("organization_id", "dedupe_key");
CREATE INDEX "notification_outbox_status_available_at_created_at_idx"
  ON "notification_outbox"("status", "available_at", "created_at");
CREATE INDEX "notification_outbox_organization_id_created_at_idx"
  ON "notification_outbox"("organization_id", "created_at");
CREATE INDEX "notification_outbox_status_locked_at_idx"
  ON "notification_outbox"("status", "locked_at");

ALTER TABLE "notification_outbox"
  ADD CONSTRAINT "notification_outbox_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
