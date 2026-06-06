DELETE FROM "services" WHERE "price_class_1" IS NULL OR "price_class_2" IS NULL OR "price_class_3" IS NULL OR "price_class_4" IS NULL;--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "price_class_1" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "price_class_2" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "price_class_3" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "price_class_4" SET NOT NULL;