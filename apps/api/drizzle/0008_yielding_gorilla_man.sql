CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"login" varchar(64) NOT NULL,
	"password_hash" text NOT NULL,
	"role" varchar(16) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"password_changed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_login_unique" UNIQUE("login")
);
