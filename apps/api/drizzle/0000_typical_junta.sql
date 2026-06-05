CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(32) NOT NULL,
	"name" varchar(120) DEFAULT '' NOT NULL,
	CONSTRAINT "clients_phone_unique" UNIQUE("phone")
);
