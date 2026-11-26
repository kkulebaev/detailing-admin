CREATE TABLE "studio_hours" (
	"weekday" smallint PRIMARY KEY NOT NULL,
	"opens_at" smallint NOT NULL,
	"closes_at" smallint NOT NULL,
	CONSTRAINT "studio_hours_weekday" CHECK ("studio_hours"."weekday" between 0 and 6),
	CONSTRAINT "studio_hours_range" CHECK ("studio_hours"."opens_at" >= 0 and "studio_hours"."closes_at" <= 1440 and "studio_hours"."opens_at" < "studio_hours"."closes_at")
);
