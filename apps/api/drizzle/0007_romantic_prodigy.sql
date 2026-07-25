ALTER TABLE "masters" ADD COLUMN "telegram_id" varchar(64);--> statement-breakpoint
ALTER TABLE "masters" DROP COLUMN "active";--> statement-breakpoint
ALTER TABLE "masters" DROP COLUMN "can_be_master";