-- The NAS face kiosk's columns on attendance_device (push token, its issue date, last call-in).
-- migration-lint: allow drop_column — nothing reads them: #13 removed their only user (the NAS push path) and #14 took them out of the schema, live since 16 Oct 2026 (deployment dpl_Cir1fV4eo7YiKhnuVUVQuMT7qJQX), so the previous deploy no longer names them
SET lock_timeout = '5s';--> statement-breakpoint
DROP INDEX "attendance_device_push_token_key";--> statement-breakpoint
ALTER TABLE "attendance_device" DROP COLUMN "push_token_hash";--> statement-breakpoint
ALTER TABLE "attendance_device" DROP COLUMN "push_token_issued_at";--> statement-breakpoint
ALTER TABLE "attendance_device" DROP COLUMN "last_seen_at";