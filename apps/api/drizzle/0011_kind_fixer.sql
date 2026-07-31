CREATE TABLE "master_rates" (
	"master_id" integer PRIMARY KEY NOT NULL,
	"hourly_rate" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_hours" (
	"id" serial PRIMARY KEY NOT NULL,
	"master_id" integer NOT NULL,
	"work_date" date NOT NULL,
	"minutes" integer NOT NULL,
	"rate_snapshot" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "master_rates" ADD CONSTRAINT "master_rates_master_id_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_hours" ADD CONSTRAINT "work_hours_master_id_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."masters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_hours_master_date_idx" ON "work_hours" USING btree ("master_id","work_date");