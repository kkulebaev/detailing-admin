CREATE TABLE "sections" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	CONSTRAINT "sections_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" serial PRIMARY KEY NOT NULL,
	"section_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"price_class_1" integer,
	"price_class_2" integer,
	"price_class_3" integer,
	"price_class_4" integer
);
--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;