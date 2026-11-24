CREATE TABLE "master_work_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"master_id" integer NOT NULL,
	"section_id" integer,
	"service_id" integer,
	"kind" varchar(16) NOT NULL,
	"percent" smallint,
	"fixed_class_1" integer,
	"fixed_class_2" integer,
	"fixed_class_3" integer,
	"fixed_class_4" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "master_work_rules_one_target" CHECK (("master_work_rules"."section_id" is null) <> ("master_work_rules"."service_id" is null)),
	CONSTRAINT "master_work_rules_percent" CHECK ("master_work_rules"."kind" <> 'percent' or ("master_work_rules"."percent" between 0 and 100 and "master_work_rules"."fixed_class_1" is null and "master_work_rules"."fixed_class_2" is null and "master_work_rules"."fixed_class_3" is null and "master_work_rules"."fixed_class_4" is null)),
	CONSTRAINT "master_work_rules_fixed" CHECK ("master_work_rules"."kind" <> 'fixed' or ("master_work_rules"."percent" is null and "master_work_rules"."fixed_class_1" is not null and "master_work_rules"."fixed_class_2" is not null and "master_work_rules"."fixed_class_3" is not null and "master_work_rules"."fixed_class_4" is not null and "master_work_rules"."fixed_class_1" >= 0 and "master_work_rules"."fixed_class_2" >= 0 and "master_work_rules"."fixed_class_3" >= 0 and "master_work_rules"."fixed_class_4" >= 0)),
	CONSTRAINT "master_work_rules_kind" CHECK ("master_work_rules"."kind" in ('percent', 'fixed'))
);
--> statement-breakpoint
ALTER TABLE "master_work_rules" ADD CONSTRAINT "master_work_rules_master_id_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_work_rules" ADD CONSTRAINT "master_work_rules_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_work_rules" ADD CONSTRAINT "master_work_rules_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "master_work_rules_section_uq" ON "master_work_rules" USING btree ("master_id","section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "master_work_rules_service_uq" ON "master_work_rules" USING btree ("master_id","service_id");