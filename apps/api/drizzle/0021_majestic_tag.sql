CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity" varchar(32) NOT NULL,
	"entity_id" text NOT NULL,
	"action" varchar(16) NOT NULL,
	"actor_id" uuid,
	"actor_login" varchar(64) NOT NULL,
	"actor_name" text DEFAULT '' NOT NULL,
	"changes" jsonb,
	"snapshot" jsonb,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("entity","action","at");