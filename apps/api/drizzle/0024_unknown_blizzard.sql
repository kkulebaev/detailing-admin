CREATE TABLE "booking_services" (
	"booking_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"service_id" integer,
	"section" varchar(120) NOT NULL,
	"name" varchar(200) NOT NULL,
	"price" integer NOT NULL,
	"quantity" smallint DEFAULT 1 NOT NULL,
	CONSTRAINT "booking_services_booking_id_position_pk" PRIMARY KEY("booking_id","position"),
	CONSTRAINT "booking_services_price_nonnegative" CHECK ("booking_services"."price" >= 0),
	CONSTRAINT "booking_services_quantity_positive" CHECK ("booking_services"."quantity" >= 1)
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "discount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_services" ADD CONSTRAINT "booking_services_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_services" ADD CONSTRAINT "booking_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_services_service_id_idx" ON "booking_services" USING btree ("service_id");