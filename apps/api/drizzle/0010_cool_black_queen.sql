CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"client_id" uuid,
	"name" varchar(120) NOT NULL,
	"phone" varchar(32) DEFAULT '' NOT NULL,
	"car" varchar(200) NOT NULL,
	"service" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"amount" integer NOT NULL,
	"amount_formula" text,
	"date_from" date NOT NULL,
	"date_to" date,
	"time_from" varchar(5) NOT NULL,
	"time_to" varchar(5),
	"readiness" text DEFAULT '' NOT NULL,
	"master" varchar(120) NOT NULL,
	"responsible" varchar(120) NOT NULL,
	"car_class" smallint NOT NULL,
	"sheet_row" integer,
	"sheet_range" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_date_from_idx" ON "bookings" USING btree ("date_from");--> statement-breakpoint
CREATE INDEX "bookings_client_id_idx" ON "bookings" USING btree ("client_id");