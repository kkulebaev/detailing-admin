CREATE TABLE "client_cars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"make_model" varchar(200) NOT NULL,
	"plate" varchar(32) DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_cars" ADD CONSTRAINT "client_cars_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_cars_uniq" ON "client_cars" USING btree ("client_id","make_model","plate");--> statement-breakpoint
CREATE INDEX "client_cars_client_id_idx" ON "client_cars" USING btree ("client_id");