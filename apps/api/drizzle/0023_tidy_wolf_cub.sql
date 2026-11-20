CREATE TABLE "schedule_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"master_id" integer NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"days" jsonb NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp,
	"decided_by_id" uuid,
	"decided_by_name" text,
	CONSTRAINT "schedule_requests_status" CHECK ("schedule_requests"."status" in ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "schedule_requests" ADD CONSTRAINT "schedule_requests_master_id_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_requests" ADD CONSTRAINT "schedule_requests_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_requests_one_pending" ON "schedule_requests" USING btree ("master_id") WHERE "schedule_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "schedule_requests_master_idx" ON "schedule_requests" USING btree ("master_id","created_at");