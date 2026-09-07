CREATE TABLE "payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"master_id" integer NOT NULL,
	"payout_date" date NOT NULL,
	"amount" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_amount_nonzero" CHECK ("payouts"."amount" <> 0)
);
--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_master_id_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."masters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payouts_master_date_idx" ON "payouts" USING btree ("master_id","payout_date");