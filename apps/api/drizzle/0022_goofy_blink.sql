CREATE TABLE "master_schedule" (
	"master_id" integer NOT NULL,
	"work_date" date NOT NULL,
	CONSTRAINT "master_schedule_master_id_work_date_pk" PRIMARY KEY("master_id","work_date")
);
--> statement-breakpoint
ALTER TABLE "master_schedule" ADD CONSTRAINT "master_schedule_master_id_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."masters"("id") ON DELETE cascade ON UPDATE no action;