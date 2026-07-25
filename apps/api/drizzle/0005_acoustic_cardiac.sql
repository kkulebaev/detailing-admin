CREATE TABLE "masters" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"position" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"can_be_master" boolean DEFAULT true NOT NULL,
	"can_be_responsible" boolean DEFAULT true NOT NULL,
	CONSTRAINT "masters_name_unique" UNIQUE("name")
);
