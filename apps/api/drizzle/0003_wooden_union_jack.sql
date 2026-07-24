ALTER TABLE "services" ADD COLUMN "price_class_1_min" integer;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "price_class_1_max" integer;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "price_class_2_min" integer;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "price_class_2_max" integer;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "price_class_3_min" integer;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "price_class_3_max" integer;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "price_class_4_min" integer;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "price_class_4_max" integer;--> statement-breakpoint
UPDATE "services" SET
  "price_class_1_min" = "price_class_1",
  "price_class_2_min" = "price_class_2",
  "price_class_3_min" = "price_class_3",
  "price_class_4_min" = "price_class_4";--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "price_class_1_min" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "price_class_2_min" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "price_class_3_min" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "price_class_4_min" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "services" DROP COLUMN "price_class_1";--> statement-breakpoint
ALTER TABLE "services" DROP COLUMN "price_class_2";--> statement-breakpoint
ALTER TABLE "services" DROP COLUMN "price_class_3";--> statement-breakpoint
ALTER TABLE "services" DROP COLUMN "price_class_4";
