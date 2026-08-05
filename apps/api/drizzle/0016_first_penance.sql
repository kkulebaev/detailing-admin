CREATE TABLE "booking_masters" (
	"booking_id" uuid NOT NULL,
	"master_id" integer NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "booking_masters_booking_id_master_id_pk" PRIMARY KEY("booking_id","master_id")
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "responsible_id" integer;--> statement-breakpoint
ALTER TABLE "booking_masters" ADD CONSTRAINT "booking_masters_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_masters" ADD CONSTRAINT "booking_masters_master_id_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_masters_master_id_idx" ON "booking_masters" USING btree ("master_id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_responsible_id_masters_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."masters"("id") ON DELETE set null ON UPDATE no action;