ALTER TABLE "bookings" ADD COLUMN "car_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_car_id_client_cars_id_fk" FOREIGN KEY ("car_id") REFERENCES "public"."client_cars"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_car_id_idx" ON "bookings" USING btree ("car_id");